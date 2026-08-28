import type { SolverPlanningConfig, RangeCriterionConfig, AnchoredCriterionConfig } from '../solver/solver.types'
import type { BlockAggregate } from './block-aggregate'
import type { VehiclePlanLineSummary } from '@nyx/schemas'

// The single score formula in the system — extracted from the solver's scoreBlocks
// (solver.scoring.ts). Consumed today only by VehiclePlanService.recalculate (via
// BlockAggregate[] built from persisted state); a future solver revision is expected
// to converge onto this same function instead of keeping its own copy.
//
// Reform (docs/proposal/vehicle_plan_score_formula_v1.md): every criterion — plan and
// line level — maps to a bounded [0,1] reward, combined as a WEIGHTED AVERAGE (not
// sum) so the final score stays on a fixed, predictable, always-positive 0–9999 scale
// regardless of how many criteria are active or how weights are tuned.
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

// Banded reward for criteria whose floor is inferred at runtime (theoretical minimum
// km, peak vehicle requirement) instead of a config constant — idealMax/ceiling are
// expressed as % over that floor. Ratio 1.0 = at the theoretical minimum (best
// achievable). See proposal doc §6.2.
function anchoredV(realized: number, theoreticalMin: number, c: AnchoredCriterionConfig): number {
  if (theoreticalMin <= 0) return 1
  const ratio = realized / theoreticalMin
  return rangeV(ratio, {
    active: c.active, modifier: 0, floor: 1, idealMin: 1,
    idealMax: 1 + c.idealMaxOverPercent / 100,
    ceiling:  1 + c.ceilingOverPercent  / 100,
  })
}

// Peak Vehicle Requirement — sweep-line lower bound on the fleet needed to cover a
// set of trips (max number simultaneously in service), ignoring deadhead/turnaround
// between assignments. Standard transit-scheduling floor; anchors fleetUsage both at
// plan scope (all trips) and line scope (only that line's own trips — see §2.1, no
// interlining assumption).
export function peakVehicleRequirement(trips: { departureMinutes: number; arrivalMinutes: number }[]): number {
  if (trips.length === 0) return 0
  const events: [number, number][] = []
  for (const t of trips) {
    events.push([t.departureMinutes, 1])
    events.push([t.arrivalMinutes, -1])
  }
  // arrivals before departures at the same minute — a vehicle freed at T can cover a
  // trip departing at T without counting as two concurrent vehicles
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let concurrent = 0
  let peak       = 0
  for (const [, delta] of events) {
    concurrent += delta
    if (concurrent > peak) peak = concurrent
  }
  return peak
}

// Mirrors VehiclePlanService.PEAK_MORNING/PEAK_AFTERNOON — kept as a local constant
// since this module has no DI access to the service. Hour buckets (0–23) overlapping
// either band count as peak.
const PEAK_HOURS: [number, number][] = [[5.5, 8], [15.5, 18]]
const isPeakHour = (hour: number) => PEAK_HOURS.some(([from, to]) => hour >= from && hour < to)

// Actual headway within [bandFrom, bandTo) — avg gap between consecutive departures
// that fall in the band, per direction, then averaged across directions (equal
// weight per direction, same convention as the old registered-window average).
// Unlike TransitLine.metrics.windows (the line's registered target, identical
// across every plan), this reads the real scheduled departures for this specific
// side of the comparison — so draft/active/preview can actually differ.
function bandHeadway(
  tripsByDirection: Record<string, { departureMinutes: number }[]>,
  bandFrom: number,
  bandTo:   number,
): number | null {
  const perDirection: number[] = []
  for (const trips of Object.values(tripsByDirection)) {
    const departures = trips
      .map(t => t.departureMinutes)
      .filter(m => { const h = m / 60; return h >= bandFrom && h < bandTo })
      .sort((a, b) => a - b)
    if (departures.length < 2) continue
    let gapSum = 0
    for (let i = 1; i < departures.length; i++) gapSum += departures[i] - departures[i - 1]
    perDirection.push(gapSum / (departures.length - 1))
  }
  if (perDirection.length === 0) return null
  return Math.round(perDirection.reduce((s, v) => s + v, 0) / perDirection.length)
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
  planTrips:  { departureMinutes: number; arrivalMinutes: number }[],
  config:     Pick<SolverPlanningConfig, 'range' | 'anchored'>,
): AggregateScoreResult {
  let totalDeadrunKm         = 0
  let totalDeadrunMinutes    = 0
  let totalProductiveKm      = 0
  let totalProductiveMinutes = 0
  let totalBlockMinutes      = 0
  let totalTripCount         = 0
  let totalSpecialCount      = 0
  const durations: number[]  = []

  let weightedSum = 0
  let weightTotal = 0
  const add = (weight: number, value: number) => { weightedSum += weight * value; weightTotal += weight }

  const range = config.range

  for (const agg of aggregates) {
    const totalKm = agg.deadrunKm + agg.productiveKm
    const drRatio = totalKm > 0 ? (agg.deadrunKm / totalKm) * 100 : 0

    durations.push(agg.totalMinutes)
    totalDeadrunKm         += agg.deadrunKm
    totalDeadrunMinutes    += agg.deadrunMinutes
    totalProductiveKm      += agg.productiveKm
    totalProductiveMinutes += agg.productiveMinutes
    totalBlockMinutes      += agg.totalMinutes
    totalTripCount         += agg.tripCount
    totalSpecialCount      += agg.specialTripCount

    if (range.lineTransfer.active)
      add(range.lineTransfer.modifier, rangeV(agg.lineTransfers, range.lineTransfer))
    if (range.tripInterval.active && agg.intervalCount > 0)
      add(range.tripInterval.modifier, rangeV(agg.avgLayover, range.tripInterval))
    if (range.deadrunRatio.active)
      add(range.deadrunRatio.modifier, rangeV(drRatio, range.deadrunRatio))
    if (range.minBlockDuration.active)
      add(range.minBlockDuration.modifier, rangeV(agg.totalMinutes, range.minBlockDuration))
  }

  const mean   = durations.length > 0 ? totalBlockMinutes / durations.length : 0
  const stdDev = durations.length > 0
    ? Math.sqrt(durations.reduce((acc, d) => acc + (d - mean) ** 2, 0) / durations.length)
    : 0
  const durationCV = mean > 0 ? (stdDev / mean) * 100 : 0

  if (range.distributionVariance.active)
    add(range.distributionVariance.modifier, rangeV(durationCV, range.distributionVariance))

  const specialPercent = totalTripCount > 0 ? (totalSpecialCount / totalTripCount) * 100 : 0
  if (range.specialFleetUsage.active)
    add(range.specialFleetUsage.modifier, rangeV(specialPercent, range.specialFleetUsage))

  const anchored = config.anchored
  if (anchored.totalKm.active)
    add(anchored.totalKm.weight, anchoredV(totalDeadrunKm + totalProductiveKm, totalProductiveKm, anchored.totalKm))
  if (anchored.fleetUsage.active)
    add(anchored.fleetUsage.weight, anchoredV(aggregates.length, peakVehicleRequirement(planTrips), anchored.fleetUsage))

  const score = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * SCORE_SCALE) : 0

  return {
    score,
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
  blockKm:           Map<string, number>   // km this line contributes to each vehicle/block touching it
  tripCount:         number
  productiveKm:      number
  productiveMinutes: number
  minDeparture:      number
  maxArrival:        number
  totalSupply:       number
  demand:            Record<string, Record<string, number>> | undefined
  // per direction: each trip's window + capacity, for headway/gap/PVR/peak-concentration
  tripsByDirection:  Record<string, { departureMinutes: number; arrivalMinutes: number; supply: number }[]>
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
          blockIds: new Set(), blockKm: new Map(), tripCount: 0, productiveKm: 0, productiveMinutes: 0,
          minDeparture: Infinity, maxArrival: -Infinity, totalSupply: 0,
          demand: dayTypeCode ? lineMetrics?.demand?.[dayTypeCode] : undefined,
          tripsByDirection: {},
        }
        lineAgg.set(lineId, agg)
      }

      const extMetrics = route.line.metrics as { extensionKm?: Record<string, number> } | null
      const tripKm     = extMetrics?.extensionKm?.[route.direction]
        ?? matrixKm[`${route.originLocalityId}:${route.destinationLocalityId}`]
        ?? 0
      const renewal = (route.line.metrics as { renewalIndex?: { overall?: { value?: number } } } | null)
        ?.renewalIndex?.overall?.value ?? 0
      const supply = (vehicleTypeCapacity[block.vehicleType] ?? 0) * (1 + renewal / 100)

      agg.blockIds.add(block.id)
      agg.blockKm.set(block.id, (agg.blockKm.get(block.id) ?? 0) + tripKm)
      agg.tripCount++
      agg.productiveKm      += tripKm
      agg.productiveMinutes += bt.trip.arrivalMinutes - bt.trip.departureMinutes
      agg.minDeparture       = Math.min(agg.minDeparture, bt.trip.departureMinutes)
      agg.maxArrival         = Math.max(agg.maxArrival,   bt.trip.arrivalMinutes)
      agg.totalSupply       += supply

      const list = agg.tripsByDirection[route.direction] ?? (agg.tripsByDirection[route.direction] = [])
      list.push({ departureMinutes: bt.trip.departureMinutes, arrivalMinutes: bt.trip.arrivalMinutes, supply })
    }
  }

  return lineAgg
}

const r2 = (n: number) => Math.round(n * 100) / 100

function computeLineScore(agg: LineAggregate, cfg: SolverPlanningConfig['line']): number {
  let weightedSum = 0
  let weightTotal = 0
  const add = (weight: number, value: number) => { weightedSum += weight * value; weightTotal += weight }

  for (const [direction, trips] of Object.entries(agg.tripsByDirection)) {
    if (trips.length === 0) continue
    const demandByHour = agg.demand?.[direction]

    // ── demandMatch: occupancy per hour bucket, symmetric across directions ──
    if (cfg.demandMatch.active) {
      const supplyByHour = new Map<number, number>()
      for (const t of trips) {
        const hour = Math.floor(t.departureMinutes / 60) % 24
        supplyByHour.set(hour, (supplyByHour.get(hour) ?? 0) + t.supply)
      }
      const hours = new Set<number>([...supplyByHour.keys(), ...Object.keys(demandByHour ?? {}).map(Number)])
      for (const hour of hours) {
        const supply = supplyByHour.get(hour) ?? 0
        const demand = demandByHour?.[String(hour)] ?? 0
        if (supply === 0 && demand === 0) continue
        // fully unmet hour (demand recorded, zero service) — guaranteed worst reward
        const ratio = supply > 0 ? (demand / supply) * 100 : cfg.demandMatch.ceiling + 1
        add(cfg.demandMatch.modifier, rangeV(ratio, cfg.demandMatch))
      }
    }

    // ── headwayRegularity + maxGap: gaps between consecutive departures ──
    if (trips.length > 1 && (cfg.headwayRegularity.active || cfg.maxGap.active)) {
      const departures = trips.map(t => t.departureMinutes).sort((a, b) => a - b)
      const gaps: number[] = []
      for (let i = 1; i < departures.length; i++) gaps.push(departures[i] - departures[i - 1])

      if (cfg.headwayRegularity.active) {
        const gapMean = gaps.reduce((s, g) => s + g, 0) / gaps.length
        const gapStd  = Math.sqrt(gaps.reduce((s, g) => s + (g - gapMean) ** 2, 0) / gaps.length)
        const gapCV   = gapMean > 0 ? (gapStd / gapMean) * 100 : 0
        add(cfg.headwayRegularity.modifier, rangeV(gapCV, cfg.headwayRegularity))
      }
      if (cfg.maxGap.active)
        add(cfg.maxGap.modifier, rangeV(Math.max(...gaps), cfg.maxGap))
    }

    // ── peakConcentration: peak-hour share of supply vs. demand ──
    if (cfg.peakConcentration.active) {
      let peakSupply = 0, totalSupplyDir = 0
      for (const t of trips) {
        totalSupplyDir += t.supply
        if (isPeakHour(Math.floor(t.departureMinutes / 60) % 24)) peakSupply += t.supply
      }
      let peakDemand = 0, totalDemandDir = 0
      for (const [hourStr, v] of Object.entries(demandByHour ?? {})) {
        totalDemandDir += v
        if (isPeakHour(Number(hourStr))) peakDemand += v
      }
      if (totalSupplyDir > 0 && totalDemandDir > 0) {
        const supplyShare = peakSupply / totalSupplyDir
        const demandShare = peakDemand / totalDemandDir
        const ratio = demandShare > 0 ? (supplyShare / demandShare) * 100 : cfg.peakConcentration.ceiling + 1
        add(cfg.peakConcentration.modifier, rangeV(ratio, cfg.peakConcentration))
      }
    }
  }

  // ── distributionVariance: CV of km contributed per vehicle touching the line ──
  if (cfg.distributionVariance.active && agg.blockKm.size > 0) {
    const kms  = Array.from(agg.blockKm.values())
    const mean = kms.reduce((s, k) => s + k, 0) / kms.length
    const std  = Math.sqrt(kms.reduce((s, k) => s + (k - mean) ** 2, 0) / kms.length)
    const cv   = mean > 0 ? (std / mean) * 100 : 0
    add(cfg.distributionVariance.modifier, rangeV(cv, cfg.distributionVariance))
  }

  // ── fleetUsage: realized fleet vs. this line's own peak vehicle requirement ──
  // (no interlining assumption — only this line's trips, see proposal doc §2.1/§2.2)
  if (cfg.fleetUsage.active) {
    const allTrips = Object.values(agg.tripsByDirection).flat()
    const minFleet = peakVehicleRequirement(allTrips)
    add(cfg.fleetUsage.weight, anchoredV(agg.blockIds.size, minFleet, cfg.fleetUsage))
  }

  return weightTotal > 0 ? Math.round((weightedSum / weightTotal) * SCORE_SCALE) : 0
}

export function computeLineSummary(
  agg: LineAggregate | undefined,
  cfg: SolverPlanningConfig['line'],
): VehiclePlanLineSummary {
  if (!agg || agg.tripCount === 0) {
    return {
      fleetSize: 0, dailyTrips: 0, operatingHours: 0, dailyKm: 0, avgSpeed: 0,
      occupancyIndex: 0, serviceFrequencyIndex: 0, peakPassengersPerHour: 0,
      peakMorningInterval: null, peakAfternoonInterval: null, offPeakInterval: null,
      score: 0,
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
    peakMorningInterval:   bandHeadway(agg.tripsByDirection, PEAK_HOURS[0][0], PEAK_HOURS[0][1]),
    peakAfternoonInterval: bandHeadway(agg.tripsByDirection, PEAK_HOURS[1][0], PEAK_HOURS[1][1]),
    offPeakInterval:       bandHeadway(agg.tripsByDirection, PEAK_HOURS[0][1], PEAK_HOURS[1][0]),
    score: computeLineScore(agg, cfg),
  }
}
