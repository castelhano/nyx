import type { SolverTrip, SolverMatrixEntry, SolverBlockTrip, SolverPlanningConfig, SolverResult, RangeCriterionConfig } from './solver.types'

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
  config: Pick<SolverPlanningConfig, 'flat' | 'range'>,
): SolverResult {
  const active = blocks.map(b => toActiveBlock(b, matrix))

  let rangeScore             = 0
  let totalDeadrunKm         = 0
  let totalDeadrunMinutes    = 0
  let totalProductiveKm      = 0
  let totalProductiveMinutes = 0
  let totalBlockMinutes      = 0
  const durations: number[]  = []

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
      rangeScore += config.range.lineTransfer.modifier * rangeV(block.lineTransfers, config.range.lineTransfer)
    if (config.range.tripInterval.active && block.intervalCount > 0)
      rangeScore += config.range.tripInterval.modifier * rangeV(avgLayover, config.range.tripInterval)
    if (config.range.deadrunRatio.active)
      rangeScore += config.range.deadrunRatio.modifier * rangeV(drRatio, config.range.deadrunRatio)
    if (config.range.minBlockDuration.active)
      rangeScore += config.range.minBlockDuration.modifier * rangeV(duration, config.range.minBlockDuration)
  }

  let flatScore = 0
  const flat    = config.flat

  const applyFlat = (active: boolean, direction: string, weight: number, quantity: number) => {
    if (!active) return
    flatScore += direction === 'minimize' ? -quantity * weight : quantity * weight
  }

  const mean    = durations.length > 0 ? totalBlockMinutes / durations.length : 0
  const stdDev  = durations.length > 0
    ? Math.sqrt(durations.reduce((acc, d) => acc + (d - mean) ** 2, 0) / durations.length)
    : 0

  // sum of trips across all blocks where requiredVehicleType is unmet
  const specialCount = active.reduce((sum, b) => sum + b.specialTripCount, 0)

  applyFlat(flat.fleetUsage.active,           flat.fleetUsage.direction,           flat.fleetUsage.weight,           active.length)
  applyFlat(flat.deadrunKm.active,            flat.deadrunKm.direction,            flat.deadrunKm.weight,            totalDeadrunKm)
  applyFlat(flat.totalKm.active,              flat.totalKm.direction,              flat.totalKm.weight,              totalDeadrunKm + totalProductiveKm)
  applyFlat(flat.distributionVariance.active, flat.distributionVariance.direction, flat.distributionVariance.weight, stdDev)
  applyFlat(flat.specialFleetUsage.active,    flat.specialFleetUsage.direction,    flat.specialFleetUsage.weight,    specialCount)

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
    score:             rangeScore + flatScore,
    fleetCount:        active.length,
    deadrunKm:         totalDeadrunKm,
    productiveKm:      totalProductiveKm,
    totalKm:           totalDeadrunKm + totalProductiveKm,
    deadrunMinutes:    totalDeadrunMinutes,
    productiveMinutes: totalProductiveMinutes,
    totalMinutes:      totalBlockMinutes,
  }
}
