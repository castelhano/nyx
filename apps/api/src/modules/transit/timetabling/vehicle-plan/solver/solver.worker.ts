import { workerData, parentPort, isMainThread } from 'worker_threads'
import type {
  SolverConfig,
  SolverPlanningConfig,
  SolverTrip,
  SolverMatrixEntry,
  SolverBlockTrip,
  SolverResult,
  SolverMessage,
  WorkerCommand,
} from './solver.types'

if (isMainThread) process.exit(1)

const cfg = workerData as SolverConfig
let stopped = false
let doneSent = false

parentPort!.on('message', (cmd: WorkerCommand) => {
  if (cmd.type === 'stop') stopped = true
})

// ─── helpers ────────────────────────────────────────────────────────────────

function getEdge(
  matrix: Record<string, SolverMatrixEntry>,
  from: string,
  to: string,
): SolverMatrixEntry | null {
  if (from === to) return { minutes: 0, km: 0 }
  return matrix[`${from}:${to}`] ?? null
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ─── active block shape (internal to this module) ───────────────────────────

interface ActiveBlock {
  number:                number
  depotId:               string
  vehicleType:           string
  entries:               SolverBlockTrip[]
  lastLocalityId:        string
  lastArrivalMinutes:    number
  startMinutes:          number
  totalDeadrunKm:        number
  totalDeadrunMinutes:   number
  totalProductiveKm:     number
  totalProductiveMinutes: number
}

// ─── greedy helpers ──────────────────────────────────────────────────────────

function findBestBlock(
  blocks: ActiveBlock[],
  trip: SolverTrip,
  matrix: Record<string, SolverMatrixEntry>,
  config: SolverPlanningConfig,
): { block: ActiveBlock; edge: SolverMatrixEntry } | null {
  let best: { block: ActiveBlock; edge: SolverMatrixEntry } | null = null
  let bestDeadrun = Infinity

  for (const block of blocks) {
    if (trip.requiredVehicleType && block.vehicleType !== trip.requiredVehicleType) continue

    const edge = getEdge(matrix, block.lastLocalityId, trip.originLocalityId)
    if (!edge) continue
    if (edge.minutes > config.maxDeadrunHardMinutes) continue

    const layover = trip.departureMinutes - (block.lastArrivalMinutes + edge.minutes)
    if (layover < config.minLayoverMinutes) continue

    if (edge.minutes < bestDeadrun) {
      bestDeadrun = edge.minutes
      best = { block, edge }
    }
  }

  return best
}

function findBestDepot(
  depotIds: string[],
  trip: SolverTrip,
  matrix: Record<string, SolverMatrixEntry>,
  config: SolverPlanningConfig,
): { localityId: string; edge: SolverMatrixEntry } | null {
  let best: { localityId: string; edge: SolverMatrixEntry } | null = null
  let bestMinutes = Infinity

  for (const localityId of depotIds) {
    const edge = getEdge(matrix, localityId, trip.originLocalityId)
    if (!edge) continue
    if (edge.minutes > config.maxDeadrunHardMinutes) continue

    if (edge.minutes < bestMinutes) {
      bestMinutes = edge.minutes
      best = { localityId, edge }
    }
  }

  return best
}

function scoreBlocks(
  blocks: ActiveBlock[],
  config: SolverPlanningConfig,
): SolverResult | null {
  let score = 100
  let totalDeadrunKm        = 0
  let totalDeadrunMinutes   = 0
  let totalProductiveKm     = 0
  let totalProductiveMinutes = 0
  let totalBlockMinutes      = 0

  for (const block of blocks) {
    const duration = block.lastArrivalMinutes - block.startMinutes

    for (const entry of block.entries) {
      if (entry.deadheadMinutes > config.maxDeadrunSoftMinutes) {
        const excess = entry.deadheadMinutes - config.maxDeadrunSoftMinutes
        score -= (excess / 10) * config.weightMinimizeDeadrun
      }
    }

    totalDeadrunKm         += block.totalDeadrunKm
    totalDeadrunMinutes    += block.totalDeadrunMinutes
    totalProductiveKm      += block.totalProductiveKm
    totalProductiveMinutes += block.totalProductiveMinutes
    totalBlockMinutes      += duration
  }

  score -= blocks.length * config.weightMinimizeFleet

  return {
    blocks: blocks.map(b => ({
      blockNumber:       b.number,
      depotId:           b.depotId,
      vehicleType:       b.vehicleType,
      trips:             b.entries,
      totalMinutes:      b.lastArrivalMinutes - b.startMinutes,
      productiveMinutes: b.totalProductiveMinutes,
      deadrunMinutes:    b.totalDeadrunMinutes,
      totalKm:           b.totalDeadrunKm + b.totalProductiveKm,
      productiveKm:      b.totalProductiveKm,
      deadrunKm:         b.totalDeadrunKm,
    })),
    score,
    fleetCount:        blocks.length,
    deadrunKm:         totalDeadrunKm,
    productiveKm:      totalProductiveKm,
    totalKm:           totalDeadrunKm + totalProductiveKm,
    deadrunMinutes:    totalDeadrunMinutes,
    productiveMinutes: totalProductiveMinutes,
    totalMinutes:      totalBlockMinutes,
  }
}

// ─── candidate evaluation ────────────────────────────────────────────────────

function evaluateCandidate(cfg: SolverConfig): SolverResult | null {
  const { trips, matrix, depots, config } = cfg

  // Shuffle then stable-sort by departure — randomizes tie-breaking each attempt
  const sorted = shuffle([...trips])
  sorted.sort((a, b) => a.departureMinutes - b.departureMinutes)

  const blocks: ActiveBlock[] = []

  for (const trip of sorted) {
    const tripKm      = getEdge(matrix, trip.originLocalityId, trip.destinationLocalityId)?.km ?? 0
    const tripMinutes = trip.arrivalMinutes - trip.departureMinutes
    const best        = findBestBlock(blocks, trip, matrix, config)

    if (best) {
      const { block, edge } = best
      block.entries.push({
        tripId:          trip.id,
        sequence:        block.entries.length + 1,
        isDeadhead:      false,
        deadheadMinutes: edge.minutes,
        deadheadKm:      edge.km,
      })
      block.totalDeadrunKm         += edge.km
      block.totalDeadrunMinutes    += edge.minutes
      block.totalProductiveKm      += tripKm
      block.totalProductiveMinutes += tripMinutes
      block.lastLocalityId         = trip.destinationLocalityId
      block.lastArrivalMinutes     = trip.arrivalMinutes
    } else {
      const depot = findBestDepot(depots, trip, matrix, config)
      if (!depot) return null

      const block: ActiveBlock = {
        number:                 blocks.length + 1,
        depotId:                depot.localityId,
        vehicleType:            trip.requiredVehicleType ?? 'BUS',
        entries: [{
          tripId:          trip.id,
          sequence:        1,
          isDeadhead:      false,
          deadheadMinutes: depot.edge.minutes,
          deadheadKm:      depot.edge.km,
        }],
        lastLocalityId:         trip.destinationLocalityId,
        lastArrivalMinutes:     trip.arrivalMinutes,
        startMinutes:           trip.departureMinutes - depot.edge.minutes,
        totalDeadrunKm:         depot.edge.km,
        totalDeadrunMinutes:    depot.edge.minutes,
        totalProductiveKm:      tripKm,
        totalProductiveMinutes: tripMinutes,
      }
      blocks.push(block)
    }
  }

  return scoreBlocks(blocks, config)
}

// ─── main loop ───────────────────────────────────────────────────────────────

let attempt = 0
let bestResult: SolverResult | null = null
let lastImprovementTime = Date.now()
const startTime = Date.now()

function post(msg: SolverMessage): void {
  parentPort!.postMessage(msg)
}

function runIteration(): void {
  if (stopped) {
    if (!doneSent) {
      doneSent = true
      post({ type: 'done', stopReason: 'user_stopped' })
    }
    return
  }

  const result = evaluateCandidate(cfg)
  attempt++
  const elapsed = Date.now() - startTime

  if (result !== null && (!bestResult || result.score > bestResult.score)) {
    bestResult = result
    lastImprovementTime = Date.now()
    post({ type: 'improvement', scenario: result })
  }

  post({
    type: 'progress',
    attempt,
    bestScore: bestResult?.score ?? 0,
    bestFleet: bestResult?.fleetCount ?? 0,
    deadrunKm: bestResult?.deadrunKm ?? 0,
    elapsed,
  })

  if (elapsed >= cfg.config.stopMaxTotalMinutes * 60_000) {
    doneSent = true
    post({ type: 'done', stopReason: 'max_time' })
    return
  }

  if (Date.now() - lastImprovementTime >= cfg.config.stopNoImprovementMinutes * 60_000) {
    doneSent = true
    post({ type: 'done', stopReason: 'no_improvement' })
    return
  }

  setImmediate(runIteration)
}

setImmediate(runIteration)
