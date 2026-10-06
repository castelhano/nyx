import type { BlockAggregate } from './block-aggregate'
import type { VehiclePlanLineSummary, PlanningSettings, RangeCriterion, AnchoredCriterion } from '@nyx/schemas'

// The single score formula in the system — VehiclePlanService.recalculate (BlockAggregate[]
// built from persisted state) and the vehicle solver (the same aggregate, from the rows it
// would persist) both go through PlanScoreState.
//
// Reform (docs/proposal/vehicle_plan_score_formula_v1.md): every criterion — plan and
// line level — maps to a bounded [0,1] reward, combined as a WEIGHTED AVERAGE (not
// sum) so the final score stays on a fixed, predictable, always-positive 0–9999 scale
// regardless of how many criteria are active or how weights are tuned.
export const SCORE_SCALE = 9999

export function rangeV(value: number, c: RangeCriterion): number {
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
export function anchoredV(realized: number, theoreticalMin: number, c: AnchoredCriterion): number {
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

// A block with a single trip inside [bandFrom, bandTo) doesn't represent the line's
// steady-state service in that band — a lone reinforcement run would otherwise skew both
// the average headway and the peak-fleet count for the whole band. A round trip is not a
// reinforcement: in a 2h30 peak a regular vehicle of a long line makes just that (one trip
// per direction used to count as isolated, which dropped half the fleet out of the peaks).
function excludeIsolatedReinforcement(
  tripsByDirection: Record<string, { departureMinutes: number; arrivalMinutes: number; blockId: string }[]>,
  bandFrom: number,
  bandTo:   number,
): Record<string, { departureMinutes: number; arrivalMinutes: number }[]> {
  const directions = Object.keys(tripsByDirection)
  const inBand: Record<string, { departureMinutes: number; arrivalMinutes: number; blockId: string }[]> = {}
  for (const dir of directions) {
    inBand[dir] = tripsByDirection[dir].filter(t => { const h = t.departureMinutes / 60; return h >= bandFrom && h < bandTo })
  }

  const countByBlock = new Map<string, Map<string, number>>()
  for (const dir of directions) {
    for (const t of inBand[dir]) {
      let byDir = countByBlock.get(t.blockId)
      if (!byDir) { byDir = new Map(); countByBlock.set(t.blockId, byDir) }
      byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
    }
  }

  const isolatedBlocks = new Set<string>()
  for (const [blockId, byDir] of countByBlock) {
    if ([...byDir.values()].reduce((s, n) => s + n, 0) <= 1) isolatedBlocks.add(blockId)
  }

  const filtered: Record<string, { departureMinutes: number; arrivalMinutes: number }[]> = {}
  for (const dir of directions) filtered[dir] = inBand[dir].filter(t => !isolatedBlocks.has(t.blockId))
  return filtered
}

// Actual headway within a band — avg gap between consecutive departures that fall
// in the band (isolated-reinforcement blocks already excluded — see
// excludeIsolatedReinforcement), per direction, then averaged across directions
// (equal weight per direction, same convention as the old registered-window
// average). Unlike TransitLine.metrics.windows (the line's registered target,
// identical across every plan), this reads the real scheduled departures for this
// specific side of the comparison — so draft/active/preview can actually differ.
function bandHeadway(bandTrips: Record<string, { departureMinutes: number }[]>): number | null {
  const perDirection: number[] = []
  for (const trips of Object.values(bandTrips)) {
    const departures = trips.map(t => t.departureMinutes).sort((a, b) => a - b)
    if (departures.length < 2) continue
    let gapSum = 0
    for (let i = 1; i < departures.length; i++) gapSum += departures[i] - departures[i - 1]
    perDirection.push(gapSum / (departures.length - 1))
  }
  if (perDirection.length === 0) return null
  return Math.round(perDirection.reduce((s, v) => s + v, 0) / perDirection.length)
}

// Peak concurrent fleet within a band — same sweep-line as peakVehicleRequirement,
// applied to the band's own (reinforcement-excluded) trips across every direction.
function peakFleetBand(bandTrips: Record<string, { departureMinutes: number; arrivalMinutes: number }[]>): number {
  return peakVehicleRequirement(Object.values(bandTrips).flat())
}

// One vehicle, for the plan's peak fleet: its trips.
export interface PeakFleetBlockInput {
  trips: { departureMinutes: number; arrivalMinutes: number; direction: string }[]
}

// The whole plan's peak fleet per band — the most vehicles running a trip at once, every line
// together: a vehicle is never in two trips at once, so one running two lines in the band counts
// once (summing the lines' peak fleets would count it once per line). Same measure as the lines'
// peakFleetBand and the same isolated-reinforcement rule, judged on the vehicle's trips in the
// band. What DOP sums up for a Scope.
export function planPeakFleets(blocks: PeakFleetBlockInput[]): { peakFleetMorning: number; peakFleetAfternoon: number; peakFleetOffPeak: number } {
  const band = (fromHour: number, toHour: number): number => {
    const tripsByDirection: Record<string, { departureMinutes: number; arrivalMinutes: number; blockId: string }[]> = {}
    blocks.forEach((block, i) => {
      for (const t of block.trips) (tripsByDirection[t.direction] ??= []).push({ ...t, blockId: String(i) })
    })
    return peakFleetBand(excludeIsolatedReinforcement(tripsByDirection, fromHour, toHour))
  }
  return {
    peakFleetMorning:   band(PEAK_HOURS[0][0], PEAK_HOURS[0][1]),
    peakFleetAfternoon: band(PEAK_HOURS[1][0], PEAK_HOURS[1][1]),
    peakFleetOffPeak:   band(PEAK_HOURS[0][1], PEAK_HOURS[1][0]),
  }
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

export type PlanScoreConfig = Pick<PlanningSettings, 'range' | 'anchored'>

// ScopeOperator.share by branchId (only the operators with a share > 0)
export type OperatorShares = Record<string, number>

// ScopeOperator rows → OperatorShares
export function operatorShares(operators: { branchId: string; share: number | null }[]): OperatorShares {
  return Object.fromEntries(operators.filter(o => (o.share ?? 0) > 0).map(o => [o.branchId, o.share!]))
}

// Plan score as a running sum over its blocks: add/remove a block's aggregate and read the
// score — what recalculate() computes in one pass and the vehicle solver updates move by move
// (only the touched blocks change). Every term is a sum over blocks (or derived from sums:
// the duration CV from Σd and Σd², the operator shares from per-branch fleet/km), so removing
// a block undoes its addition exactly up to float drift — the solver resyncs from scratch
// now and then.
const BLOCK_CRITERIA = ['lineTransfer', 'deadrunRatio', 'minBlockDuration'] as const
type BlockCriterion = typeof BLOCK_CRITERIA[number]

// rangeV without the floor at 0: inside the bands the same, past floor/ceiling it keeps falling
// with the band's slope (a band of zero width counts 1 per unit) down to -1 — a search still
// sees getting closer to the ceiling as better, but a criterion out of reach (e.g. a range that
// no solution meets) can't outweigh the others
export function rangeRaw(value: number, c: RangeCriterion): number {
  if (value < c.floor && c.idealMin > c.floor) return Math.max(-1, (value - c.floor) / (c.idealMin - c.floor))
  if (value > c.ceiling) return Math.max(-1, (c.ceiling - value) / (c.ceiling > c.idealMax ? c.ceiling - c.idealMax : 1))
  return rangeV(value, c)
}

function anchoredRaw(realized: number, theoreticalMin: number, c: AnchoredCriterion): number {
  if (theoreticalMin <= 0) return 1
  return rangeRaw(realized / theoreticalMin, {
    active: c.active, modifier: 0, floor: 1, idealMin: 1,
    idealMax: 1 + c.idealMaxOverPercent / 100,
    ceiling:  1 + c.ceilingOverPercent  / 100,
  })
}

export interface PlanCriterion { key: string; weight: number; value: number; raw: number }

// Plan score as a running sum over its blocks: add/remove a block's aggregate and read the
// score — what recalculate() computes in one pass and the vehicle solver updates move by move
// (only the touched blocks change). Every term comes from sums over the blocks (the duration CV
// from Σd and Σd², the operator shares from per-branch fleet/km), so removing a block undoes
// its addition up to float drift — the solver resyncs from scratch now and then.
//
// Score: every active criterion enters once with its weight — a per-block one (modifier) with
// the mean of its value over the blocks it applies to, a plan one with its value. Values are
// 0–1, so the score is 0–9999 and a criterion costs at most its share (weight ÷ Σ weights) —
// the same rule as the crew score.
export class PlanScoreState {
  private readonly peak: number
  private readonly shareTarget: Map<string, number>

  // per-block criteria: Σ value, Σ raw value, blocks counted
  private readonly perBlock = Object.fromEntries(BLOCK_CRITERIA.map(k => [k, { sum: 0, raw: 0, n: 0 }])) as Record<BlockCriterion, { sum: number; raw: number; n: number }>
  private fleet             = 0
  private sumDuration       = 0
  private sumDurationSq     = 0
  private deadrunKm         = 0
  private deadrunMinutes    = 0
  private productiveKm      = 0
  private productiveMinutes = 0
  private preferredTrips    = 0
  private preferredMisses   = 0
  // fleet / total km of the operators with a share
  private readonly branchFleet = new Map<string, number>()
  private readonly branchKm    = new Map<string, number>()

  constructor(
    private readonly config: PlanScoreConfig,
    planTrips: { departureMinutes: number; arrivalMinutes: number }[],
    shares:    OperatorShares = {},
  ) {
    this.peak = peakVehicleRequirement(planTrips)
    // targets normalized over the operators with a share — "among them, split like this"
    const entries = Object.entries(shares).filter(([, v]) => v > 0)
    const total   = entries.reduce((sum, [, v]) => sum + v, 0)
    this.shareTarget = new Map(entries.map(([id, v]) => [id, (v / total) * 100]))
  }

  add(agg: BlockAggregate):    void { this.apply(agg, 1) }
  remove(agg: BlockAggregate): void { this.apply(agg, -1) }

  private apply(agg: BlockAggregate, sign: 1 | -1): void {
    const range   = this.config.range
    const totalKm = agg.deadrunKm + agg.productiveKm
    const drRatio = totalKm > 0 ? (agg.deadrunKm / totalKm) * 100 : 0
    const block = (key: BlockCriterion, value: number) => {
      const c = this.perBlock[key]
      c.sum += sign * rangeV(value, range[key])
      c.raw += sign * rangeRaw(value, range[key])
      c.n   += sign
    }
    block('lineTransfer', agg.lineTransfers)
    block('deadrunRatio', drRatio)
    block('minBlockDuration', agg.totalMinutes)

    this.fleet             += sign
    this.sumDuration       += sign * agg.totalMinutes
    this.sumDurationSq     += sign * agg.totalMinutes ** 2
    this.deadrunKm         += sign * agg.deadrunKm
    this.deadrunMinutes    += sign * agg.deadrunMinutes
    this.productiveKm      += sign * agg.productiveKm
    this.productiveMinutes += sign * agg.productiveMinutes
    this.preferredTrips    += sign * agg.preferredTripCount
    this.preferredMisses   += sign * agg.preferredMissCount

    if (agg.branchId && this.shareTarget.has(agg.branchId)) {
      this.branchFleet.set(agg.branchId, (this.branchFleet.get(agg.branchId) ?? 0) + sign)
      this.branchKm.set(agg.branchId, (this.branchKm.get(agg.branchId) ?? 0) + sign * totalKm)
    }
  }

  // largest gap (p.p.) between each operator's part of `by` and its target share
  private shareDeviation(by: Map<string, number>): number {
    let total = 0
    for (const id of this.shareTarget.keys()) total += Math.max(0, by.get(id) ?? 0)
    if (total <= 0) return 0
    let worst = 0
    for (const [id, target] of this.shareTarget) {
      worst = Math.max(worst, Math.abs((Math.max(0, by.get(id) ?? 0) / total) * 100 - target))
    }
    return worst
  }

  // every active criterion: its weight, its value in [0,1] and its raw value (no floor at 0)
  criteria(): PlanCriterion[] {
    const { range, anchored } = this.config
    const out: PlanCriterion[] = []
    const plan = (key: keyof typeof range, value: number) =>
      out.push({ key, weight: range[key].modifier, value: rangeV(value, range[key]), raw: rangeRaw(value, range[key]) })

    for (const key of BLOCK_CRITERIA) {
      const c = this.perBlock[key]
      if (range[key].active && c.n > 0) out.push({ key, weight: range[key].modifier, value: c.sum / c.n, raw: c.raw / c.n })
    }
    if (range.distributionVariance.active && this.fleet > 0) {
      const mean     = this.sumDuration / this.fleet
      const variance = Math.max(0, this.sumDurationSq / this.fleet - mean ** 2)
      plan('distributionVariance', mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0)
    }
    if (range.preferredVehicleType.active && this.preferredTrips > 0)
      plan('preferredVehicleType', (this.preferredMisses / this.preferredTrips) * 100)
    // shares only mean something with at least two operators to split between
    if (this.shareTarget.size > 1) {
      if (range.operatorShareFleet.active) plan('operatorShareFleet', this.shareDeviation(this.branchFleet))
      if (range.operatorShareKm.active)    plan('operatorShareKm',    this.shareDeviation(this.branchKm))
    }
    if (anchored.totalKm.active) {
      const km = this.deadrunKm + this.productiveKm
      out.push({ key: 'totalKm', weight: anchored.totalKm.weight, value: anchoredV(km, this.productiveKm, anchored.totalKm), raw: anchoredRaw(km, this.productiveKm, anchored.totalKm) })
    }
    if (anchored.fleetUsage.active) {
      out.push({ key: 'fleetUsage', weight: anchored.fleetUsage.weight, value: anchoredV(this.fleet, this.peak, anchored.fleetUsage), raw: anchoredRaw(this.fleet, this.peak, anchored.fleetUsage) })
    }
    return out
  }

  // the weighted average in [0,1] — the score ÷ SCORE_SCALE
  value(criteria = this.criteria()): number {
    const weight = criteria.reduce((s, c) => s + c.weight, 0)
    return weight > 0 ? criteria.reduce((s, c) => s + c.weight * c.value, 0) / weight : 0
  }

  // the same average over the raw values — what the solver optimizes: a criterion already past
  // its ceiling still rewards getting closer to it
  rawScore(criteria = this.criteria()): number {
    const weight = criteria.reduce((s, c) => s + c.weight, 0)
    return weight > 0 ? criteria.reduce((s, c) => s + c.weight * c.raw, 0) / weight : 0
  }

  result(): AggregateScoreResult {
    return {
      score:             Math.round(this.value() * SCORE_SCALE),
      fleetCount:        this.fleet,
      deadrunKm:         this.deadrunKm,
      productiveKm:      this.productiveKm,
      totalKm:           this.deadrunKm + this.productiveKm,
      deadrunMinutes:    this.deadrunMinutes,
      productiveMinutes: this.productiveMinutes,
      totalMinutes:      this.sumDuration,
    }
  }
}

export function scoreFromAggregates(
  aggregates: BlockAggregate[],
  planTrips:  { departureMinutes: number; arrivalMinutes: number }[],
  config:     PlanScoreConfig,
  shares:     OperatorShares = {},
): AggregateScoreResult {
  const state = new PlanScoreState(config, planTrips, shares)
  for (const agg of aggregates) state.add(agg)
  return state.result()
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
  // per direction: each trip's window + capacity, for headway/gap/PVR/peak-concentration.
  // blockId is only needed by excludeIsolatedReinforcement (per-band reinforcement
  // detection) — everything else here ignores it.
  tripsByDirection:  Record<string, { departureMinutes: number; arrivalMinutes: number; supply: number; blockId: string }[]>
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
      const renewal = (route.line.metrics as { renewalIndex?: { overall?: number } } | null)
        ?.renewalIndex?.overall ?? 0
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
      list.push({ departureMinutes: bt.trip.departureMinutes, arrivalMinutes: bt.trip.arrivalMinutes, supply, blockId: block.id })
    }
  }

  return lineAgg
}

const r2 = (n: number) => Math.round(n * 100) / 100

function computeLineScore(agg: LineAggregate, cfg: PlanningSettings['line']): number {
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
  agg:      LineAggregate | undefined,
  cfg:      PlanningSettings['line'],
  idleKm:   number = 0,
  byBranch: VehiclePlanLineSummary['byBranch'] = [],
): VehiclePlanLineSummary {
  if (!agg || agg.tripCount === 0) {
    return {
      fleetSize: 0, dailyTrips: 0, operatingHours: 0, dailyKm: 0, avgSpeed: 0,
      occupancyIndex: 0, serviceFrequencyIndex: 0, peakPassengersPerHour: 0,
      peakMorningInterval: null, peakAfternoonInterval: null, offPeakInterval: null,
      peakFleetMorning: 0, peakFleetAfternoon: 0, peakFleetOffPeak: 0,
      idleKm: r2(idleKm), idlePct: idleKm > 0 ? 1 : 0,
      byBranch: byBranch.map(b => ({ ...b, kmProdutiva: r2(b.kmProdutiva), kmOciosa: r2(b.kmOciosa) })),
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

  const morningTrips   = excludeIsolatedReinforcement(agg.tripsByDirection, PEAK_HOURS[0][0], PEAK_HOURS[0][1])
  const afternoonTrips = excludeIsolatedReinforcement(agg.tripsByDirection, PEAK_HOURS[1][0], PEAK_HOURS[1][1])
  const offPeakTrips   = excludeIsolatedReinforcement(agg.tripsByDirection, PEAK_HOURS[0][1], PEAK_HOURS[1][0])

  return {
    fleetSize:             agg.blockIds.size,
    dailyTrips:            agg.tripCount,
    operatingHours:        r2(operatingHours),
    dailyKm:               r2(agg.productiveKm),
    avgSpeed:              productiveHours > 0 ? r2(agg.productiveKm / productiveHours) : 0,
    occupancyIndex:        agg.totalSupply  > 0 ? r2(totalDemand / agg.totalSupply)     : 0,
    serviceFrequencyIndex: operatingHours   > 0 ? r2(agg.tripCount / operatingHours)    : 0,
    peakPassengersPerHour,
    peakMorningInterval:   bandHeadway(morningTrips),
    peakAfternoonInterval: bandHeadway(afternoonTrips),
    offPeakInterval:       bandHeadway(offPeakTrips),
    peakFleetMorning:      peakFleetBand(morningTrips),
    peakFleetAfternoon:    peakFleetBand(afternoonTrips),
    peakFleetOffPeak:      peakFleetBand(offPeakTrips),
    idleKm:                r2(idleKm),
    idlePct:               (idleKm + agg.productiveKm) > 0 ? r2(idleKm / (idleKm + agg.productiveKm)) : 0,
    byBranch:              byBranch.map(b => ({ ...b, kmProdutiva: r2(b.kmProdutiva), kmOciosa: r2(b.kmOciosa) })),
    score: computeLineScore(agg, cfg),
  }
}
