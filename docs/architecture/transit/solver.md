# Vehicle Plan Solver

> Architecture reference for the vehicle scheduling optimizer.
> Source: `apps/api/src/modules/transit/timetabling/vehicle-plan/solver/`

---

## Overview

The solver assigns transit trips to vehicle blocks, minimizing fleet size and deadrun cost subject to configurable criteria. It runs as a Node.js **worker thread** so the main NestJS process is never blocked. The host service (`VehiclePlanService`) streams progress back to the frontend via SSE while the worker iterates independently.

The algorithm is a **randomized constructive heuristic**: each iteration builds a complete block assignment from scratch by shuffling the trip order, then greedy-assigning trips to existing blocks or opening new ones. Many random orderings are evaluated in rapid succession; the best-scoring result across all iterations is retained.

---

## Inputs

`SolverConfig` is passed to the worker via `workerData` at spawn time:

| Field | Type | Description |
|-------|------|-------------|
| `planId` | `string` | The plan being solved (used for logging/assume) |
| `config` | `SolverPlanningConfig` | Stop conditions and scoring criteria |
| `trips` | `SolverTrip[]` | All trips to be covered — every trip must appear in exactly one block |
| `matrix` | `Record<string, SolverMatrixEntry>` | Pre-computed travel times/km between localities |
| `depots` | `string[]` | Locality IDs eligible as block starting points |

### Trip constraints (future)

`SolverTrip.constraints` is typed as `{ locked?: string[]; pinnedBlock?: string } | null` but is **not yet read by the solver**. The field is reserved for future constraint propagation (locking a trip to a specific block, or preventing a trip from being reassigned).

### Matrix lookup

```
key: `${originId}:${destinationId}`
value: { minutes: number; km: number }
```

Same-locality moves (`from === to`) return `{ minutes: 0, km: 0 }` without a map lookup. If no edge exists between two localities, the block cannot serve that trip.

---

## Algorithm: Randomized Greedy Construction

Each call to `evaluateCandidate()` produces one complete vehicle schedule:

```
1. Copy and shuffle the trip array  (Fisher-Yates)
2. Sort by departureMinutes         (stable chronological order within shuffle)
3. For each trip in order:
   a. findBestBlock → assign to existing block with minimum deadrun
   b. If no block can reach the trip in time → findBestDepot → open new block
   c. If no depot has a path to the trip → return null (invalid candidate, discarded)
4. Score the resulting block set
```

The shuffle in step 1 is the source of randomness. Sorting after shuffling preserves chronological trip order but breaks ties between trips at the same minute using the shuffle — this changes which block "wins" a contested trip across iterations.

### `findBestBlock`

Scans all open blocks and selects the one with the **shortest deadrun** (in minutes) to reach the trip's origin:

```
layover = trip.departureMinutes − (block.lastArrivalMinutes + edge.minutes)
```

A block is eligible only when:
- `layover ≥ 0` — the block arrives in time with no overlap
- `edge` exists in the matrix (path between localities is known)
- `block.vehicleType` matches `trip.requiredVehicleType` (when constrained)

Among all eligible blocks, the one with the smallest `edge.minutes` is chosen. This is a greedy local criterion — it does not consider how the choice affects future trips.

### `findBestDepot`

When no existing block can serve a trip, a new block is opened. The depot closest (in minutes) to the trip's origin is selected. `block.startMinutes` is set to `trip.departureMinutes − depot.edge.minutes`.

---

## Scoring

`scoreBlocks()` computes a single scalar score for a candidate. Higher is always better. The score has two additive components:

```
score = flatScore + rangeScore
```

### Flat criteria

Applied at the **candidate level** (aggregate values across all blocks). Each criterion is independently active/inactive:

| Key | Quantity measured | Typical direction |
|-----|-------------------|-------------------|
| `fleetUsage` | Number of blocks | minimize |
| `deadrunKm` | Total deadrun km | minimize |
| `totalKm` | Total km (productive + deadrun) | minimize |
| `distributionVariance` | Variance of block durations (minutes²) | minimize |
| `specialFleetUsage` | Number of non-BUS blocks | minimize |
| `driverUsage` | *(reserved — not yet computed)* | — |
| `overtime` | *(reserved — not yet computed)* | — |

`score contribution = quantity × weight × (direction === 'minimize' ? −1 : +1)`

`driverUsage` and `overtime` are present in `SolverPlanningConfig` but are not wired into `scoreBlocks`. They exist for future crew-scheduling integration.

### Range criteria

Applied **per block**, then summed. Each criterion maps a measured value to a 0–1 quality score using a trapezoid function, then multiplies by a `modifier` weight:

```
rangeScore += modifier × rangeV(value, criterion)
```

| Key | Value measured per block |
|-----|--------------------------|
| `lineTransfer` | Number of line changes within the block |
| `tripInterval` | Average layover between trips (minutes) |
| `deadrunRatio` | `deadrunKm / totalKm × 100` (%) |

### Trapezoid function `rangeV(value, c)`

```
value ≤ floor:               0   (or 1 if floor ≥ idealMin — degenerate config)
floor < value < idealMin:    linear ramp from 0 → 1
idealMin ≤ value ≤ idealMax: 1   (ideal zone)
idealMax < value < ceiling:  linear ramp from 1 → 0
value ≥ ceiling:             0
```

This lets the operator express preferences like "a block should have between 8 and 12 trips between line changes" without hard constraints — values outside the ideal zone are penalised proportionally.

---

## Iteration Loop

The main loop runs via `setImmediate` chains, yielding control between iterations so the worker thread can receive `stop` commands from the parent port without blocking:

```
setImmediate(runIteration)

runIteration():
  if stopped → post 'done' (user_stopped) → return
  result = evaluateCandidate()
  attempt++
  if result > bestResult → bestResult = result; post 'improvement'
  post 'progress'
  check termination conditions
  setImmediate(runIteration)   ← schedules next iteration
```

### Termination conditions

Checked at the end of each iteration, in priority order:

| Condition | `stopReason` |
|-----------|-------------|
| `stopped` flag set (parent port command) | `user_stopped` |
| `elapsed ≥ stopMaxTotalMinutes × 60 000` | `max_time` |
| `Date.now() − lastImprovementTime ≥ stopNoImprovementMinutes × 60 000` | `no_improvement` |

`no_improvement` resets on every score improvement, so a solver that keeps finding better solutions will run indefinitely until one of the other conditions fires.

---

## Worker Thread Protocol

### Parent → Worker

| Command | Effect |
|---------|--------|
| `{ type: 'stop' }` | Sets `stopped = true`; next iteration posts `done` and exits |

### Worker → Parent

| Message | When |
|---------|------|
| `{ type: 'progress', attempt, bestScore, bestFleet, deadrunKm, elapsed }` | Every iteration |
| `{ type: 'improvement', scenario: SolverResult }` | When a new best is found |
| `{ type: 'done', stopReason }` | Once, on termination |

`progress` is posted even when no improvement occurred, so the frontend always receives a heartbeat. `improvement` carries the full `SolverResult` (all blocks and their trips), which the host service stores as `job.best` for eventual `assumeBest`.

### Host service lifecycle

```
generate(planId, jobId):
  spawn Worker(workerFile, { workerData: solverConfig })
  jobs.set(jobId, { worker, best: null, planId, messages$ })
  worker.on('message') → store best; forward to messages$ Subject

streamProgress(jobId):
  return Observable wrapping messages$ (SSE source)

stop(jobId):
  job.worker.postMessage({ type: 'stop' })

assumeBest(planId, jobId):
  stop worker
  delete job from map
  write job.best to DB inside a transaction
  (deleteMany existing blocks for plan, then createMany new blocks + blockTrips)
```

After `done` is received, the job remains in the map for 30 minutes so `assumeBest` can still be called. The worker thread exits on its own once it posts `done`.

---

## Design Notes

**No local search.** The solver is purely constructive — it never modifies an existing candidate. Each iteration is independent. Adding neighborhood search (2-opt swap, trip re-insertion) could dramatically improve solution quality for large plans but would increase iteration time.

**Selection criterion is local, not global.** `findBestBlock` picks the block with the smallest deadrun to the next trip. This greedy choice is fast but may not minimize the global deadrun: a longer deadrun now might enable better assignments for future trips. A look-ahead or cost-matrix approach would improve quality at the cost of O(n²) per-trip work.

**Shuffle breaks symmetry, not deadlocks.** The randomness comes entirely from trip ordering. Two trips at the same minute will be assigned in different order across iterations, potentially routing them to different blocks. This is the main lever for exploring the solution space.

**Invalid candidates are silently discarded.** If `findBestDepot` returns null (no depot has a path to the trip's origin), `evaluateCandidate` returns null and the iteration is counted but not compared. This can happen if the travel-time matrix is incomplete.

**Score is not normalized.** Flat and range components use raw weights and quantities, so the absolute score value is meaningless across different plan configurations. Only relative comparison within a single solver run matters.
