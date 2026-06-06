import { workerData, parentPort, isMainThread } from 'worker_threads'
import type {
  SolverConfig,
  SolverPlanningConfig,
  RangeCriterionConfig,
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

// Returns 0–1 score for a value against a range criterion
function rangeV(value: number, c: RangeCriterionConfig): number {
  if (value > c.ceiling) return 0
  if (value >= c.idealMin && value <= c.idealMax) return 1
  if (value < c.idealMin) {
    if (value <= c.floor) return c.floor >= c.idealMin ? 1 : 0
    return (value - c.floor) / (c.idealMin - c.floor)
  }
  // value > idealMax
  if (c.ceiling <= c.idealMax) return 0
  return (c.ceiling - value) / (c.ceiling - c.idealMax)
}

// ─── active block shape (internal to this module) ───────────────────────────

interface ActiveBlock {
  number:                 number
  depotId:                string
  vehicleType:            string
  entries:                SolverBlockTrip[]
  lastLocalityId:         string
  lastArrivalMinutes:     number
  lastLineId:             string
  startMinutes:           number
  totalDeadrunKm:         number
  totalDeadrunMinutes:    number
  totalProductiveKm:      number
  totalProductiveMinutes: number
  lineTransfers:          number
  totalLayoverMinutes:    number
  intervalCount:          number
}

// ─── greedy helpers ──────────────────────────────────────────────────────────

function findBestBlock(
  blocks: ActiveBlock[],
  trip: SolverTrip,
  matrix: Record<string, SolverMatrixEntry>,
): { block: ActiveBlock; edge: SolverMatrixEntry } | null {
  let best: { block: ActiveBlock; edge: SolverMatrixEntry } | null = null
  let bestDeadrun = Infinity

  for (const block of blocks) {
    if (trip.requiredVehicleType && block.vehicleType !== trip.requiredVehicleType) continue

    const edge = getEdge(matrix, block.lastLocalityId, trip.originLocalityId)
    if (!edge) continue

    const layover = trip.departureMinutes - (block.lastArrivalMinutes + edge.minutes)
    if (layover < 0) continue

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
): { localityId: string; edge: SolverMatrixEntry } | null {
  let best: { localityId: string; edge: SolverMatrixEntry } | null = null
  let bestMinutes = Infinity

  for (const localityId of depotIds) {
    const edge = getEdge(matrix, localityId, trip.originLocalityId)
    if (!edge) continue

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
): SolverResult {
  let rangeScore = 0
  let totalDeadrunKm        = 0
  let totalDeadrunMinutes   = 0
  let totalProductiveKm     = 0
  let totalProductiveMinutes = 0
  let totalBlockMinutes      = 0
  const durations: number[] = []

  for (const block of blocks) {
    const duration  = block.lastArrivalMinutes - block.startMinutes
    const totalKm   = block.totalDeadrunKm + block.totalProductiveKm
    const drRatio   = totalKm > 0 ? (block.totalDeadrunKm / totalKm) * 100 : 0
    const avgLayover = block.intervalCount > 0 ? block.totalLayoverMinutes / block.intervalCount : 0

    durations.push(duration)
    totalDeadrunKm         += block.totalDeadrunKm
    totalDeadrunMinutes    += block.totalDeadrunMinutes
    totalProductiveKm      += block.totalProductiveKm
    totalProductiveMinutes += block.totalProductiveMinutes
    totalBlockMinutes      += duration

    if (config.range.lineTransfer.active) {
      rangeScore += config.range.lineTransfer.modifier * rangeV(block.lineTransfers, config.range.lineTransfer)
    }
    if (config.range.tripInterval.active && block.intervalCount > 0) {
      rangeScore += config.range.tripInterval.modifier * rangeV(avgLayover, config.range.tripInterval)
    }
    if (config.range.deadrunRatio.active) {
      rangeScore += config.range.deadrunRatio.modifier * rangeV(drRatio, config.range.deadrunRatio)
    }
  }

  // ── flat criteria (candidate-level) ──────────────────────────────────────
  let flatScore = 0
  const flat = config.flat

  const applyFlat = (active: boolean, direction: string, weight: number, quantity: number) => {
    if (!active) return
    const delta = quantity * weight
    flatScore += direction === 'minimize' ? -delta : delta
  }

  const mean     = durations.length > 0 ? totalBlockMinutes / durations.length : 0
  const variance = durations.length > 0
    ? durations.reduce((acc, d) => acc + (d - mean) ** 2, 0) / durations.length
    : 0
  const specialCount = blocks.filter(b => b.vehicleType !== 'BUS').length

  applyFlat(flat.fleetUsage.active,           flat.fleetUsage.direction,           flat.fleetUsage.weight,           blocks.length)
  applyFlat(flat.deadrunKm.active,            flat.deadrunKm.direction,            flat.deadrunKm.weight,            totalDeadrunKm)
  applyFlat(flat.totalKm.active,              flat.totalKm.direction,              flat.totalKm.weight,              totalDeadrunKm + totalProductiveKm)
  applyFlat(flat.distributionVariance.active, flat.distributionVariance.direction, flat.distributionVariance.weight, variance)
  applyFlat(flat.specialFleetUsage.active,    flat.specialFleetUsage.direction,    flat.specialFleetUsage.weight,    specialCount)

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
    score:             rangeScore + flatScore,
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

  const sorted = shuffle([...trips])
  sorted.sort((a, b) => a.departureMinutes - b.departureMinutes)

  const blocks: ActiveBlock[] = []

  for (const trip of sorted) {
    const tripKm      = getEdge(matrix, trip.originLocalityId, trip.destinationLocalityId)?.km ?? 0
    const tripMinutes = trip.arrivalMinutes - trip.departureMinutes
    const best        = findBestBlock(blocks, trip, matrix)

    if (best) {
      const { block, edge } = best
      const layover = trip.departureMinutes - (block.lastArrivalMinutes + edge.minutes)

      block.entries.push({
        tripId:          trip.id,
        sequence:        block.entries.length + 1,
        isDeadhead:      false,
        deadheadMinutes: edge.minutes,
        deadheadKm:      edge.km,
      })
      block.lineTransfers          += block.lastLineId !== trip.lineId ? 1 : 0
      block.lastLineId              = trip.lineId
      block.totalLayoverMinutes    += layover
      block.intervalCount          += 1
      block.totalDeadrunKm         += edge.km
      block.totalDeadrunMinutes    += edge.minutes
      block.totalProductiveKm      += tripKm
      block.totalProductiveMinutes += tripMinutes
      block.lastLocalityId          = trip.destinationLocalityId
      block.lastArrivalMinutes      = trip.arrivalMinutes
    } else {
      const depot = findBestDepot(depots, trip, matrix)
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
        lastLineId:             trip.lineId,
        startMinutes:           trip.departureMinutes - depot.edge.minutes,
        totalDeadrunKm:         depot.edge.km,
        totalDeadrunMinutes:    depot.edge.minutes,
        totalProductiveKm:      tripKm,
        totalProductiveMinutes: tripMinutes,
        lineTransfers:          0,
        totalLayoverMinutes:    0,
        intervalCount:          0,
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
