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

const cfg    = workerData as SolverConfig
let stopped  = false
let doneSent = false

parentPort!.on('message', (cmd: WorkerCommand) => {
  if (cmd.type === 'stop') stopped = true
})

process.on('uncaughtException', (err) => {
  console.error('[solver-worker] uncaughtException:', err)
  if (!doneSent) {
    doneSent = true
    parentPort?.postMessage({ type: 'done', stopReason: 'no_improvement' } satisfies SolverMessage)
  }
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

function rangeV(value: number, c: RangeCriterionConfig): number {
  if (value > c.ceiling) return 0
  if (value >= c.idealMin && value <= c.idealMax) return 1
  if (value < c.idealMin) {
    if (value <= c.floor) return c.floor >= c.idealMin ? 1 : 0
    return (value - c.floor) / (c.idealMin - c.floor)
  }
  if (c.ceiling <= c.idealMax) return 0
  return (c.ceiling - value) / (c.ceiling - c.idealMax)
}

// ─── mutable solution ─────────────────────────────────────────────────────────
//
// Block keeps trips sorted by departureMinutes at all times.
// Each move produces a new Block[] array (immutable-style updates).

interface Block {
  id:          number
  depotId:     string
  vehicleType: string
  trips:       SolverTrip[]
}

let nextBlockId = 0

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

// ─── scoring ─────────────────────────────────────────────────────────────────

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

function toActiveBlock(block: Block, matrix: Record<string, SolverMatrixEntry>): ActiveBlock {
  const first     = block.trips[0]
  // fallback to zero cost when matrix entry is missing (data quality issue, logged during greedy)
  const depotEdge = getEdge(matrix, block.depotId, first.originLocalityId) ?? { minutes: 0, km: 0 }

  const entries: SolverBlockTrip[] = [{
    tripId:          first.id,
    sequence:        1,
    isDeadhead:      false,
    deadheadMinutes: depotEdge.minutes,
    deadheadKm:      depotEdge.km,
  }]

  let totalDeadrunKm         = depotEdge.km
  let totalDeadrunMinutes    = depotEdge.minutes
  let totalProductiveKm      = getEdge(matrix, first.originLocalityId, first.destinationLocalityId)?.km ?? 0
  let totalProductiveMinutes = first.arrivalMinutes - first.departureMinutes
  let lineTransfers          = 0
  let totalLayoverMinutes    = 0
  let intervalCount          = 0
  let lastLocality           = first.destinationLocalityId
  let lastArrival            = first.arrivalMinutes
  let lastLineId             = first.lineId

  for (let i = 1; i < block.trips.length; i++) {
    const trip    = block.trips[i]
    const edge    = getEdge(matrix, lastLocality, trip.originLocalityId) ?? { minutes: 0, km: 0 }
    const layover = trip.departureMinutes - (lastArrival + edge.minutes)

    entries.push({
      tripId:          trip.id,
      sequence:        i + 1,
      isDeadhead:      false,
      deadheadMinutes: edge.minutes,
      deadheadKm:      edge.km,
    })

    totalDeadrunKm         += edge.km
    totalDeadrunMinutes    += edge.minutes
    totalProductiveKm      += getEdge(matrix, trip.originLocalityId, trip.destinationLocalityId)?.km ?? 0
    totalProductiveMinutes += trip.arrivalMinutes - trip.departureMinutes
    lineTransfers          += lastLineId !== trip.lineId ? 1 : 0
    totalLayoverMinutes    += layover
    intervalCount          += 1
    lastLocality            = trip.destinationLocalityId
    lastArrival             = trip.arrivalMinutes
    lastLineId              = trip.lineId
  }

  return {
    number:                 block.id,
    depotId:                block.depotId,
    vehicleType:            block.vehicleType,
    entries,
    lastLocalityId:         lastLocality,
    lastArrivalMinutes:     lastArrival,
    lastLineId,
    startMinutes:           first.departureMinutes - depotEdge.minutes,
    totalDeadrunKm,
    totalDeadrunMinutes,
    totalProductiveKm,
    totalProductiveMinutes,
    lineTransfers,
    totalLayoverMinutes,
    intervalCount,
  }
}

function scoreBlocks(
  blocks: ActiveBlock[],
  config: SolverPlanningConfig,
): SolverResult {
  let rangeScore             = 0
  let totalDeadrunKm         = 0
  let totalDeadrunMinutes    = 0
  let totalProductiveKm      = 0
  let totalProductiveMinutes = 0
  let totalBlockMinutes      = 0
  const durations: number[]  = []

  for (const block of blocks) {
    const duration   = block.lastArrivalMinutes - block.startMinutes
    const totalKm    = block.totalDeadrunKm + block.totalProductiveKm
    const drRatio    = totalKm > 0 ? (block.totalDeadrunKm / totalKm) * 100 : 0
    const avgLayover = block.intervalCount > 0 ? block.totalLayoverMinutes / block.intervalCount : 0

    durations.push(duration)
    totalDeadrunKm         += block.totalDeadrunKm
    totalDeadrunMinutes    += block.totalDeadrunMinutes
    totalProductiveKm      += block.totalProductiveKm
    totalProductiveMinutes += block.totalProductiveMinutes
    totalBlockMinutes      += duration

    if (config.range.lineTransfer.active)
      rangeScore += config.range.lineTransfer.modifier * rangeV(block.lineTransfers, config.range.lineTransfer)
    if (config.range.tripInterval.active && block.intervalCount > 0)
      rangeScore += config.range.tripInterval.modifier * rangeV(avgLayover, config.range.tripInterval)
    if (config.range.deadrunRatio.active)
      rangeScore += config.range.deadrunRatio.modifier * rangeV(drRatio, config.range.deadrunRatio)
  }

  let flatScore = 0
  const flat    = config.flat

  const applyFlat = (active: boolean, direction: string, weight: number, quantity: number) => {
    if (!active) return
    flatScore += direction === 'minimize' ? -quantity * weight : quantity * weight
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

function scoreAll(
  blocks: Block[],
  matrix: Record<string, SolverMatrixEntry>,
  config: SolverPlanningConfig,
): SolverResult {
  return scoreBlocks(blocks.map(b => toActiveBlock(b, matrix)), config)
}

// ─── construction ────────────────────────────────────────────────────────────

// Greedy-assigns a list of trips (sorted by departure) into the given blocks,
// opening new blocks when no existing one can accommodate a trip.
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
        console.warn(`[solver-worker] no matrix entry for depot→${trip.originLocalityId}; using fallback depot for trip ${trip.id}`)
        bestDepot = depots[0]
      }

      blocks.push({
        id:          nextBlockId++,
        depotId:     bestDepot,
        vehicleType: trip.requiredVehicleType ?? 'BUS',
        trips:       [trip],
      })
    }
  }
}

// Builds the initial solution from the existing plan blocks, then greedily
// assigns any trips not yet covered (e.g. newly inserted trips).
// Falls back to a full greedy construction when no existing blocks are provided.
function buildInitial(
  trips: SolverTrip[],
  matrix: Record<string, SolverMatrixEntry>,
  depots: string[],
): Block[] {
  const { initialBlocks } = cfg
  const blocks: Block[] = []

  if (initialBlocks.length > 0) {
    const tripMap = new Map(trips.map(t => [t.id, t]))
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

function insertSorted(trips: SolverTrip[], trip: SolverTrip): SolverTrip[] {
  const idx = trips.findIndex(t => t.departureMinutes > trip.departureMinutes)
  return idx === -1 ? [...trips, trip] : [...trips.slice(0, idx), trip, ...trips.slice(idx)]
}

// Relocate: move one random trip from one block to another
function moveRelocate(
  blocks: Block[],
  matrix: Record<string, SolverMatrixEntry>,
): Block[] | null {
  if (blocks.length < 2) return null

  const fromIdx = Math.floor(Math.random() * blocks.length)
  const from    = blocks[fromIdx]
  const tripIdx = Math.floor(Math.random() * from.trips.length)
  const trip    = from.trips[tripIdx]

  const order = shuffle(blocks.map((_, i) => i).filter(i => i !== fromIdx))

  for (const toIdx of order) {
    const to = blocks[toIdx]
    if (trip.requiredVehicleType && to.vehicleType !== trip.requiredVehicleType) continue

    const newTo: Block = { ...to, trips: insertSorted(to.trips, trip) }
    if (!feasible(newTo, matrix)) continue

    const newFrom: Block = { ...from, trips: from.trips.filter((_, i) => i !== tripIdx) }
    return blocks
      .map((b, i) => i === fromIdx ? newFrom : i === toIdx ? newTo : b)
      .filter(b => b.trips.length > 0)
  }

  return null
}

// Swap: exchange one trip from each of two random blocks
function moveSwap(
  blocks: Block[],
  matrix: Record<string, SolverMatrixEntry>,
): Block[] | null {
  if (blocks.length < 2) return null

  const i1  = Math.floor(Math.random() * blocks.length)
  let   i2  = Math.floor(Math.random() * (blocks.length - 1))
  if (i2 >= i1) i2++

  const b1  = blocks[i1]
  const b2  = blocks[i2]
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

  return blocks.map((b, i) => i === i1 ? nb1 : i === i2 ? nb2 : b)
}

// Merge: combine all trips from two random blocks into one if the interleaving is feasible
function moveMerge(
  blocks: Block[],
  matrix: Record<string, SolverMatrixEntry>,
): Block[] | null {
  if (blocks.length < 2) return null

  const i1  = Math.floor(Math.random() * blocks.length)
  let   i2  = Math.floor(Math.random() * (blocks.length - 1))
  if (i2 >= i1) i2++

  const b1 = blocks[i1]
  const b2 = blocks[i2]
  if (b1.vehicleType !== b2.vehicleType) return null

  const combined = [...b1.trips, ...b2.trips]
    .sort((a, b) => a.departureMinutes - b.departureMinutes)

  // try b1's depot first, then b2's
  for (const depotId of [b1.depotId, b2.depotId]) {
    const merged: Block = { id: b1.id, depotId, vehicleType: b1.vehicleType, trips: combined }
    if (feasible(merged, matrix)) {
      return [...blocks.filter((_, i) => i !== i1 && i !== i2), merged]
    }
  }

  return null
}

// ─── main loop (simulated annealing) ─────────────────────────────────────────

let attempt             = 0
let bestBlocks:         Block[] = []
let bestResult:         SolverResult | null = null
let lastImprovementTime = Date.now()
const startTime         = Date.now()
let lastProgressTime    = Date.now()

function post(msg: SolverMessage): void {
  parentPort!.postMessage(msg)
}

// Fleet count is the primary improvement criterion; score breaks ties
function isBetter(candidate: Block[], candidateResult: SolverResult): boolean {
  if (!bestResult) return true
  if (candidate.length < bestBlocks.length) return true
  if (candidate.length > bestBlocks.length) return false
  return candidateResult.score > bestResult.score
}

const initial = buildInitial(cfg.trips, cfg.matrix, cfg.depots)

if (initial.length === 0) {
  console.error(`[solver-worker] no blocks could be built. trips=${cfg.trips.length} depots=${cfg.depots.length}`)
  post({ type: 'done', stopReason: 'no_improvement' })
} else {
  let current       = initial
  let currentResult = scoreAll(current, cfg.matrix, cfg.config)
  bestBlocks        = initial
  bestResult        = currentResult

  post({ type: 'improvement', scenario: bestResult })

  // Temperature cools from 5.0 to 0.05 over stopMaxTotalMinutes
  const totalMs    = cfg.config.stopMaxTotalMinutes * 60_000
  const initialTemp = 5.0

  function runIteration(): void {
    if (stopped) {
      if (!doneSent) { doneSent = true; post({ type: 'done', stopReason: 'user_stopped' }) }
      return
    }

    const elapsed = Date.now() - startTime
    const temp    = initialTemp * Math.pow(0.01, Math.min(elapsed / totalMs, 1))

    // merge weighted higher to actively drive fleet reduction
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
          post({ type: 'improvement', scenario: bestResult })
        }
      }
    }

    attempt++

    const now = Date.now()
    if (now - lastProgressTime >= 250) {
      post({
        type:      'progress',
        attempt,
        bestScore: bestResult?.score ?? 0,
        bestFleet: bestResult?.fleetCount ?? 0,
        deadrunKm: bestResult?.deadrunKm ?? 0,
        elapsed,
      })
      lastProgressTime = now
    }

    if (elapsed >= cfg.config.stopMaxTotalMinutes * 60_000) {
      doneSent = true
      post({ type: 'done', stopReason: 'max_time' })
      return
    }

    if (now - lastImprovementTime >= cfg.config.stopNoImprovementMinutes * 60_000) {
      doneSent = true
      post({ type: 'done', stopReason: 'no_improvement' })
      return
    }

    setImmediate(runIteration)
  }

  setImmediate(runIteration)
}
