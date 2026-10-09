# Vehicle Plan Solver

> Architecture reference for the vehicle scheduling optimizer.
> Source: `apps/api/src/modules/transit/timetabling/vehicle-solver/`

---

## Overview

The solver distributes **every trip of a `VehiclePlan`** (all its lines) into vehicle blocks and decides, for each block, its **operator** (`branchId`), **depot** and **vehicle type**. It mirrors the crew solver (`crew-solver/`):

- runs in a **worker thread**, streams progress over **SSE**;
- **one mode**: a greedy construction gives the first proposal in milliseconds, then a continuous improvement (simulated annealing) runs until stopped, out of time or without improvement;
- **the generation belongs to the plan**, not to the screen: it keeps running when the modal closes, the plan screen picks it up again, and the topbar lists it (background generations);
- **the solver optimizes what the screen shows**: proposals are scored by the same `PlanScoreState` that `VehiclePlanService.recalculate()` uses, over blocks materialized exactly as they will be persisted — the score of a proposal is the score the plan gets once applied.

Only a **DRAFT** plan can be optimized (to change an active plan, duplicate it and optimize the copy), and only by a user with access to **every operator of the plan's Scope** (or an admin).

---

## Files

```
vehicle-solver/
  vehicle-solver.types.ts            params, proposal, summary, worker messages
  vehicle-solver.input.ts            Prisma → pure input (+ the plan as it is, summarized)
  vehicle-solver.calc.ts             model: hard rules, materialization, capacity, construction, summaries
  vehicle-solver.improve.ts          VehicleImprover — simulated annealing over PlanScoreState
  vehicle-solver.worker.ts           construction + improvement in 50 ms slices, emits proposals/progress
  vehicle-solver.service.ts          jobs (one per plan), stream, apply
  vehicle-solver.controller.ts       transit/vehicle-plan/:id/solver/*
  vehicle-solver-jobs.controller.ts  transit/vehicle-solver/jobs (topbar)
vehicle-plan/scoring/
  block-aggregate.ts                 BlockAggregate from persisted-shaped rows
  plan-scoring.calc.ts               PlanScoreState (incremental), scoreFromAggregates
```

Bench (nothing is written): `pnpm vehicle:solver-bench <vehiclePlanId> [seconds] [seed] [--scratch] [--trace] [--cycle=s] [--settings=json]` — prints the plan, the construction and the improved proposal side by side (with each criterion's loss) and checks the proposal (every trip once, hard rules, capacity, no modeling issues).

---

## Settings

Planning settings (`transit.planning`) are per **transit Scope**, falling back to global. A plan may carry its own **full copy** in `VehiclePlan.settings` (validated by `planningSettingsSchema`):

```
VehiclePlan.settings ?? Settings(transit.planning, Scope) ?? global
```

| Endpoint | Effect |
|---|---|
| `GET :id/settings` | `{ settings, isCustom, inherited }` |
| `POST :id/settings/customize` | copies the effective settings into the plan, recalculates |
| `PUT :id/settings` | saves the plan's copy, recalculates |
| `DELETE :id/settings` | back to inheriting, recalculates |

---

## Data the solver reads

| Data | Where | Use |
|---|---|---|
| Operators and shares | `ScopeOperator.share` (sum ≤ 100) | `operatorShareFleet` / `operatorShareKm` criteria |
| Depot operators and capacity | `TransitLocality.depot` — `{ operators: branchId[], capacity: [{ vehicleType \| null, max }] }` | which operators may use a depot; physical limits (total and per type), counting locked blocks |
| Line vehicle types | `TransitLine.vehicleTypes` — `{ allowed: VehicleType[], preferred }` | `allowed` is a hard rule (empty = any); `preferred` scores |
| Trip required type | `TransitTrip.requiredVehicleType` | hard rule, overrides the line |
| Stand points | `RouteLocality.allowsVehicleStand` ("Permite parada (carro)" on the route's point, default off) | where a vehicle may stand in an interval |
| Default interval type | general `defaultIntervalTypeId` | its `minMinutes` (else 120) splits a turnaround from an interval; intervals are placed from it on |
| Matrix | `TravelTimeMatrix` (minutes = ⌈base × speedRatio⌉) | deadruns, reachability |
| Trip groups | `bundleId` on `TransitTrip`, `BlockDeadrun`, `BlockInterval` | members sharing it are one fixed unit (see Trip groups) |

`TransitRoute.homeDepot` is not used by the solver (only by the schedule generator).

---

## Model

A block = its trips + operator + depot + vehicle type, always held **materialized**: the deadruns and intervals it would be persisted with.

### Hard rules

| Rule | Description |
|---|---|
| Chaining | same place: `cur.dep − prev.arr ≥ minLayoverMinutes`; elsewhere: `cur.dep ≥ prev.arr + 1 + matrix(prev.dest → cur.origin)` |
| Depot reach | depot → first trip and last trip → depot exist in the matrix |
| Vehicle type | one type accepted by every trip (required type, else the line's allowed) |
| Depot × operator | the block's operator is in the depot's `operators` (or the list is empty) |
| Capacity | blocks per depot, total and per type ≤ `max` |
| Span | a construction chain / a merge never spans beyond `range.minBlockDuration.ceiling` |
| Stand | a stop of the interval threshold or more stays only where the vehicle may stand — the arriving trip's destination point or the next trip's origin point; elsewhere it goes back to the block's depot and out again, and with no time for that round trip the trips can't follow each other |
| Locked | `VehicleBlock.constraints.locked` blocks stay as they are (base "Respeita travados") |
| Trip group | a group's members stay together, back to back, in one block — nothing between them (see Trip groups) |

### Materialization

Same conventions as the import's normalization (1 min between a trip and its deadrun):

```
ACCESS        depot → first.origin      arrives first.dep − 1
between trips stop ≥ threshold and neither point allows standing:
                RETURN prev.dest → depot (prev.arr + 1), ACCESS depot → cur.origin (arrives cur.dep − 1)
              otherwise, when the places differ, a DISPLACEMENT — right away (stands at cur.origin), or
                at the end when only the arrival allows standing (stands at prev.dest) — and an
                interval over the stop when it reaches the threshold
RETURN        last.dest → depot          leaves last.arr + 1
```

The vehicle type is chosen among the accepted ones: the one most of the block's trips prefer, then `STANDARD`, then the enum order — the first that fits the depot's capacity.

### Trip groups

A trip group ("grupo de viagens", `bundleId` — a shared uuid, no table) is a set of trips, plus the deadruns and intervals grouped with them, that must run back to back on one vehicle and one driver, e.g. four F01 trips 02:00–06:00, or a whole block with its ACCESS and RETURN. Members are explicit: whatever carries the id belongs to the group, edges included. Unlike a locked block, the rest of the vehicle stays free: the solver may put other trips before and after the group, never between its members.

- **Unit** — `bundleUnits` (`vehicle-solver.input.ts`) turns each group into one `SolverTrip` from its first departure to its last arrival (`SolverTrip.bundle`); every move handles it as a single trip, so no move can split it. `expand()` gives its trips back for the aggregate, the issues check and the proposal.
- **Rows kept as they are** — the group's deadruns and intervals (plus whatever sits between its first departure and last arrival, for groups made before deadruns/intervals could be members) are copied from the block that holds the whole group (`bundle.rows`), intervals with their own type, all keeping the group id. A group not yet together gets only the displacements its trips need. Nothing else is placed inside, and the stand rule doesn't apply there — what's inside is the user's.
- **Own ACCESS / RETURN** — a group holding its ACCESS (`bundle.fromDepot`) can only start a block, and one holding its RETURN (`bundle.toDepot`) only end one (`canFollow`); the block must be at that deadrun's depot, which then replaces the ACCESS / RETURN the block would get (`materialize`).
- **Vehicle type** — the intersection of its trips' accepted types; none is an error.
- **Locked blocks** — a group partly inside a locked block is an error (lock or unlock the whole group).

Groups are created and removed on the Gantt (see `gantt-interaction.md`); `applyDiff` checks a new group once (`trip-bundle.utils.ts`): at least one trip and two members on the same vehicle with nothing else between them, within `range.minBlockDuration.ceiling` and the crew `maxContinuousDrivingMinutes`, with a common vehicle type. Later edits that break it only flag `BUNDLE_BROKEN` on the block. Removing any trip of a group dissolves the whole group; removing a deadrun or interval only takes it out. Moving a group's trips always takes its deadruns and intervals along; "Reduzir trocas de carro" never cuts a group nor drops one of its members at the junction. Duplicating a plan gives each group a new id.

---

## Score

`PlanScoreState` (`plan-scoring.calc.ts`) — an incremental sum over block aggregates (`add` / `remove`), shared by `recalculate()` and the solver:

- **every active criterion enters once with its weight**: a per-block one (`lineTransfer`, `deadrunRatio`, `minBlockDuration`) with its `modifier` and the **mean** of its value over the blocks; a plan one with its value — same rule as the crew score;
- plan criteria: `distributionVariance` (CV of block duration), `preferredVehicleType` (% of preferred-type trips running in another type), `operatorShareFleet` / `operatorShareKm` (largest gap, in p.p., between an operator's part and its share normalized over the operators with a share — only with 2+ such operators), anchored `totalKm` and `fleetUsage`;
- `score = round(weighted average × 9999)`;
- the solver optimizes the **raw** average: past floor/ceiling a criterion keeps falling with its band's slope, down to −1 — getting closer to the ceiling still counts, but a criterion no solution can meet doesn't outweigh the rest.

The **direction** param reweights the copy the search optimizes (`fleet`: `anchored.fleetUsage.weight × 2`; `km`: `anchored.totalKm.weight × 2`, `deadrunRatio.modifier × 2`); proposals are always reported with the plan's own settings.

---

## Construction

1. **Chains** — trips by departure, each to the open chain with the lowest cost (wait + displacement + line change + narrowing the chain's vehicle types), else a new chain.
2. **Placement** — most restricted chains first (fewest types), then the longest: for each operator, the best depot × type that fits the capacity; the operator furthest below its share target wins (with shares), else the least deadrun km. A chain no depot can take is an error ("Nenhuma garagem atende…").
3. **Seed** — the plan's current blocks, split where a link breaks a rule and re-placed when needed; used instead when it scores better.

---

## Improvement (`VehicleImprover`)

| Move | Description |
|---|---|
| relocate | a trip goes to another block (partner found by scanning for a free slot) |
| swap | two blocks exchange a trip |
| tail | two blocks exchange everything after a point in time (only the two new links checked) |
| merge | two blocks one after the other in time become one |
| split | a block becomes two |
| depot | a block moves to another depot of its operator |
| operator | a block goes to another operator |

Each new block goes through `VehicleModel.place` (hard rules, capacity staged with the removed blocks released). Acceptance: simulated annealing, temperature calibrated as the **median** of the first 300 worsening moves ÷ ~20 (a typical move touches 1/n of a per-block mean and worsening moves far outnumber improving ones — any warmer and the search slides downhill), cooled within cycles of `min(stopMaxTotalMinutes, stopNoImprovementMinutes / 2)`, each cycle restarting from the best blocks at 0.7× the previous temperature. The score state is rebuilt every 20 000 accepted moves (float drift).

Stops on `stop`, `stopMaxTotalMinutes` or `stopNoImprovementMinutes` without a better proposal; a better proposal is emitted at most once a second.

---

## Jobs and protocol

In memory, one per plan (a new start replaces it), kept 30 min after the run ends or until applied/discarded.

| Endpoint | |
|---|---|
| `POST :id/solver/start` | `{ jobId, params: { base: 'complete' \| 'scratch', direction: 'balanced' \| 'fleet' \| 'km' } }` |
| `GET :id/solver/stream?jobId&token` | SSE: the job's state first (best proposal without blocks, last progress, its end), then live |
| `POST :id/solver/stop` | ends the run keeping the best proposal |
| `GET :id/solver/current` | `{ job }` — params, progress, end, `baseline` (the plan as it was), `affectedCrewPlans` |
| `POST :id/solver/discard` | forgets it |
| `POST :id/solver/accept` | applies the best proposal |
| `GET transit/vehicle-solver/jobs` | every plan's generation (topbar) |

Worker → host: `progress { elapsed, attempts, improvements, bestScore, sinceImprovement }`, `proposal { index, summary, blocks }`, `done { stopReason }`, `error { message }`.

### Applying

Checks the plan still has the trips the generation read, then in one transaction deletes the non-locked blocks (their trips, deadruns and intervals cascade; crew pieces on them lose the block → stale) and creates the proposal's blocks, trips, deadruns and intervals. Locked blocks keep their numbers; the others take the free numbers ordered by main line (the line the block runs the most trips of, codes compared numerically) and then start. Then `recalculate()`.

---

## Frontend

`vehicle-plan/[id]/components/OptimizeModal.tsx` — tabs **Config** (`PlanningSettingsEditor`, customize/save/restore), **Painel** (base, direction) and **Cenários** (run stats; plan × proposal: score, fleet, km, issues, fleet per operator and per depot/type, each criterion; crew plans affected; Parar / Descartar / Aplicar). The plan page polls `solver/current` while running (topbar button "Gerando… mm:ss"), `?optimize=1` opens Cenários (from the topbar's background generations).

---

## Out of scope / future

- **Line tied to an operator** (`VehiclePlanLine.branchId`): the engine already decides each block's operator; when it comes, it is the field plus a hard rule (the line's trips only in blocks of that operator).
