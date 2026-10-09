# Crew Plan Solver

> Architecture reference for the crew (duty) scheduling optimizer.
> Source: `apps/api/src/modules/transit/timetabling/crew-solver/` and `crew-plan/crew-scoring.calc.ts`

---

## Overview

The solver decides **who drives what**: it covers every stretch the vehicles of a `VehiclePlan` need a driver for with DRIVER duties, whose pieces start and end at relief points. Vehicles are fixed — moving trips between vehicles is the vehicle solver's job (and "Reduzir trocas de carro").

- runs in **worker threads**, streams progress over **SSE**;
- **one mode**: a greedy construction gives the first proposal in milliseconds, then a continuous improvement (simulated annealing) runs until stopped, out of time or without improvement;
- **several searches side by side**: a generation runs up to 4 workers from different seeds and keeps the best proposal of them all;
- **the generation belongs to the crew plan**, not to the screen: it keeps running when the modal closes, the plan screen picks it up again, and the topbar lists it (background generations);
- **the solver optimizes what the screen shows**: every duty is evaluated by `evaluateDuty` and every plan by `CrewScoreAggregate` — the same code `CrewPlanService.recalculate()` uses for hand-built plans.

---

## Files

```
crew-solver/
  crew-solver.types.ts           params, proposal, worker messages
  crew-solver.input.ts           Prisma → pure input (blocks, locked duties, meal type, meal stops, walk)
  crew-solver.calc.ts            BlockView, construction (solveCrewPlan), evaluation of proposals
  crew-solver.improve.ts         CrewImprover — simulated annealing over CrewScoreAggregate
  crew-solver.worker.ts          construction + improvement in 50 ms slices, emits proposals/progress
  crew-solver.service.ts         jobs (one per plan, N workers each), stream, accept
  crew-solver.controller.ts      transit/crew-plan/:id/solver/*
  crew-solver-jobs.controller.ts transit/crew-solver/jobs (topbar)
crew-plan/
  crew-scoring.calc.ts           evaluateDuty, CrewScoreAggregate, computeCrewPlan, solverRank
  relief-points.ts               relief points and service spans per block
  crew-walk.ts                   walking between relief points
```

Scripts (nothing is written):

- `pnpm crew:solver-bench <crewPlanId> [seconds=60] [seed=1] [--scratch] [--meal=none|allowed|continuous|fractioned] [--settings=json]` — construction vs improved proposal side by side, with each criterion's loss. `--settings` is deep-merged over the plan's settings.
- `pnpm crew:score-check` — the incremental aggregate against the full calculation, for every crew plan.

---

## Settings

Crew settings (`transit.crew`, `crewSettingsSchema`) are per **transit Scope** — every operator of the Scope follows the same CCT — falling back to global. A crew plan may carry its own **full copy** in `CrewPlan.settings`:

```
CrewPlan.settings ?? Settings(transit.crew, Scope) ?? global
```

| Endpoint | Effect |
|---|---|
| `GET :id/settings` | `{ settings, isCustom, inherited }` |
| `POST :id/settings/customize` | copies the effective settings into the plan, recalculates |
| `PUT :id/settings` | saves the plan's copy, recalculates |
| `DELETE :id/settings` | back to inheriting, recalculates |

### Parameters

| Field | Use |
|---|---|
| `signOnMinutes` / `signOffMinutes` | assumed before the first / after the last piece when the duty has no explicit activity |
| `handoverMinutes` | tolerated overlap between same-role pieces on the same block |
| `minPieceMinutes` | shorter pieces are flagged (`MIN_PIECE`, warning) — unless the piece is all its service span holds |
| `maxContinuousDrivingMinutes` | `CONTINUOUS_DRIVING` (error) |
| `maxWalkMeters` | farthest walk between pieces at different places (`WALK_DISTANCE`) |
| `nightStartHour` / `nightEndHour` | informative `nightMinutes` |
| `mealBreakIntervalTypeId` | the `IntervalType` placed as the meal break — its min/max decide when a gap becomes a meal |
| `mealRule` | see below |
| `stopMaxTotalMinutes` / `stopNoImprovementMinutes` | when a search stops |

### Meal rule

`mealRule` — the in-duty rest (intrajornada) of a STRAIGHT duty. A SPLIT's own split interval is its rest.

| `mode` | `form: continuous` | `form: fractioned` |
|---|---|---|
| `none` | no meal; gaps between pieces are worked (paid), the split interval aside | — |
| `allowed` | the solver places an **unpaid** meal BREAK where one fits (the meal type's range, at a meal stop); a STRAIGHT without one is fine | not allowed (fractioned stops are paid — nothing to gain) |
| `required` | every STRAIGHT needs a meal BREAK, else `MEAL_REQUIRED` | the duty's stops must add up to `fractionedMinTotal`, one of at least `fractionedMinLongest`, else `MEAL_REQUIRED` |

`mealPolicy(rule)` (`@nyx/schemas`) is how the rules read it: `breaks` (a meal BREAK may be placed — the solver loads the meal type and refuses to start without one), `required`, `fractioned`. Settings stored with the former two switches (`continuous`, `fractioned`) convert on parse: any on → `required`, both on → `continuous`.

A meal BREAK is only placed at a **meal stop**: `RouteLocality.allowsMealBreak` of the line that **arrives** there (`mealStopAt`). A hand-placed break elsewhere is a `MEAL_LOCATION` warning.

---

## Data the solver reads

| Data | Where | Use |
|---|---|---|
| Blocks | `VehicleBlock` + trips, deadruns, intervals of the plan's `VehiclePlan` | what needs a driver |
| Relief points | `relief-points.ts` — each trip's route endpoints, every `RouteLocality.allowsCrewChange` stop along the way, deadrun endpoints | where a piece may start/end |
| Service spans | `relief-points.ts` — the block window minus the vehicle's own intervals (stretched over the standing time around them) and depot stays | the stretches a driver must cover; a piece covering time outside them needs a break there (`PIECE_OFF_SERVICE`) |
| Locked duties | `Duty.constraints.locked` | kept as they are with base "Completar" |
| Meal stops | `RouteLocality.allowsMealBreak` | where a meal BREAK may go |
| Meal type | `mealBreakIntervalTypeId` → `IntervalType` (`minMinutes`, `maxMinutes`, `isPaid`) | meal range; a paid break counts as work |
| Walk | `TravelTimeMatrix.distanceKm`, else straight line × factor; 4 km/h | walking between pieces at different places |
| Trip groups | `relief-points.ts` — `bundles`: each group's first member's departure → last one's arrival on the block (`bundleId` on trips, deadruns, intervals) | one driver runs a group whole: relief points strictly inside are dropped from the solver's input |

---

## Model

A **duty** = 1 to 3 pieces in time order (consecutive pieces on the same vehicle merge) + its breaks, and a kind:

| Kind | Label | What makes it |
|---|---|---|
| `STRAIGHT` | Corrida | worked gaps between pieces; a meal BREAK when the rule places one |
| `SPLIT` | Dupla pegada | one gap within `range.splitInterval` (longer than the meal), off the clock |
| `TRIPPER` | Meia jornada | no long gap and working less than `range.workTime.floor` |

How a gap between two pieces is read (`CrewImprover.build`, same rule in the construction):

1. the rest (gap minus the walk) fits the meal type's range, at a meal stop, and the rule places breaks → **meal** (STRAIGHT);
2. else the gap is longer than the meal's max and fits `splitInterval` (when active) → **split** (SPLIT) — a gap that fits it is always a split, never worked;
3. else the gap is **worked** — paid idle time (`idleTime`).

At most one meal or split per duty. With no long gap: a meal inside a piece where the vehicle stands (STRAIGHT); else, working at least `workTime.floor` and the rule not requiring a meal (or met by the fractioned stops), a STRAIGHT; else a TRIPPER.

### What a duty is worth

`evaluateDuty` (`crew-scoring.calc.ts`) — the conventions are in its header. In short: `workMinutes` = pieces minus the breaks inside them + non-break activities + paid breaks + implicit sign-on/off + idle time; `paidMinutes = workMinutes`; overtime = work above `workTime.idealMin`. Only the meal break and the split interval are off the clock.

### Hard rules

A duty the solver builds has **no error** issue: ceilings of the active range criteria (work, spread, split interval, idle time, …), floors where they apply, walk distance and travel gap, continuous driving, piece off service, branch mismatch, required meal. Warnings (short piece, meal location, travel gap without matrix) are allowed — they rank below (see Score).

**Trip groups** — every cut, split gap and meal gap the solver can pick starts at a relief point, so dropping the points inside a group (`crew-solver.input.ts`) keeps it with one driver and leaves its inside untouched: no relief, no split, no meal there. On the screen, a DRIVER piece starting or ending inside a group is flagged `BUNDLE_SPLIT` (warning); the group is drawn as an outline on the vehicle lane, read-only.

---

## Score

Range criteria (`settings.range`) — outside `[idealMin, idealMax]` they cost score, outside `[floor, ceiling]` they are an `error` issue. Per duty, entering the plan score as the mean over the duties they apply to:

| Criterion | Measures |
|---|---|
| `workTime` | minutes worked (not for TRIPPER) |
| `spread` | sign-on to sign-off |
| `mealBreak` | the continuous meal break — only when the form is continuous and the meal is required or was taken |
| `splitInterval` | the split interval (SPLIT) |
| `idleTime` | paid idle time — the gaps between pieces that are neither the meal nor the split interval (`IDLE_TIME`) |
| `vehicleChanges` | vehicle changes in the duty |
| `lineChanges` | line changes, counted apart from vehicle changes |
| `walkDistance` | meters walked between pieces |

Per plan:

| Criterion | Measures |
|---|---|
| `overtimeRatio` | overtime minutes as % of minutes worked |
| `splitRatio` | % of SPLIT duties |
| `tripperRatio` | % of TRIPPER duties |
| `anchored.dutyCount` | DRIVER duties over the theoretical minimum: block minutes ÷ `workTime.idealMax` |
| `anchored.efficiency` | paid minutes over covered block minutes |

The score is the weighted mean of the criteria values (0–1) on a 0–9999 scale. The solver optimizes the **raw** score — the same without the floor at 0, so a criterion past its ceiling still rewards getting closer to it.

**Not criteria.** A duty with an issue and an uncovered vehicle are unmet rules, not a matter of weight: the plan summary shows `issueDutyCount` and `uncoveredMinutes` apart from the score. The solver ranks plans by **pending duties first**, the raw score among equals (`solverRank`), and never leaves a vehicle uncovered (pieces are only ever redistributed).

---

## Construction (`solveCrewPlan`)

1. **Chains** — per block, the uncovered service spans (locked duties aside), joined across the vehicle's own intervals but never across a depot stay.
2. **A duty on one vehicle first** — each chain is cut left to right; at each position, a whole duty around one of the vehicle's idle gaps (STRAIGHT with the meal inside the piece, or SPLIT on the same vehicle), or a single piece meeting the rule without a meal. Each candidate is weighed in score units (each criterion costs `modifier × (1 − rangeV)`).
3. **Loose pieces** otherwise — about half an ideal duty, within continuous driving, never leaving a remainder shorter than the minimum piece, never crossing the vehicle's own intervals.
4. **Pairing** — loose pieces of the same operator, within walking distance, best partner first: meal between them, split, or a worked gap (never over the `idleTime` ceiling) as STRAIGHT or TRIPPER. What's left is a TRIPPER.

It runs in tens of milliseconds and covers 100%.

---

## Improvement (`CrewImprover`)

Moves, drawn at random over the current duties:

| Move | Share | What it does |
|---|---|---|
| `eliminate` | 10% | dissolves a duty (the least worked of 3 drawn): each piece — whole, or cut at a relief point into head and tail — joins the nearest duty in time that takes it, never turning a receiver into a TRIPPER |
| `shift` | 30% | the relief point between two pieces that meet on a vehicle moves up to 3 points either way |
| `swap` | 30% | two duties exchange their tails |
| `transfer` | 30% | a piece (or its head/tail) moves to another duty, or becomes a duty of its own |

Every duty a move builds follows the hard rules (`build`); a move that breaks one is dropped.

**Acceptance**, on the incremental `CrewScoreAggregate`:

- more duties with an issue — never; fewer — always;
- among equals, `eliminate` only when the raw score doesn't drop (its worsenings are much larger than the other moves' and would heat the annealing into a random walk);
- the rest anneal: better always, worse with probability `exp(Δ/T)`, `T` calibrated on the first 300 worsening moves (30% accepted at the start).

**Cycles** — `T` cools to 1% over a cycle (`min(stopMaxTotalMinutes, stopNoImprovementMinutes / 2)`), then the search goes back to the **best** duties and starts a cycle at 70% of the previous temperature. Improvements come in bursts at the end of each cycle. The best duties are kept apart from the current ones: whatever is emitted, and whatever is left when the search stops, is always the best found.

---

## Jobs and protocol

`CrewSolverService.start` loads the input once and starts `min(4, cpus − 1)` workers from different seeds. Each worker: construction → proposal 1, then improvement in 50 ms slices (the event loop turns between them, so `stop` gets through), a better proposal at most once a second, progress every 500 ms; it ends on `stop`, `stopMaxTotalMinutes` or `stopNoImprovementMinutes`, posting its best first. With `optimize: false` there is a single worker and it ends (`finished`) right after proposal 1.

The job combines them:

- **proposal** — forwarded only when it beats every search's best by `solverRank`;
- **progress** — attempts and improvements add up, the best score is the best, "since improvement" is the most recent search's;
- **done** — when the last search ends; an error only when they all failed (a failing search is logged).

| Endpoint | Effect |
|---|---|
| `POST :id/solver/start` | `{ jobId, params }` — a new generation replaces the plan's previous one |
| `SSE :id/solver/stream?jobId=` | state first (best proposal, last progress, end), then what comes next; proposals go without their duties |
| `POST :id/solver/stop` | stops every search |
| `GET :id/solver/current` | the plan's generation, running or ended and not yet used |
| `POST :id/solver/discard` | stops it and forgets it |
| `POST :id/solver/accept` | the best proposal becomes duties |
| `GET transit/crew-solver/jobs` | every plan's generation (topbar) |

Jobs live in memory (a restart loses them) until accepted, discarded or 30 min after the run ends. Access: `create` on `CrewPlan` (`read` for `current`).

### Parameters

| Param | Default | Effect |
|---|---|---|
| `base` | `complete` | **complete**: keeps the locked duties and covers the rest; **scratch**: vehicles only |
| `direction` | `balanced` | `fewer_duties` doubles `anchored.dutyCount.weight`; `fewer_paid` doubles `anchored.efficiency.weight` and `range.overtimeRatio.modifier` |
| `fareCollector` / `assistant` | off | replicate the driver duties with role `FARE_COLLECTOR` / `ASSISTANT` (same pieces and breaks) |
| `optimize` | on | off: only the construction (one worker, ends after proposal 1) |

### Accepting

A DRAFT crew plan gets the duties **in place** (every other duty goes, locked ones stay with "complete"); from an ACTIVE one a new DRAFT version is created — simulations don't pile up as versions. Numbering: locked duties keep theirs, the rest take the free numbers in start order; a replica takes its driver's number when free (D1 → C1 → A1). Rows are written in three bulk inserts, then the plan is recalculated.

---

## Frontend

- `crew-plan/[id]/components/OptimizeCrewModal.tsx` — parameters, progress (SSE), best proposal against the current plan, "Criar versão".
- Topbar of the crew plan: **Otimizar** split button — "Gerar escala" (main) and "Reduzir trocas de carro".
- `components/layout/background-jobs.tsx` — generations running in the background.
- `transit/settings/crew-settings-editor.tsx` — the settings (global / per Scope) and the plan's own copy (settings modal).

---

## Out of scope

- Moving trips between vehicles.
- Nominal schedule (people, rotations, days off).
- Own logic for fare collectors / assistants (replication only).
- An exact solution (integer programming / column generation) — would give a lower bound on the duty count.
