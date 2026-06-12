# Vehicle Plan Solver

> Architecture reference for the vehicle scheduling optimizer.
> Source: `apps/api/src/modules/transit/timetabling/vehicle-plan/solver/`

---

## Overview

The solver assigns transit trips to vehicle blocks, minimizing fleet size and deadrun cost subject to configurable criteria. It runs as a Node.js **worker thread** so the main NestJS process is never blocked. The host service (`VehiclePlanService`) streams progress back to the frontend via SSE.

Two execution modes are available, each backed by a separate worker file:

| Mode | Worker | Approach |
|------|--------|----------|
| **Quick** | `solver.deterministic.worker.ts` | Deterministic staged construction — same inputs and parameters always produce the same result |
| **Expanded** | `solver.stochastic.worker.ts` | Stochastic Simulated Annealing — probabilistic exploration, can run for hours, emits multiple proposals over time |

Both modes run the same three-stage pipeline (fleet optimization → driver optimization → multi-operator distribution) and share the same scoring module (`solver.scoring.ts`) and type definitions (`solver.types.ts`).

---

## Generation Parameters

When the user clicks **Gerar** in the grid, a modal collects execution parameters before spawning the worker.

### Type

| Option | Description |
|--------|-------------|
| Quick | Deterministic — near-instant, predictable, bounded number of proposals |
| Expanded | Stochastic — may run for hours, explores a wider solution space |

### Checkboxes

| Option | Default | Effect |
|--------|---------|--------|
| Redistribute trips | ✓ | If unchecked, solver skips all construction stages and only scores the current plan |
| Allow shared operation | ✗ | Enables Stage 3 multi-operator block distribution |
| Review cycle time | ✗ | Reserved for future implementation |
| Include access and collection | ✓ | Generates depot departure/arrival deadrun legs at block start and end |

> When **Include access and collection** is checked, synthetic depot deadrun legs are created at the start and end of each block. If the solver changes the first or last trip of a block, any previously generated depot deadrun is replaced to match the new reality — old values are never preserved.

### Direction

Controls which stage and scoring weights are emphasized:

| Option | Effect |
|--------|--------|
| Automatic | Default weight balance across all criteria |
| Optimize fleet | Increases `fleetUsage` weight — Stage 1 focus |
| Optimize drivers | Activates driver-related criteria — Stage 2 focus |
| Optimize overtime | Minimizes overtime — Stage 2 focus (reserved) |

### Advanced

Displays the full `SolverPlanningConfig`, allowing per-plan overrides of any individual parameter. Customized values are persisted as a **full config copy** to `vehiclePlan.metrics` — not a diff. When a plan has custom metrics, the global `transitSettings.planningConfig` is ignored entirely for that plan.

Plans with custom metrics are visually flagged in both the list view and the grid. A **Clear customization** button removes the plan-level overrides and restores the global settings default for the next generation.

---

## Inputs

`SolverConfig` is passed to the worker via `workerData` at spawn time:

| Field | Type | Description |
|-------|------|-------------|
| `planId` | `string` | The plan being solved |
| `config` | `SolverPlanningConfig` | Stop conditions and scoring criteria (from `vehiclePlan.metrics` or global settings) |
| `trips` | `SolverTrip[]` | All in-scope trips — every trip must appear in exactly one block in the result |
| `matrix` | `Record<string, SolverMatrixEntry>` | Pre-computed travel times and km between localities |
| `depots` | `string[]` | Locality IDs eligible as block starting points |
| `initialBlocks` | `SolverInitialBlock[]` | Locked blocks passed in unchanged; empty = full construction from scratch |

### Matrix lookup

```
key: `${originId}:${destinationId}`
value: { minutes: number; km: number }
```

Used exclusively for **deadrun** legs (depot → first trip, and between consecutive trips within a block). Same-locality transitions (`from === to`) return `{ minutes: 0, km: 0 }` without a map lookup. Missing entries are treated as zero cost and trigger a console warning (data quality issue).

### Productive km per trip (`tripKm`)

`SolverTrip.tripKm` carries the pre-computed productive distance for each trip, resolved by the host service before spawning the worker:

```
tripKm = line.metrics.extensionKm[route.direction]   // primary source
      ?? matrix[origin:destination].km                // fallback
      ?? 0
```

The matrix is **not** consulted for productive km inside the worker or scorer. This value is static for the duration of the solve.

### Constraints

**Trip-level** (`SolverTrip.constraints`):

```typescript
{
  locked?:      string[]   // block IDs this trip may not enter
  pinnedBlock?: string     // trip cannot leave this block ID
}
```

**Block-level** (`VehicleBlock.constraints`):

```typescript
{ locked: true }   // entire block is frozen — no trips added, removed, or reordered
```

Locked blocks enter the solver unchanged and are excluded from all construction stages. Trips with `pinnedBlock` cannot be reassigned to a different block.

### Branch scope

Each `VehicleBlock` carries a `branchId`. The solver only receives blocks whose `branchId` matches the current user's accessible branches. Blocks from other branches are visible in the grid as **disabled** (read-only), but are entirely excluded from the solver's working set — their trips are not in scope and the solver does not interact with them.

---

## Solver Scope

1. User selects one or more lines in the grid filter
2. All blocks that contain at least one trip from those lines are loaded — including any trips from other lines already present in those blocks
3. Blocks from inaccessible branches (other operators) are excluded
4. Locked blocks are extracted and placed directly in `initialBlocks` (carried unchanged)
5. The remaining blocks' trips form the working trip set for the construction stages

> **Example:** line 204 selected → loads 20 trips from line 204 and 1 trip from line 205 already present in a line-204 block → solver scope = 21 trips.

Lines with no editable blocks for the user's branch are silently ignored by **Plotar** and **Gerar** — the filter itself is not modified.

---

## Scoring

`scoreBlocks()` in `solver.scoring.ts` computes a single scalar score for a complete solution. Higher is always better. The function is shared between the workers and `VehiclePlanService.scorePlan()`.

```
score = flatScore + rangeScore
```

### Flat criteria (solution level)

Applied once per solution using aggregate quantities across all blocks:

| Key | Quantity | Direction |
|-----|----------|-----------|
| `fleetUsage` | Number of blocks | minimize |
| `deadrunKm` | Total deadrun km | minimize |
| `totalKm` | Total km (productive + deadrun) | minimize |
| `distributionVariance` | **Std deviation** of block durations (min) | minimize |
| `specialFleetUsage` | Trips with unmet vehicle type requirement | minimize |
| `driverUsage` | *(reserved — not yet computed)* | — |
| `overtime` | *(reserved — not yet computed)* | — |

```
flatScore contribution = quantity × weight × (direction === 'minimize' ? −1 : +1)
```

**`specialFleetUsage`** counts trips where `requiredVehicleType` is set and does not match the block's `vehicleType`. If a STANDARD block contains two trips requiring ARTICULATED, the penalty is applied twice. Trips with `requiredVehicleType = null` never contribute to this count.

**Suggested starting weights:**

```
fleetUsage:           weight = 1000
deadrunKm:            weight = 3
totalKm:              inactive
distributionVariance: weight = 2
specialFleetUsage:    weight = 200
```

With a 100-block plan and ~3 000 km deadrun, this yields an initial score around −109 000. Removing one block contributes +1 000; saving 100 km deadrun contributes +300.

### Range criteria (per block, summed)

Each criterion maps a per-block value to a 0–1 quality score via a trapezoid function `rangeV(value, criterion)`, then multiplies by `modifier`. Scores are summed across all blocks.

| Key | Value measured | Suggested modifier |
|-----|----------------|--------------------|
| `lineTransfer` | ** Line changes within the block | 1.5 |
| `tripInterval` | ** Layover between consecutive trips (min) | 0.3 |
| `deadrunRatio` | `deadrunKm / totalKm × 100` (%) | 1 |
| `minBlockDuration` | Block total duration (min) — vehicle utilization quality (planning phase) | 1 |

** Score and penalties applied per occurrence. [pending review]


**`minBlockDuration` default values (planning phase):**

```
floor=180, idealMin=420, idealMax=900, ceiling=1080
```

This criterion contributes to the score and also serves as a **construction threshold** in Quick mode (see Stages 1.2 and 1.3).

---

## Quick Mode — Deterministic Staged Construction

Produces a solution by sequentially applying construction stages. The output is fully deterministic for a given set of inputs and parameters. Each stage emits a **proposal** if its result improves on the previous best; the badge counter increments accordingly. The maximum number of proposals equals the number of active stages.

### Stage 1 — Fleet Optimization

#### 1.1 Line-first construction

All in-scope trips are sorted by departure time and assigned greedily to blocks. In this first pass, each block is restricted to trips from a **single line**.

A trip is appended to an existing block if:
- The block already serves the same line
- The inter-trip layover is ≥ `tripInterval.idealMin`
- The block's vehicle type matches the trip's `requiredVehicleType` (or the trip has no requirement)

If no existing block qualifies, a new block is opened using the nearest reachable depot from the matrix. [pending review]
[!!] Not all depots can be used in a simulation; some depots are exclusive to certain operators. The solver needs to know which depots are available for simulation.


Locked blocks are already present in the solution and are not touched by this stage.

> **Rationale:** mixing trips from different lines requires deadrun connections between service areas, increases wear, and produces harder-to-maintain schedules. Single-line blocks are the natural baseline before cross-line merging is evaluated.

#### 1.2 Multi-line merging — zero deadrun

Attempts to concatenate blocks from different lines where the last trip's **destination locality** of one block equals the first trip's **origin locality** of another (same point — no deadrun required).

**Quick:** only runs if at least one block has a total duration below `minBlockDuration.idealMin`.  
**Expanded:** always runs.

Candidate pairs are ranked deterministically by the duration gain of the merge; ties are broken by line code order. A merge is accepted only if the resulting block is feasible at every inter-trip position (layover ≥ 0).

#### 1.3 Multi-line merging — with deadrun

Attempts merges where the connection between blocks requires a deadrun leg through the travel-time matrix.

**Quick:** only runs if at least one block has a duration below `minBlockDuration.floor`.  
**Expanded:** runs if any block is below `minBlockDuration.idealMin`.

Only pairs with a matrix entry for the required origin → destination transition are considered. Simulation is deterministic in Quick mode and randomized in Expanded mode.

### Stage 2 — Driver and Journey Optimization

Constructs driver shift blocks from the vehicle blocks produced in Stage 1. **Not yet implemented — mapped for a future phase.**

### Stage 3 — Multi-operator Distribution

Distributes blocks across branches when **Allow shared operation** is enabled, using `VehicleBlock.branchId` as the operator identifier. **Not yet implemented — mapped for a future phase.**

---

## Expanded Mode — Stochastic SA

Uses the same three-stage structure as Quick but replaces deterministic construction with Simulated Annealing exploration. Randomization allows the algorithm to escape local optima. Multiple proposals may be emitted throughout the run; the badge counter reflects how many times a new best solution was found.

### Temperature schedule

Temperature is **auto-calibrated** to the magnitude of the initial solution's score rather than using a hardcoded value:

```
initialTemp = |initialScore| × 0.02
finalTemp   = initialTemp × 0.01

temp(t) = initialTemp × (finalTemp / initialTemp)^(t / T_max)
```

At `initialTemp`, a move that worsens the score by `initialTemp` is accepted with probability `exp(−1) ≈ 37%`, enabling broad exploration. At `finalTemp`, only near-zero worsening is accepted.

`T_max = stopMaxTotalMinutes × 60 000` ms.

### Move types

| Move | Weight | Description |
|------|--------|-------------|
| Relocate | 35% | Remove one trip from a block and insert it into another at the correct chronological position |
| Swap | 20% | Exchange one trip between two randomly chosen blocks |
| Merge | 45% | Combine all trips from two blocks into one if the interleaved sequence is feasible |

Merge is weighted highest because fleet count reduction is the primary optimization goal.

### Feasibility check

A block is feasible if for every consecutive trip pair:

```
trip[i].departureMinutes ≥ trip[i-1].arrivalMinutes + edge(prev.dest → cur.origin).minutes
```

### Termination conditions

| Condition | `stopReason` |
|-----------|-------------|
| `stopped` flag set via parent port | `user_stopped` |
| `elapsed ≥ stopMaxTotalMinutes × 60 000` ms | `max_time` |
| No improvement for `stopNoImprovementMinutes × 60 000` ms | `no_improvement` |

---

## Worker Architecture

Two separate worker files, selected by the host service based on the chosen mode:

```
solver/
  solver.types.ts                    — shared interfaces (SolverConfig, SolverTrip, etc.)
  solver.scoring.ts                  — shared scoring (`scoreBlocks`, `findMatrixMisses`), callable from main thread and workers
  solver.deterministic.worker.ts     — Quick mode implementation
  solver.stochastic.worker.ts        — Expanded mode implementation (current: solver.worker.ts)
```

The host service selects the worker file at spawn time:

```typescript
const workerFile = mode === 'quick'
  ? './solver/solver.deterministic.worker'
  : './solver/solver.stochastic.worker'
```

### Host service lifecycle

```
generate(planId, jobId, mode, params):
  load trips (with route.direction + line.metrics), matrix, depots, blocks from DB
  apply branch scope filter — exclude blocks from inaccessible branches
  extract locked blocks → initialBlocks
  compute tripKm per trip: line.metrics.extensionKm[direction] ?? matrix[o:d].km ?? 0
  resolve config: vehiclePlan.metrics ?? globalSettings.planningConfig
  adjust flat weights based on Direction param
  spawn Worker(workerFile, { workerData: solverConfig })
  jobs.set(jobId, { worker, proposals: [], planId, messages$ })

streamProgress(jobId) → Observable wrapping messages$ (SSE)

stop(jobId) → worker.postMessage({ type: 'stop' })

assumeBest(planId, jobId):
  stop worker; retrieve latest best proposal; delete job
  in transaction:
    delete all non-locked existing blocks for the plan
    insert accepted proposal's blocks and blockTrips
    identify blocks from other lines that previously shared in-scope trips → mark isStale = true
  update plan summary (fleetCount, score, km totals rounded to 2 dp, generatedAt)

scorePlan(planId):
  load blocks + trips (with route.direction + line.metrics) + matrix from DB
  compute tripKm per trip (same resolution rule as generate)
  call scoreBlocks() → write summary + generatedAt to vehiclePlan
  call findMatrixMisses() → if any depot→trip or trip→trip pairs are absent from the matrix,
    store them as summary.errors.missingMatrix [{ origin, destination }]
  called automatically by VehiclePlanImportService after each import
```

After `done`, the job stays in memory for 30 minutes so `assumeBest` remains callable.

---

## Progress Protocol

### Parent → Worker

| Command | Effect |
|---------|--------|
| `{ type: 'stop' }` | Sets `stopped = true`; next iteration posts `done` and exits |

### Worker → Parent

```typescript
type SolverMessage =
  | {
      type:      'progress'
      stage:     number
      attempt:   number
      bestScore: number
      bestFleet: number
      elapsed:   number
    }
  | {
      type:          'proposal'       // emitted when a stage improves on the previous best
      stage:         number
      stageLabel:    string
      scenario:      SolverResult
      proposalIndex: number           // 1-based, cumulative across stages
    }
  | {
      type:          'improvement'    // Expanded mode only — each time SA finds a new best
      scenario:      SolverResult
      proposalIndex: number
    }
  | {
      type:          'done'
      stopReason:    'no_improvement' | 'max_time' | 'user_stopped'
      totalAttempts: number
    }
```

### Summary display

```
LVL 1 FLEET  — {elapsed}  [{totalAttempts}][+{proposals}][-{fleetGain}]               [Details]
LVL 2 DRIVER — {elapsed}  [{totalAttempts}][+{proposals}][-{fleetGain}][-{driverGain}]  [Details]
```

- `proposals` — cumulative count of better proposals found across all stages, starting at 0
- `fleetGain` — fleet count reduction of the best proposal vs the original plan
- Each completed stage appends its own gain badge
- In Quick mode `proposals` is bounded by the number of stages; in Expanded mode it grows throughout the run

---

## Accepting a Proposal

When the user accepts a proposal:

1. The worker is stopped
2. In a single transaction:
   - All non-locked existing blocks for the plan are deleted
   - The accepted proposal's blocks and block trips are inserted
   - Any blocks from other lines that previously contained in-scope trips are identified and marked `isStale = true`
3. The final `summary` and `generatedAt` are written to the plan record

> In Quick mode, blocks are fully reconstructed from scratch, making partial-loss scenarios uncommon. The `isStale` flag is retained for edge cases and for compatibility with future partial-scope optimizations.

---

## Known Issues & Design Notes

**Quick mode (deterministic worker) is not yet implemented.** The current codebase contains only the stochastic SA worker (`solver.worker.ts`, to be renamed `solver.stochastic.worker.ts`). The deterministic staged construction described in this document is the planned target implementation.

**SA (Expanded) does not improve the imported plan in its current state.** Root cause: the hardcoded `initialTemp = 5.0` is orders of magnitude smaller than typical per-move score deltas (hundreds to thousands). This causes `exp(delta/temp) ≈ 0` for any non-trivial worsening, reducing the SA to a greedy search. A greedy search starting from a human-optimized plan finds no improvements. Fix: auto-calibrate temperature to the initial score magnitude. Not yet applied.

**Score is always negative with minimize-only criteria.** All flat criteria currently configured use `direction: minimize`. The score is a relative metric for comparing two solutions (higher = better), not an absolute quality indicator. Range criteria add positive values but do not compensate the flat penalties at typical scales.

**`distributionVariance` weight calibration.** The quantity is **standard deviation** (minutes), not variance (min²). Weights configured for the old variance scale will produce much smaller penalties — recalibrate accordingly.

**Feasibility only checks inter-trip layover.** Depot → first trip reachability is not validated during SA moves. A move that changes the first trip of a block could silently produce an unreachable depot start if the matrix is sparse.

**Trip constraints are not yet enforced by the SA worker.** `pinnedBlock` and `locked` in `SolverTrip.constraints`, and `locked` in `VehicleBlock.constraints`, are not read by the current implementation. All trips and blocks are freely modifiable.

**Stage 2 and Stage 3 are not implemented.** Driver optimization and multi-operator distribution are mapped for future phases and have no worker code yet.
