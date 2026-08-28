import type { SolverPlanningConfig, RangeCriterionConfig } from '../solver/solver.types'
import type { BlockAggregate } from './block-aggregate'
import type { VehiclePlanLineSummary } from '@nyx/schemas'

// The single score formula in the system — extracted from the solver's scoreBlocks
// (solver.scoring.ts). Consumed today only by VehiclePlanService.recalculate (via
// BlockAggregate[] built from persisted state); a future solver revision is expected
// to converge onto this same function instead of keeping its own copy — see
// docs/proposal/vehicle-plan-summary-score-consolidation.md §2.1.
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

export interface AggregateScoreResult {
  score:             number
  fleetCount:        number
  deadrunKm:         number
  productiveKm:      number
  totalKm:           number
  deadrunMinutes:    number
  productiveMinutes: number
  totalMinutes:      number
}

export function scoreFromAggregates(
  aggregates: BlockAggregate[],
  config:     Pick<SolverPlanningConfig, 'flat' | 'range'>,
): AggregateScoreResult {
  let rangeScore             = 0
  let totalDeadrunKm         = 0
  let totalDeadrunMinutes    = 0
  let totalProductiveKm      = 0
  let totalProductiveMinutes = 0
  let totalBlockMinutes      = 0
  const durations: number[]  = []

  for (const agg of aggregates) {
    const totalKm = agg.deadrunKm + agg.productiveKm
    const drRatio = totalKm > 0 ? (agg.deadrunKm / totalKm) * 100 : 0

    durations.push(agg.totalMinutes)
    totalDeadrunKm         += agg.deadrunKm
    totalDeadrunMinutes    += agg.deadrunMinutes
    totalProductiveKm      += agg.productiveKm
    totalProductiveMinutes += agg.productiveMinutes
    totalBlockMinutes      += agg.totalMinutes

    if (config.range.lineTransfer.active)
      rangeScore += config.range.lineTransfer.modifier * rangeV(agg.lineTransfers, config.range.lineTransfer)
    if (config.range.tripInterval.active && agg.intervalCount > 0)
      rangeScore += config.range.tripInterval.modifier * rangeV(agg.avgLayover, config.range.tripInterval)
    if (config.range.deadrunRatio.active)
      rangeScore += config.range.deadrunRatio.modifier * rangeV(drRatio, config.range.deadrunRatio)
    if (config.range.minBlockDuration.active)
      rangeScore += config.range.minBlockDuration.modifier * rangeV(agg.totalMinutes, config.range.minBlockDuration)
  }

  let flatScore = 0
  const flat    = config.flat

  const applyFlat = (active: boolean, direction: string, weight: number, quantity: number) => {
    if (!active) return
    flatScore += direction === 'minimize' ? -quantity * weight : quantity * weight
  }

  const mean   = durations.length > 0 ? totalBlockMinutes / durations.length : 0
  const stdDev = durations.length > 0
    ? Math.sqrt(durations.reduce((acc, d) => acc + (d - mean) ** 2, 0) / durations.length)
    : 0

  const specialCount = aggregates.reduce((sum, a) => sum + a.specialTripCount, 0)

  applyFlat(flat.fleetUsage.active,           flat.fleetUsage.direction,           flat.fleetUsage.weight,           aggregates.length)
  applyFlat(flat.deadrunKm.active,            flat.deadrunKm.direction,            flat.deadrunKm.weight,            totalDeadrunKm)
  applyFlat(flat.totalKm.active,              flat.totalKm.direction,              flat.totalKm.weight,              totalDeadrunKm + totalProductiveKm)
  applyFlat(flat.distributionVariance.active, flat.distributionVariance.direction, flat.distributionVariance.weight, stdDev)
  applyFlat(flat.specialFleetUsage.active,    flat.specialFleetUsage.direction,    flat.specialFleetUsage.weight,    specialCount)

  return {
    score:             rangeScore + flatScore,
    fleetCount:        aggregates.length,
    deadrunKm:         totalDeadrunKm,
    productiveKm:      totalProductiveKm,
    totalKm:           totalDeadrunKm + totalProductiveKm,
    deadrunMinutes:    totalDeadrunMinutes,
    productiveMinutes: totalProductiveMinutes,
    totalMinutes:      totalBlockMinutes,
  }
}

// ── per-line aggregation (VehiclePlanLine.summary) ──────────────────────────────

export interface LineAggregate {
  blockIds:          Set<string>
  tripCount:         number
  productiveKm:      number
  productiveMinutes: number
  minDeparture:      number
  maxArrival:        number
  totalSupply:       number
  demand:            Record<string, Record<string, number>> | undefined
}

export interface LineAggregateBlockInput {
  id:          string
  vehicleType: string
  blockTrips: {
    trip: {
      departureMinutes: number
      arrivalMinutes:   number
      route: {
        lineId:                string
        originLocalityId:      string
        destinationLocalityId: string
        direction:             string
        line: { metrics: unknown }
      }
    }
  }[]
}

// vehicleTypeCapacity/renewal-adjusted supply per trip needs the caller's capacity
// table (VEHICLE_TYPE_CAPACITY) — passed in rather than imported, to keep this module
// free of any transit-domain constant coupling beyond the aggregate shapes it defines.
export function buildLineAggregates(
  blocks:              LineAggregateBlockInput[],
  matrixKm:            Record<string, number>,
  dayTypeCode:         string | undefined,
  vehicleTypeCapacity: Record<string, number>,
): Map<string, LineAggregate> {
  const lineAgg = new Map<string, LineAggregate>()

  for (const block of blocks) {
    for (const bt of block.blockTrips) {
      const route  = bt.trip.route
      const lineId = route.lineId

      let agg = lineAgg.get(lineId)
      if (!agg) {
        const lineMetrics = route.line.metrics as {
          demand?: Record<string, Record<string, Record<string, number>>>
        } | null
        agg = {
          blockIds: new Set(), tripCount: 0, productiveKm: 0, productiveMinutes: 0,
          minDeparture: Infinity, maxArrival: -Infinity, totalSupply: 0,
          demand: dayTypeCode ? lineMetrics?.demand?.[dayTypeCode] : undefined,
        }
        lineAgg.set(lineId, agg)
      }

      const extMetrics = route.line.metrics as { extensionKm?: Record<string, number> } | null
      const tripKm     = extMetrics?.extensionKm?.[route.direction]
        ?? matrixKm[`${route.originLocalityId}:${route.destinationLocalityId}`]
        ?? 0
      const renewal = (route.line.metrics as { renewalIndex?: { overall?: { value?: number } } } | null)
        ?.renewalIndex?.overall?.value ?? 0

      agg.blockIds.add(block.id)
      agg.tripCount++
      agg.productiveKm      += tripKm
      agg.productiveMinutes += bt.trip.arrivalMinutes - bt.trip.departureMinutes
      agg.minDeparture       = Math.min(agg.minDeparture, bt.trip.departureMinutes)
      agg.maxArrival         = Math.max(agg.maxArrival,   bt.trip.arrivalMinutes)
      agg.totalSupply       += (vehicleTypeCapacity[block.vehicleType] ?? 0) * (1 + renewal / 100)
    }
  }

  return lineAgg
}

const r2 = (n: number) => Math.round(n * 100) / 100

// score is left out on purpose — no formula exists yet for VehiclePlanLine (see
// docs/proposal/vehicle-plan-summary-score-consolidation.md §2.1/Fase 6). The caller
// supplies whatever value applies today (currently 0) so this stays the single seam
// to update once that formula is defined, instead of scattering it across callers.
export function computeLineSummary(agg: LineAggregate | undefined, score: number): Omit<VehiclePlanLineSummary, 'score'> & { score: number } {
  if (!agg || agg.tripCount === 0) {
    return {
      fleetSize: 0, dailyTrips: 0, operatingHours: 0, dailyKm: 0, avgSpeed: 0,
      occupancyIndex: 0, serviceFrequencyIndex: 0, peakPassengersPerHour: 0, score,
    }
  }

  const operatingHours  = (agg.maxArrival - agg.minDeparture) / 60
  const productiveHours = agg.productiveMinutes / 60

  let totalDemand           = 0
  let peakPassengersPerHour = 0
  for (const hourly of Object.values(agg.demand ?? {})) {
    for (const v of Object.values(hourly)) {
      totalDemand           += v
      peakPassengersPerHour  = Math.max(peakPassengersPerHour, v)
    }
  }

  return {
    fleetSize:             agg.blockIds.size,
    dailyTrips:            agg.tripCount,
    operatingHours:        r2(operatingHours),
    dailyKm:               r2(agg.productiveKm),
    avgSpeed:              productiveHours > 0 ? r2(agg.productiveKm / productiveHours) : 0,
    occupancyIndex:        agg.totalSupply  > 0 ? r2(totalDemand / agg.totalSupply)     : 0,
    serviceFrequencyIndex: operatingHours   > 0 ? r2(agg.tripCount / operatingHours)    : 0,
    peakPassengersPerHour,
    score,
  }
}
