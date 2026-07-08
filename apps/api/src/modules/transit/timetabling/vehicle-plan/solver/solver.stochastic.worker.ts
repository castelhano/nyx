import { workerData, parentPort, isMainThread } from 'worker_threads'
import type {
  SolverConfig,
  SolverTrip,
  SolverMatrixEntry,
  SolverResult,
  SolverMessage,
  WorkerCommand,
} from './solver.types'
import { getEdge, scoreBlocks, type ScoringBlock } from './solver.scoring'

if (isMainThread) process.exit(1)

const cfg    = workerData as SolverConfig
let stopped  = false
let doneSent = false

parentPort!.on('message', (cmd: WorkerCommand) => {
  if (cmd.type === 'stop') stopped = true
})

process.on('uncaughtException', (err) => {
  console.error('[solver-stochastic] uncaughtException:', err)
  if (!doneSent) {
    doneSent = true
    parentPort?.postMessage({ type: 'done', stopReason: 'no_improvement', totalAttempts: 0 } satisfies SolverMessage)
  }
})

// ─── types ───────────────────────────────────────────────────────────────────

type Block = ScoringBlock & { trips: SolverTrip[]; locked: boolean }

let nextBlockId = 0

// ─── helpers ─────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function insertSorted(trips: SolverTrip[], trip: SolverTrip): SolverTrip[] {
  const idx = trips.findIndex(t => t.departureMinutes > trip.departureMinutes)
  return idx === -1 ? [...trips, trip] : [...trips.slice(0, idx), trip, ...trips.slice(idx)]
}

// ─── feasibility ─────────────────────────────────────────────────────────────

function feasible(block: Block, matrix: Record<string, SolverMatrixEntry>): boolean {
  for (let i = 1; i < block.trips.length; i++) {
    const prev = block.trips[i - 1]
    const cur  = block.trips[i]
    const edge = getEdge(matrix, prev.destinationLocalityId, cur.originLocalityId)
    if (!edge) return false
    if (cur.departureMinutes < prev.arrivalMinutes + edge.minutes) return false
  }
  return true
}

function scoreAll(
  blocks: Block[],
  matrix: Record<string, { minutes: number; km: number }>,
  config: SolverConfig['config'],
): SolverResult {
  return scoreBlocks(blocks, matrix, config)
}

// ─── construction ─────────────────────────────────────────────────────────────

function assignTrips(
  unassigned: SolverTrip[],
  blocks: Block[],
  matrix: Record<string, SolverMatrixEntry>,
  depots: string[],
): void {
  const sorted = [...unassigned].sort((a, b) => a.departureMinutes - b.departureMinutes)

  for (const trip of sorted) {
    let bestBlock:   Block | null = null
    let bestDeadrun: number = Infinity

    for (const block of blocks) {
      if (block.locked) continue
      const last = block.trips[block.trips.length - 1]
      if (trip.requiredVehicleType && block.vehicleType !== trip.requiredVehicleType) continue
      const edge = getEdge(matrix, last.destinationLocalityId, trip.originLocalityId)
      if (!edge) continue
      const layover = trip.departureMinutes - (last.arrivalMinutes + edge.minutes)
      if (layover < 0) continue
      if (edge.minutes < bestDeadrun) {
        bestDeadrun = edge.minutes
        bestBlock   = block
      }
    }

    if (bestBlock) {
      bestBlock.trips = insertSorted(bestBlock.trips, trip)
    } else {
      let bestDepot:    string | null = null
      let bestDepotMin: number = Infinity
      for (const depotId of depots) {
        const edge = getEdge(matrix, depotId, trip.originLocalityId)
        if (!edge) continue
        if (edge.minutes < bestDepotMin) {
          bestDepotMin = edge.minutes
          bestDepot    = depotId
        }
      }
      if (!bestDepot) {
        console.warn(`[solver-stochastic] no matrix entry for depot→${trip.originLocalityId}; using fallback depot for trip ${trip.id}`)
        bestDepot = depots[0]
      }

      blocks.push({
        id:          nextBlockId++,
        depotId:     bestDepot,
        vehicleType: trip.requiredVehicleType ?? 'STANDARD',
        trips:       [trip],
        locked:      false,
      })
    }
  }
}

function buildInitial(
  trips: SolverTrip[],
  matrix: Record<string, SolverMatrixEntry>,
  depots: string[],
): Block[] {
  const { initialBlocks } = cfg
  const blocks: Block[] = []

  if (initialBlocks.length > 0) {
    const tripMap  = new Map(trips.map(t => [t.id, t]))
    const assigned = new Set<string>()

    for (const ib of initialBlocks) {
      const ibTrips = ib.tripIds
        .map(id => tripMap.get(id))
        .filter((t): t is SolverTrip => t !== undefined)
      if (ibTrips.length === 0) continue
      ibTrips.forEach(t => assigned.add(t.id))
      blocks.push({
        id:          nextBlockId++,
        depotId:     ib.depotId,
        vehicleType: ib.vehicleType,
        trips:       ibTrips.sort((a, b) => a.departureMinutes - b.departureMinutes),
        locked:      ib.locked ?? false,
      })
    }

    const unassigned = trips.filter(t => !assigned.has(t.id))
    if (unassigned.length > 0) assignTrips(unassigned, blocks, matrix, depots)
  } else {
    assignTrips(trips, blocks, matrix, depots)
  }

  return blocks
}

// ─── neighborhood moves ──────────────────────────────────────────────────────

// Relocate: move one random trip from one block to another
function moveRelocate(
  blocks: Block[],
  matrix: Record<string, SolverMatrixEntry>,
): Block[] | null {
  if (blocks.length < 2) return null

  const mutable = blocks.filter(b => !b.locked)
  if (mutable.length < 1) return null

  const fromIdx  = Math.floor(Math.random() * mutable.length)
  const from     = mutable[fromIdx]
  const tripIdx  = Math.floor(Math.random() * from.trips.length)
  const trip     = from.trips[tripIdx]

  const candidates = shuffle(blocks.filter(b => b !== from && !b.locked))

  for (const to of candidates) {
    if (trip.requiredVehicleType && to.vehicleType !== trip.requiredVehicleType) continue

    const newTo: Block = { ...to, trips: insertSorted(to.trips, trip) }
    if (!feasible(newTo, matrix)) continue

    const newFrom: Block = { ...from, trips: from.trips.filter((_, i) => i !== tripIdx) }
    return blocks
      .map(b => b === from ? newFrom : b === to ? newTo : b)
      .filter(b => b.trips.length > 0)
  }

  return null
}

// Swap: exchange one trip from each of two random non-locked blocks
function moveSwap(
  blocks: Block[],
  matrix: Record<string, SolverMatrixEntry>,
): Block[] | null {
  const mutable = blocks.filter(b => !b.locked)
  if (mutable.length < 2) return null

  const i1 = Math.floor(Math.random() * mutable.length)
  let   i2 = Math.floor(Math.random() * (mutable.length - 1))
  if (i2 >= i1) i2++

  const b1  = mutable[i1]
  const b2  = mutable[i2]
  const t1i = Math.floor(Math.random() * b1.trips.length)
  const t2i = Math.floor(Math.random() * b2.trips.length)
  const t1  = b1.trips[t1i]
  const t2  = b2.trips[t2i]

  if (t1.requiredVehicleType && b2.vehicleType !== t1.requiredVehicleType) return null
  if (t2.requiredVehicleType && b1.vehicleType !== t2.requiredVehicleType) return null

  const new1Trips = [...b1.trips.slice(0, t1i), t2, ...b1.trips.slice(t1i + 1)]
    .sort((a, b) => a.departureMinutes - b.departureMinutes)
  const new2Trips = [...b2.trips.slice(0, t2i), t1, ...b2.trips.slice(t2i + 1)]
    .sort((a, b) => a.departureMinutes - b.departureMinutes)

  const nb1: Block = { ...b1, trips: new1Trips }
  const nb2: Block = { ...b2, trips: new2Trips }
  if (!feasible(nb1, matrix) || !feasible(nb2, matrix)) return null

  return blocks.map(b => b === b1 ? nb1 : b === b2 ? nb2 : b)
}

// Merge: combine all trips from two random non-locked blocks if feasible
function moveMerge(
  blocks: Block[],
  matrix: Record<string, SolverMatrixEntry>,
): Block[] | null {
  const mutable = blocks.filter(b => !b.locked)
  if (mutable.length < 2) return null

  const i1 = Math.floor(Math.random() * mutable.length)
  let   i2 = Math.floor(Math.random() * (mutable.length - 1))
  if (i2 >= i1) i2++

  const b1 = mutable[i1]
  const b2 = mutable[i2]
  if (b1.vehicleType !== b2.vehicleType) return null

  const combined = [...b1.trips, ...b2.trips]
    .sort((a, b) => a.departureMinutes - b.departureMinutes)

  for (const depotId of [b1.depotId, b2.depotId]) {
    const merged: Block = { id: b1.id, depotId, vehicleType: b1.vehicleType, trips: combined, locked: false }
    if (feasible(merged, matrix)) {
      return [...blocks.filter(b => b !== b1 && b !== b2), merged]
    }
  }

  return null
}

// ─── main loop (simulated annealing) ─────────────────────────────────────────

let attempt             = 0
let proposalIndex       = 0
let bestBlocks:         Block[] = []
let bestResult:         SolverResult | null = null
let lastImprovementTime = Date.now()
const startTime         = Date.now()
let lastProgressTime    = Date.now()

// Plan baseline — only emit improvements that strictly beat the stored plan
const planFleet = cfg.currentPlanFleetCount ?? Infinity
const planScore = cfg.currentPlanScore ?? -Infinity

function post(msg: SolverMessage): void {
  parentPort!.postMessage(msg)
}

function isBetter(candidate: Block[], candidateResult: SolverResult): boolean {
  if (!bestResult) return true
  if (candidate.length < bestBlocks.length) return true
  if (candidate.length > bestBlocks.length) return false
  return candidateResult.score > bestResult.score
}

function beatsPlan(candidate: Block[], result: SolverResult): boolean {
  if (candidate.length < planFleet) return true
  if (candidate.length > planFleet) return false
  return result.score > planScore
}

const initial = buildInitial(cfg.trips, cfg.matrix, cfg.depots)

if (initial.length === 0) {
  console.error(`[solver-stochastic] no blocks could be built. trips=${cfg.trips.length} depots=${cfg.depots.length}`)
  post({ type: 'done', stopReason: 'no_improvement', totalAttempts: 0 })
} else {
  let current       = initial
  let currentResult = scoreAll(current, cfg.matrix, cfg.config)
  bestBlocks        = initial
  bestResult        = currentResult

  if (beatsPlan(initial, currentResult)) {
    proposalIndex++
    post({ type: 'improvement', scenario: bestResult, proposalIndex })
  }

  const totalMs     = cfg.config.stopMaxTotalMinutes * 60_000
  // auto-calibrate temperature to the magnitude of the initial score
  const initialTemp = Math.max(1, Math.abs(currentResult.score) * 0.02)
  const finalTemp   = initialTemp * 0.01

  function runIteration(): void {
    if (stopped) {
      if (!doneSent) { doneSent = true; post({ type: 'done', stopReason: 'user_stopped', totalAttempts: attempt }) }
      return
    }

    const elapsed = Date.now() - startTime
    const t       = Math.min(elapsed / totalMs, 1)
    const temp    = initialTemp * Math.pow(finalTemp / initialTemp, t)

    const r = Math.random()
    let neighbor: Block[] | null
    if      (r < 0.35) neighbor = moveRelocate(current, cfg.matrix)
    else if (r < 0.55) neighbor = moveSwap(current, cfg.matrix)
    else               neighbor = moveMerge(current, cfg.matrix)

    if (neighbor !== null) {
      const neighborResult = scoreAll(neighbor, cfg.matrix, cfg.config)
      const delta          = neighborResult.score - currentResult.score

      if (delta > 0 || Math.random() < Math.exp(delta / temp)) {
        current       = neighbor
        currentResult = neighborResult

        if (isBetter(current, currentResult)) {
          bestBlocks          = current
          bestResult          = currentResult
          lastImprovementTime = Date.now()

          if (beatsPlan(current, currentResult)) {
            proposalIndex++
            post({ type: 'improvement', scenario: bestResult, proposalIndex })
          }
        }
      }
    }

    attempt++

    const now = Date.now()
    if (now - lastProgressTime >= 250) {
      post({
        type:      'progress',
        stage:     1,
        attempt,
        bestScore: bestResult?.score ?? 0,
        bestFleet: bestResult?.fleetCount ?? 0,
        elapsed,
      })
      lastProgressTime = now
    }

    if (elapsed >= totalMs) {
      doneSent = true
      post({ type: 'done', stopReason: 'max_time', totalAttempts: attempt })
      return
    }

    if (now - lastImprovementTime >= cfg.config.stopNoImprovementMinutes * 60_000) {
      doneSent = true
      post({ type: 'done', stopReason: 'no_improvement', totalAttempts: attempt })
      return
    }

    setImmediate(runIteration)
  }

  setImmediate(runIteration)
}
