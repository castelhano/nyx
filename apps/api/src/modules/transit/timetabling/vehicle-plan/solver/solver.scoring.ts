import type { SolverTrip, SolverMatrixEntry, SolverBlockTrip, SolverPlanningConfig, SolverResult, RangeCriterionConfig, AnchoredCriterionConfig } from './solver.types'

export interface ScoringBlock {
  id:          number
  depotId:     string
  vehicleType: string
  trips:       SolverTrip[]
}

interface ActiveBlock {
  number:                 number
  depotId:                string
  vehicleType:            string
  entries:                SolverBlockTrip[]
  lastArrivalMinutes:     number
  startMinutes:           number
  totalDeadrunKm:         number
  totalDeadrunMinutes:    number
  totalProductiveKm:      number
  totalProductiveMinutes: number
  lineTransfers:          number
  totalLayoverMinutes:    number
  intervalCount:          number
  specialTripCount:       number  // trips where requiredVehicleType != null && != block vehicleType
}

export function findMatrixMisses(
  blocks: ScoringBlock[],
  matrix: Record<string, SolverMatrixEntry>,
): { origin: string; destination: string }[] {
  const seen:   Set<string>                               = new Set()
  const misses: { origin: string; destination: string }[] = []

  const check = (origin: string, destination: string) => {
    if (origin === destination) return
    const key = `${origin}:${destination}`
    if (seen.has(key)) return
    seen.add(key)
    if (!matrix[key]) misses.push({ origin, destination })
  }

  for (const block of blocks) {
    if (block.trips.length === 0) continue
    check(block.depotId, block.trips[0].originLocalityId)
    for (let i = 1; i < block.trips.length; i++) {
      check(block.trips[i - 1].destinationLocalityId, block.trips[i].originLocalityId)
    }
  }

  return misses
}

export function getEdge(
  matrix: Record<string, SolverMatrixEntry>,
  from: string,
  to: string,
): SolverMatrixEntry | null {
  if (from === to) return { minutes: 0, km: 0 }
  return matrix[`${from}:${to}`] ?? null
}

// Duplicated from plan-scoring.calc.ts on purpose — the solver keeps its own live
// scoring path (see block-aggregate.ts header comment); a future revision is expected
// to converge onto the shared formula instead. See
// docs/proposal/vehicle_plan_score_formula_v1.md for the weighted-average reform.
const SCORE_SCALE = 9999

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

function anchoredV(realized: number, theoreticalMin: number, c: AnchoredCriterionConfig): number {
  if (theoreticalMin <= 0) return 1
  const ratio = realized / theoreticalMin
  return rangeV(ratio, {
    active: c.active, modifier: 0, floor: 1, idealMin: 1,
    idealMax: 1 + c.idealMaxOverPercent / 100,
    ceiling:  1 + c.ceilingOverPercent  / 100,
  })
}

function peakVehicleRequirement(trips: { departureMinutes: number; arrivalMinutes: number }[]): number {
  if (trips.length === 0) return 0
  const events: [number, number][] = []
  for (const t of trips) {
    events.push([t.departureMinutes, 1])
    events.push([t.arrivalMinutes, -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let concurrent = 0
  let peak       = 0
  for (const [, delta] of events) {
    concurrent += delta
    if (concurrent > peak) peak = concurrent
  }
  return peak
}

function toActiveBlock(block: ScoringBlock, matrix: Record<string, SolverMatrixEntry>): ActiveBlock {
  const first     = block.trips[0]
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
  let totalProductiveKm      = first.tripKm
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
    totalProductiveKm      += trip.tripKm
    totalProductiveMinutes += trip.arrivalMinutes - trip.departureMinutes
    lineTransfers          += lastLineId !== trip.lineId ? 1 : 0
    totalLayoverMinutes    += layover
    intervalCount          += 1
    lastLocality            = trip.destinationLocalityId
    lastArrival             = trip.arrivalMinutes
    lastLineId              = trip.lineId
  }

  // count trips whose vehicle type requirement is unmet by this block
  const specialTripCount = block.trips.filter(
    t => t.requiredVehicleType !== null && t.requiredVehicleType !== block.vehicleType,
  ).length

  return {
    number:                 block.id,
    depotId:                block.depotId,
    vehicleType:            block.vehicleType,
    entries,
    lastArrivalMinutes:     lastArrival,
    startMinutes:           first.departureMinutes - depotEdge.minutes,
    totalDeadrunKm,
    totalDeadrunMinutes,
    totalProductiveKm,
    totalProductiveMinutes,
    lineTransfers,
    totalLayoverMinutes,
    intervalCount,
    specialTripCount,
  }
}

export function scoreBlocks(
  blocks: ScoringBlock[],
  matrix: Record<string, SolverMatrixEntry>,
  config: Pick<SolverPlanningConfig, 'range' | 'anchored'>,
): SolverResult {
  const active = blocks.map(b => toActiveBlock(b, matrix))

  let totalDeadrunKm         = 0
  let totalDeadrunMinutes    = 0
  let totalProductiveKm      = 0
  let totalProductiveMinutes = 0
  let totalBlockMinutes      = 0
  const durations: number[]  = []

  let weightedSum = 0
  let weightTotal = 0
  const add = (weight: number, value: number) => { weightedSum += weight * value; weightTotal += weight }

  for (const block of active) {
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
      add(config.range.lineTransfer.modifier, rangeV(block.lineTransfers, config.range.lineTransfer))
    if (config.range.tripInterval.active && block.intervalCount > 0)
      add(config.range.tripInterval.modifier, rangeV(avgLayover, config.range.tripInterval))
    if (config.range.deadrunRatio.active)
      add(config.range.deadrunRatio.modifier, rangeV(drRatio, config.range.deadrunRatio))
    if (config.range.minBlockDuration.active)
      add(config.range.minBlockDuration.modifier, rangeV(duration, config.range.minBlockDuration))
  }

  const mean   = durations.length > 0 ? totalBlockMinutes / durations.length : 0
  const stdDev = durations.length > 0
    ? Math.sqrt(durations.reduce((acc, d) => acc + (d - mean) ** 2, 0) / durations.length)
    : 0
  const durationCV = mean > 0 ? (stdDev / mean) * 100 : 0

  if (config.range.distributionVariance.active)
    add(config.range.distributionVariance.modifier, rangeV(durationCV, config.range.distributionVariance))

  const totalTripCount = active.reduce((sum, b) => sum + b.entries.length, 0)
  // sum of trips across all blocks where requiredVehicleType is unmet
  const specialCount   = active.reduce((sum, b) => sum + b.specialTripCount, 0)
  const specialPercent = totalTripCount > 0 ? (specialCount / totalTripCount) * 100 : 0
  if (config.range.specialFleetUsage.active)
    add(config.range.specialFleetUsage.modifier, rangeV(specialPercent, config.range.specialFleetUsage))

  if (config.anchored.totalKm.active)
    add(config.anchored.totalKm.weight, anchoredV(totalDeadrunKm + totalProductiveKm, totalProductiveKm, config.anchored.totalKm))
  if (config.anchored.fleetUsage.active) {
    const allTrips = blocks.flatMap(b => b.trips)
    add(config.anchored.fleetUsage.weight, anchoredV(active.length, peakVehicleRequirement(allTrips), config.anchored.fleetUsage))
  }

  const score = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * SCORE_SCALE) : 0

  return {
    blocks: active.map(b => ({
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
    fleetCount:        active.length,
    deadrunKm:         totalDeadrunKm,
    productiveKm:      totalProductiveKm,
    totalKm:           totalDeadrunKm + totalProductiveKm,
    deadrunMinutes:    totalDeadrunMinutes,
    productiveMinutes: totalProductiveMinutes,
    totalMinutes:      totalBlockMinutes,
  }
}
