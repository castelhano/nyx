import { workerData, parentPort, isMainThread } from 'worker_threads'
import type {
  SolverConfig,
  SolverPlanningConfig,
  SolverTrip,
  SolverMatrixEntry,
  SolverDepot,
  SolverBlock,
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
  number: number
  depotId: string
  vehicleType: string
  entries: SolverBlockTrip[]
  lastLocalityId: string
  lastArrivalMinutes: number
  startMinutes: number
  totalDeadrunKm: number
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

    const projectedDuration = trip.arrivalMinutes - block.startMinutes
    if (projectedDuration > config.blockDurationMaxMinutes) continue

    if (edge.minutes < bestDeadrun) {
      bestDeadrun = edge.minutes
      best = { block, edge }
    }
  }

  return best
}

function findBestDepot(
  depotUsage: Map<string, Map<string, number>>,
  trip: SolverTrip,
  matrix: Record<string, SolverMatrixEntry>,
  config: SolverPlanningConfig,
): { localityId: string; vehicleType: string; edge: SolverMatrixEntry } | null {
  let best: { localityId: string; vehicleType: string; edge: SolverMatrixEntry } | null = null
  let bestMinutes = Infinity

  for (const [localityId, typeMap] of depotUsage) {
    for (const [vehicleType, remaining] of typeMap) {
      if (remaining <= 0) continue
      if (trip.requiredVehicleType && vehicleType !== trip.requiredVehicleType) continue

      const edge = getEdge(matrix, localityId, trip.originLocalityId)
      if (!edge) continue
      if (edge.minutes > config.maxDeadrunHardMinutes) continue

      if (edge.minutes < bestMinutes) {
        bestMinutes = edge.minutes
        best = { localityId, vehicleType, edge }
      }
    }
  }

  return best
}

function scoreBlocks(
  blocks: ActiveBlock[],
  config: SolverPlanningConfig,
): SolverResult | null {
  let score = 100
  let totalDeadrunKm = 0

  for (const block of blocks) {
    const duration = block.lastArrivalMinutes - block.startMinutes

    if (duration < config.blockDurationMinMinutes) return null
    if (duration > config.blockDurationMaxMinutes) return null

    if (duration < config.blockDurationIdealMinMinutes || duration > config.blockDurationIdealMaxMinutes) {
      const deviation = Math.min(
        Math.abs(duration - config.blockDurationIdealMinMinutes),
        Math.abs(duration - config.blockDurationIdealMaxMinutes),
      )
      score -= (deviation / 60) * config.weightBlockDuration
    }

    for (const entry of block.entries) {
      totalDeadrunKm += entry.deadheadKm
      if (entry.deadheadMinutes > config.maxDeadrunSoftMinutes) {
        const excess = entry.deadheadMinutes - config.maxDeadrunSoftMinutes
        score -= (excess / 10) * config.weightMinimizeDeadrun
      }
    }
  }

  score -= blocks.length * config.weightMinimizeFleet

  return {
    blocks: blocks.map(b => ({
      blockNumber: b.number,
      depotId: b.depotId,
      vehicleType: b.vehicleType,
      trips: b.entries,
      totalMinutes: b.lastArrivalMinutes - b.startMinutes,
      totalKm: b.totalDeadrunKm,
    })),
    score,
    fleetCount: blocks.length,
    deadrunKm: totalDeadrunKm,
  }
}

// ─── candidate evaluation ────────────────────────────────────────────────────

function evaluateCandidate(cfg: SolverConfig): SolverResult | null {
  const { trips, matrix, depots, config } = cfg

  // Shuffle then stable-sort by departure — randomizes tie-breaking each attempt
  const sorted = shuffle([...trips])
  sorted.sort((a, b) => a.departureMinutes - b.departureMinutes)

  // Clone depot availability
  const depotUsage = new Map<string, Map<string, number>>()
  for (const d of depots) {
    if (!depotUsage.has(d.localityId)) depotUsage.set(d.localityId, new Map())
    const existing = depotUsage.get(d.localityId)!.get(d.vehicleType) ?? 0
    depotUsage.get(d.localityId)!.set(d.vehicleType, existing + d.quantity)
  }

  const blocks: ActiveBlock[] = []

  for (const trip of sorted) {
    const best = findBestBlock(blocks, trip, matrix, config)

    if (best) {
      const { block, edge } = best
      block.entries.push({
        tripId: trip.id,
        sequence: block.entries.length + 1,
        isDeadhead: false,
        deadheadMinutes: edge.minutes,
        deadheadKm: edge.km,
      })
      block.totalDeadrunKm += edge.km
      block.lastLocalityId = trip.destinationLocalityId
      block.lastArrivalMinutes = trip.arrivalMinutes
    } else {
      const depot = findBestDepot(depotUsage, trip, matrix, config)
      if (!depot) return null

      const typeMap = depotUsage.get(depot.localityId)!
      typeMap.set(depot.vehicleType, typeMap.get(depot.vehicleType)! - 1)

      const block: ActiveBlock = {
        number: blocks.length + 1,
        depotId: depot.localityId,
        vehicleType: depot.vehicleType,
        entries: [{
          tripId: trip.id,
          sequence: 1,
          isDeadhead: false,
          deadheadMinutes: depot.edge.minutes,
          deadheadKm: depot.edge.km,
        }],
        lastLocalityId: trip.destinationLocalityId,
        lastArrivalMinutes: trip.arrivalMinutes,
        startMinutes: trip.departureMinutes - depot.edge.minutes,
        totalDeadrunKm: depot.edge.km,
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
