# Vehicle Plan Solver

> Architecture reference for the vehicle scheduling optimizer.
> Source: `apps/api/src/modules/transit/timetabling/vehicle-plan/solver/`

---

## Overview

The solver assigns transit trips to vehicle blocks, minimizing fleet size and deadrun cost subject to configurable criteria. It runs as a Node.js **worker thread** so the main NestJS process is never blocked. The host service (`VehiclePlanService`) streams progress back to the frontend via SSE while the worker iterates independently.

The current algorithm is a **Simulated Annealing (SA)** local search. It starts from the existing plan state (imported or previously solved), then explores neighboring solutions via three move types — relocate, swap, and merge — accepting worse solutions probabilistically to escape local optima.

> **Known limitation**: the current SA implementation does not yet produce meaningfully better results than the imported plan. The move design and scoring calibration need further work. This document reflects the current state as a baseline for redesign.

---

## Inputs

`SolverConfig` is passed to the worker via `workerData` at spawn time:

| Field | Type | Description |
|-------|------|-------------|
| `planId` | `string` | The plan being solved |
| `config` | `SolverPlanningConfig` | Stop conditions and scoring criteria |
| `trips` | `SolverTrip[]` | All trips to be covered — every trip must appear in exactly one block |
| `matrix` | `Record<string, SolverMatrixEntry>` | Pre-computed travel times/km between localities |
| `depots` | `string[]` | Locality IDs eligible as block starting points |
| `initialBlocks` | `SolverInitialBlock[]` | Existing block arrangement from the DB; empty array triggers full greedy construction |

### Matrix lookup

```
key: `${originId}:${destinationId}`
value: { minutes: number; km: number }
```

Same-locality moves (`from === to`) return `{ minutes: 0, km: 0 }` without a map lookup. If no matrix entry exists for a depot → trip origin pair, the solver logs a warning and falls back to that depot with zero deadrun cost (data quality issue — the locality is missing from the travel-time matrix).

### Trip constraints

`SolverTrip.constraints` carries `{ locked?: string[]; pinnedBlock?: string } | null` but is **not yet read by the solver**. Reserved for future constraint propagation.

---

## Initial Solution

`buildInitial()` constructs the starting point for the SA search:

```
if initialBlocks is non-empty:
  1. Reconstruct Block[] from the existing plan's block/trip arrangement
  2. Identify trips in cfg.trips not covered by any initial block
  3. Greedy-assign those uncovered trips into the existing blocks (or open new ones)
else:
  Full greedy construction from scratch (assignTrips over all trips)
```

This means the solver always starts from the best known state — the imported or previously optimized plan. A net-new plan with no blocks falls back to a greedy baseline.

### Greedy assignment (`assignTrips`)

Trips are sorted by `departureMinutes` and assigned one by one:

1. **Append to existing block**: find the block whose last trip's destination can reach this trip's origin with `layover ≥ 0`. Among eligible blocks, pick the one with the shortest deadrun in minutes.
2. **Open new block**: if no block is eligible, find the nearest depot that can reach the trip's origin. If no depot has a matrix entry, fall back to the first depot with zero cost and log a warning.

---

## Scoring

`scoreBlocks()` computes a single scalar score for a solution. Higher is always better. Two additive components:

```
score = flatScore + rangeScore
```

### Flat criteria (candidate level)

| Key | Quantity | Typical direction |
|-----|----------|-------------------|
| `fleetUsage` | Number of blocks | minimize |
| `deadrunKm` | Total deadrun km | minimize |
| `totalKm` | Total km (productive + deadrun) | minimize |
| `distributionVariance` | Variance of block durations (min²) | minimize |
| `specialFleetUsage` | Number of non-BUS blocks | minimize |
| `driverUsage` | *(reserved — not yet computed)* | — |
| `overtime` | *(reserved — not yet computed)* | — |

`score contribution = quantity × weight × (direction === 'minimize' ? −1 : +1)`

### Range criteria (per block, summed)

| Key | Value measured |
|-----|----------------|
| `lineTransfer` | Number of line changes within the block |
| `tripInterval` | Average layover between consecutive trips (minutes) |
| `deadrunRatio` | `deadrunKm / totalKm × 100` (%) |

Each maps to a 0–1 quality score via a trapezoid function `rangeV(value, criterion)` then multiplies by `modifier`.

### "Best" comparison

Fleet count is the primary improvement criterion; score breaks ties:

```
candidate is better if:
  candidate.blockCount < best.blockCount
  OR (candidate.blockCount === best.blockCount AND candidate.score > best.score)
```

This ensures the SA never records a solution with more vehicles as the all-time best, even if its score is higher on secondary criteria.

---

## Neighborhood Moves

At each SA iteration, one of three move types is attempted (randomly selected):

### Relocate (35%)

Remove one random trip from one block and insert it into another block at the correct chronological position. Tries other blocks in random order; accepts the first feasible insertion. If the source block becomes empty it is removed from the solution.

```
feasibility: ∀ consecutive pair (prev, cur) in modified block:
  cur.departureMinutes ≥ prev.arrivalMinutes + edge(prev.dest → cur.origin).minutes
```

### Swap (20%)

Exchange one trip from each of two randomly chosen blocks. Both blocks are re-sorted by departure time after the swap and both must remain feasible.

### Merge (45%)

Combine all trips from two randomly chosen blocks into one by sorting them by departure time and checking feasibility. Both depots are tried (block A's then block B's); accepts the first that yields a feasible sequence. A successful merge reduces fleet count by one.

Merge is weighted highest because fleet reduction is the primary optimization goal.

---

## SA Main Loop

```
buildInitial() → initial solution
score initial → bestBlocks, bestResult
post 'improvement'

loop via setImmediate:
  temp = initialTemp × 0.01^(elapsed / stopMaxTotalMinutes)
  pick random move
  apply move → neighbor (or null if infeasible)
  if neighbor:
    score neighbor
    delta = neighbor.score − current.score
    if delta > 0 OR random() < exp(delta / temp):
      current ← neighbor
    if isBetter(current, best):
      best ← current
      post 'improvement'
  attempt++
  every 250ms: post 'progress'
  check termination
```

### Temperature schedule

Time-based exponential cooling:

```
temp(t) = 5.0 × 0.01^(t / T_max)
```

- At `t = 0`: `temp = 5.0` (exploratory — accepts many worse solutions)
- At `t = T_max / 2`: `temp ≈ 0.22`
- At `t = T_max`: `temp = 0.05` (nearly greedy)

`T_max = stopMaxTotalMinutes × 60 000` ms.

### Termination conditions

| Condition | `stopReason` |
|-----------|-------------|
| `stopped` flag set via parent port | `user_stopped` |
| `elapsed ≥ stopMaxTotalMinutes × 60 000` ms | `max_time` |
| No improvement for `stopNoImprovementMinutes × 60 000` ms | `no_improvement` |

---

## Worker Thread Protocol

### Parent → Worker

| Command | Effect |
|---------|--------|
| `{ type: 'stop' }` | Sets `stopped = true`; next iteration posts `done` |

### Worker → Parent

| Message | When |
|---------|------|
| `{ type: 'progress', attempt, bestScore, bestFleet, deadrunKm, elapsed }` | Every ~250 ms |
| `{ type: 'improvement', scenario: SolverResult }` | When a new best is found |
| `{ type: 'done', stopReason }` | Once, on termination |

### Host service lifecycle

```
generate(planId, jobId):
  load trips, matrix, depots, existing blocks from DB
  filter initialBlocks to only trips present in solver's trip set
  spawn Worker({ workerData: solverConfig })
  jobs.set(jobId, { worker, best: null, planId, messages$ })

streamProgress(jobId) → Observable wrapping messages$ (SSE)

stop(jobId) → worker.postMessage({ type: 'stop' })

assumeBest(planId, jobId):
  stop worker; delete job
  in transaction: deleteMany existing blocks → createMany new blocks + blockTrips
  update plan summary (fleetCount, score, km totals, generatedAt)
```

After `done`, the job stays in memory for 30 minutes so `assumeBest` remains callable.

---

## Known Issues & Design Notes

**SA does not consistently beat the import.** The imported plan is built by a domain expert or an external tool and typically has better fleet utilization than what the current SA produces. The SA starts from that baseline but the move design and scoring weights are not yet calibrated to reliably improve it.

**Scoring scale is unknown at runtime.** Flat and range weights come from user configuration. If `fleetUsage.weight` is too low relative to other criteria, the SA may accept fleet-increasing moves freely. The temperature schedule is calibrated assuming score deltas in the 1–10 range; misconfigured weights break this assumption.

**Feasibility is only checked for inter-trip layover.** Depot → first trip reachability is not validated during moves (it's assumed correct from the initial construction). A move that changes the first trip of a block could produce an unreachable start if the matrix is sparse.

**No constraint propagation.** `pinnedBlock` and `locked` constraints in `SolverTrip.constraints` are ignored. All trips are freely movable.

**No look-ahead.** `findBestBlock` uses a greedy local criterion (minimum deadrun to the next trip) without considering how the choice affects future assignments.
