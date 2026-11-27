// Goal planning analysis (docs/proposal/plan_goal_planning_v1.md) — pure, shared by the API
// (builds the context from the plan and suggests) and the goal screen (re-evaluates the levers
// the user edits). Etapa 1: fleet reduction.
//
// A line's fleet in a band is measured by frequency, never by blocks: cycle ÷ headway, i.e.
// ceil(cycle × departures / band minutes) with the departures of its busiest direction. The plan's
// fleet curve is the sum of the lines' fleets per half hour; the goal is a ceiling over it.

import type { Direction, LineGenMetrics } from '../line-generator/line-generator'
import { seedLineWindows, totalCycleMinutes } from '../line-generator/line-generator'
import type { RangeCriterion } from '../settings-planning.schema'
import type { VehiclePlanGoal } from '../vehicle-plan-goal.schema'

export const GOAL_SLOT_MINUTES = 30
export const GOAL_SLOTS        = 48
// empresa key of blocks without one (JSON record keys can't be null)
export const GOAL_NO_BRANCH    = ''

// weight of the relative frequency loss in a lever's cost, next to the demandMatch / maxGap
// modifiers — a starting point, validated against the test plans
const FREQUENCY_WEIGHT = 20
// how much faster the cost grows past a criterion's idealMax than inside it
const OVER_IDEAL_FACTOR = 4
// same tolerance the line generator modal seeds its bands with (Baixa)
const BAND_TOLERANCE = 1

// ── inputs (built by the API from the plan) ──────────────────────────────────

export interface GoalTripInput {
  lineId:           string
  direction:        Direction
  departureMinutes: number
  arrivalMinutes:   number
}

export interface GoalBlockInput {
  id:       string
  branchId: string | null
  trips:    GoalTripInput[]
}

export interface GoalRequirementInput {
  label:           string
  direction:       Direction
  earliestMinutes: number
  latestMinutes:   number
}

export interface GoalLineInput {
  lineId:       string
  code:         string
  metrics:      LineGenMetrics | null
  // the plan's day type, or the base day type of a special plan without data of its own
  dayTypeCode:  string
  // passengers per vehicle (lineVehicleCapacity)
  capacity:     number
  requirements: GoalRequirementInput[]
  lockedTrips:  number
  bundledTrips: number
  isDrifted:    boolean
}

export interface GoalCriteria {
  demandMatch: RangeCriterion
  maxGap:      RangeCriterion
}

// ── context ──────────────────────────────────────────────────────────────────

export interface GoalBand {
  from:         number // decimal hours, [from, to)
  to:           number
  // full round trip (both legs + both stops); 0 when the line has no registered cycle here
  cycleMinutes: number
  // departures of the busiest direction within the band
  departures:   number
  // cycle ÷ headway = cycle × departures / band minutes, rounded up — the band's frequency in cars
  // (what a cut takes from); 0 when the band can't be measured
  fleet:        number
  // most vehicles of the line on the road at once within the band (lineCurve, rounded up) — below
  // `fleet` when the band is shorter than the cycle
  peak:         number
  // most vehicles in service on the line at once within the band (cross-check)
  inService:    number
  // largest demand of an hour of the band, either direction — null: no demand data
  peakDemand:   number | null
  // the band's trips per empresa (GOAL_NO_BRANCH for blocks without one)
  branchTrips:  Record<string, number>
}

export type GoalLineAlert = 'NO_DEMAND' | 'NO_CYCLE' | 'IRREGULAR' | 'LOCKED' | 'BUNDLED' | 'DRIFTED'

export interface GoalLine {
  lineId:       string
  code:         string
  capacity:     number
  renewal:      number
  hasDemand:    boolean
  bands:        GoalBand[]
  // vehicles in service per half-hour slot and empresa — the curve where the cycle can't measure
  inServiceBySlot: Record<string, number[]>
  requirements: GoalRequirementInput[]
  alerts:       GoalLineAlert[]
}

export interface GoalContext {
  lines:    GoalLine[]
  criteria: GoalCriteria
}

const slotOfMinute = (m: number) => Math.floor((((m % 1440) + 1440) % 1440) / GOAL_SLOT_MINUTES)
const bandSlots    = (b: GoalBand) => {
  const out: number[] = []
  for (let s = Math.round(b.from * 2); s < Math.round(b.to * 2) && s < GOAL_SLOTS; s++) out.push(s)
  return out
}

/** Slots [from, to) a span touches, the operational day folded onto 24 h. */
function spanSlots(from: number, to: number): number[] {
  const out = new Set<number>()
  const end = Math.max(to, from + 1)
  for (let m = Math.floor(from / GOAL_SLOT_MINUTES) * GOAL_SLOT_MINUTES; m < end; m += GOAL_SLOT_MINUTES) out.add(slotOfMinute(m))
  return [...out]
}

export function buildGoalContext(blocks: GoalBlockInput[], lines: GoalLineInput[], criteria: GoalCriteria): GoalContext {
  // vehicles in service per line × empresa × slot: a trip, plus the layover up to the block's next
  // trip when that one is of the same line (a vehicle standing between two lines counts for neither)
  const inService = new Map<string, Map<string, number[]>>()
  const tripsByLine = new Map<string, { trip: GoalTripInput; branch: string }[]>()

  for (const block of blocks) {
    const branch = block.branchId ?? GOAL_NO_BRANCH
    const trips  = [...block.trips].sort((a, b) => a.departureMinutes - b.departureMinutes)
    const seen   = new Set<string>()
    trips.forEach((t, i) => {
      const list = tripsByLine.get(t.lineId) ?? []
      list.push({ trip: t, branch })
      tripsByLine.set(t.lineId, list)

      const next = trips[i + 1]
      const end  = next && next.lineId === t.lineId ? next.departureMinutes : t.arrivalMinutes
      for (const slot of spanSlots(t.departureMinutes, end)) {
        const key = `${t.lineId}:${slot}`
        if (seen.has(key)) continue
        seen.add(key)
        const byBranch = inService.get(t.lineId) ?? new Map<string, number[]>()
        const counts   = byBranch.get(branch) ?? new Array(GOAL_SLOTS).fill(0)
        counts[slot]++
        byBranch.set(branch, counts)
        inService.set(t.lineId, byBranch)
      }
    })
  }

  return {
    criteria,
    lines: lines.map(input => {
      const trips      = tripsByLine.get(input.lineId) ?? []
      const byBranch   = inService.get(input.lineId) ?? new Map<string, number[]>()
      const demand     = input.metrics?.demand?.[input.dayTypeCode]
      const hasDemand  = !!demand && Object.values(demand).some(h => h && Object.keys(h).length > 0)
      const renewal    = input.metrics?.renewalIndex?.overall ?? 0
      const totalInService = (slot: number) => [...byBranch.values()].reduce((s, c) => s + c[slot], 0)

      const bands: GoalBand[] = seedLineWindows(input.metrics, input.dayTypeCode, BAND_TOLERANCE, input.capacity)
        .filter(w => w.to > w.from)
        .map(w => {
          const lo = w.from * 60, hi = w.to * 60
          const inBand = trips.filter(({ trip }) => {
            const dep = ((trip.departureMinutes % 1440) + 1440) % 1440
            return dep >= lo && dep < hi
          })
          const perDirection = new Map<Direction, number>()
          const branchTrips: Record<string, number> = {}
          for (const { trip, branch } of inBand) {
            perDirection.set(trip.direction, (perDirection.get(trip.direction) ?? 0) + 1)
            branchTrips[branch] = (branchTrips[branch] ?? 0) + 1
          }
          const departures   = Math.max(0, ...perDirection.values())
          const cycleMinutes = w.outboundKnown && w.inboundKnown ? totalCycleMinutes(w) : 0
          const fleet = cycleMinutes > 0 && departures > 0
            ? Math.ceil(cycleMinutes * departures / (hi - lo) - 1e-9)
            : 0

          let peakDemand: number | null = null
          if (hasDemand) {
            peakDemand = 0
            for (let h = Math.floor(w.from); h < Math.ceil(w.to); h++) {
              for (const dir of Object.values(demand!)) peakDemand = Math.max(peakDemand, dir?.[String(h)] ?? 0)
            }
          }

          const band: GoalBand = { from: w.from, to: w.to, cycleMinutes, departures, fleet, peak: 0, inService: 0, peakDemand, branchTrips }
          band.inService = Math.max(0, ...bandSlots(band).map(totalInService))
          return band
        })

      const line: GoalLine = {
        lineId: input.lineId, code: input.code, capacity: input.capacity, renewal, hasDemand, bands,
        inServiceBySlot: Object.fromEntries(byBranch), requirements: input.requirements, alerts: [],
      }
      const curve = lineCurve(line, new Map(), null)
      for (const band of bands) {
        if (measurable(band)) band.peak = Math.max(0, ...bandSlots(band).map(s => Math.ceil(curve[s] - 1e-6)))
      }

      if (!hasDemand) line.alerts.push('NO_DEMAND')
      if (bands.some(b => b.departures > 0 && b.cycleMinutes === 0) || (bands.length === 0 && trips.length > 0)) line.alerts.push('NO_CYCLE')
      if (bands.some(b => measurable(b) && Math.abs(b.inService - b.peak) > 1)) line.alerts.push('IRREGULAR')
      if (input.lockedTrips > 0)  line.alerts.push('LOCKED')
      if (input.bundledTrips > 0) line.alerts.push('BUNDLED')
      if (input.isDrifted)        line.alerts.push('DRIFTED')
      return line
    }),
  }
}

// ── fleet per empresa ────────────────────────────────────────────────────────

/** Splits a band's fleet among its empresas in proportion to their trips (largest remainder). */
export function splitBandFleet(band: GoalBand, fleet: number): Record<string, number> {
  const keys  = Object.keys(band.branchTrips).sort()
  const total = keys.reduce((s, k) => s + band.branchTrips[k], 0)
  const out: Record<string, number> = {}
  if (total === 0 || fleet <= 0) { for (const k of keys) out[k] = 0; return out }
  const exact = keys.map(k => ({ k, v: fleet * band.branchTrips[k] / total }))
  let given = 0
  for (const e of exact) { out[e.k] = Math.floor(e.v); given += out[e.k] }
  exact.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)) || a.k.localeCompare(b.k))
  for (let i = 0; given < fleet; i++, given++) out[exact[i % exact.length].k]++
  return out
}

// the empresas a goal counts — null: all
const branchFilterOf = (goal: Pick<VehiclePlanGoal, 'branchIds'>): Set<string> | null =>
  goal.branchIds.length > 0 ? new Set(goal.branchIds) : null

const sumFiltered = (byBranch: Record<string, number>, filter: Set<string> | null) =>
  Object.entries(byBranch).reduce((s, [k, v]) => (!filter || filter.has(k) ? s + v : s), 0)

// ── levers and the curve ─────────────────────────────────────────────────────

// a cut of `cut` cars on one band of a line
export interface GoalLever {
  lineId:    string
  bandIndex: number
  cut:       number
}

const leverKey = (lineId: string, bandIndex: number) => `${lineId}#${bandIndex}`

type CutMap = Map<string, number>
const cutMapOf = (levers: GoalLever[]): CutMap => new Map(levers.filter(l => l.cut > 0).map(l => [leverKey(l.lineId, l.bandIndex), l.cut]))

const slotTime = (slot: number) => slot * GOAL_SLOT_MINUTES + GOAL_SLOT_MINUTES / 2

/** Minutes of [a, b] inside the band — a window reaching back past 00:00 wraps to the day's end. */
function overlapMinutes(band: GoalBand, a: number, b: number): number {
  const lo = band.from * 60, hi = band.to * 60
  let m = 0
  for (const shift of [0, -1440]) m += Math.max(0, Math.min(b, hi + shift) - Math.max(a, lo + shift))
  return m
}

const measurable = (band: GoalBand) => band.fleet > 0 && band.cycleMinutes > 0

/** Vehicles the band puts on the road per minute of it, counted for the goal's empresas, with
 *  `cut` cars out: departures per minute × (fleet after ÷ fleet), the fleet after split among the
 *  empresas as the generation will (splitBandFleet). */
function bandRate(band: GoalBand, cut: number, filter: Set<string> | null): number {
  const after = band.fleet - cut
  if (after <= 0) return 0
  const counted = filter ? sumFiltered(splitBandFleet(band, after), filter) : after
  return band.departures / ((band.to - band.from) * 60) * counted / band.fleet
}

/** The line's vehicles on the road at each half hour (its midpoint), fractional: the round trips
 *  started within the last cycle — in a band longer than the cycle, exactly cycle ÷ headway; at a
 *  peak shorter than the cycle, the vehicles still out from the lower frequency before it count
 *  instead of a full cycle of peak headway. Where the line has no registered cycle, the vehicles
 *  in service on its blocks. */
function lineCurve(line: GoalLine, cuts: CutMap, filter: Set<string> | null): number[] {
  const curve = new Array(GOAL_SLOTS).fill(0)
  for (let s = 0; s < GOAL_SLOTS; s++) {
    const t  = slotTime(s)
    const at = line.bands.find(b => t >= b.from * 60 && t < b.to * 60)
    if (!at || at.cycleMinutes === 0) {
      for (const [branch, counts] of Object.entries(line.inServiceBySlot)) {
        if (!filter || filter.has(branch)) curve[s] += counts[s]
      }
      continue
    }
    line.bands.forEach((band, i) => {
      if (!measurable(band)) return
      const minutes = overlapMinutes(band, t - at.cycleMinutes, t)
      if (minutes > 0) curve[s] += bandRate(band, cuts.get(leverKey(line.lineId, i)) ?? 0, filter) * minutes
    })
  }
  return curve
}

function planCurve(context: GoalContext, cuts: CutMap, filter: Set<string> | null): number[] {
  const curve = new Array(GOAL_SLOTS).fill(0)
  for (const line of context.lines) lineCurve(line, cuts, filter).forEach((v, s) => { curve[s] += v })
  return curve
}

// the plan's curve in whole vehicles; a half hour meets the ceiling when it rounds to it or below
const roundCurve = (curve: number[]) => curve.map(v => Math.round(v))
const excessOf   = (value: number, ceiling: number) => Math.max(0, value - (ceiling + 0.49))

// ── cost of a cut ────────────────────────────────────────────────────────────

// 1 = lines with demand inside the occupancy ceiling, 2 = lines without demand data,
// 3 = cuts past the occupancy ceiling — the suggestion exhausts each tier before the next
export type GoalLeverTier = 1 | 2 | 3

export interface GoalCutCost {
  blocked:    boolean
  tier:       GoalLeverTier
  cost:       number
  headway:    number
  occupancy:  number | null
  components: { occupancy: number | null; headway: number; frequency: number }
}

/** Grows slowly up to idealMax (the more slack, the cheaper), then OVER_IDEAL_FACTOR times
 *  faster up to the ceiling and beyond. */
function criterionCost(value: number, c: RangeCriterion): number {
  const ideal = Math.max(c.idealMax, 1)
  return Math.min(value, ideal) / ideal + OVER_IDEAL_FACTOR * Math.max(0, value - c.idealMax) / Math.max(c.ceiling - c.idealMax, 1)
}

/** Occupancy (%) of the band's busiest hour with `fleet` vehicles — null without demand data. */
export function bandOccupancy(line: GoalLine, band: GoalBand, fleet: number): number | null {
  if (band.peakDemand == null || band.cycleMinutes === 0 || fleet <= 0) return null
  const supplyPerHour = fleet * 60 / band.cycleMinutes * line.capacity * (1 + line.renewal / 100)
  return supplyPerHour > 0 ? band.peakDemand / supplyPerHour * 100 : null
}

export const bandHeadway = (band: GoalBand, fleet: number) => (fleet > 0 ? band.cycleMinutes / fleet : Infinity)

/** Cost of leaving the band with `fleetAfter` vehicles (one less than the step before). */
export function cutCost(line: GoalLine, band: GoalBand, fleetAfter: number, criteria: GoalCriteria, maxHeadway: number): GoalCutCost {
  const headway   = bandHeadway(band, fleetAfter)
  const occupancy = bandOccupancy(line, band, fleetAfter)
  const frequency = 1 / (fleetAfter + 1)
  const headwayC  = criterionCost(headway, criteria.maxGap)
  const occC      = occupancy == null ? null : criterionCost(occupancy, criteria.demandMatch)

  let weighted = criteria.maxGap.modifier * headwayC + FREQUENCY_WEIGHT * frequency
  let weights  = criteria.maxGap.modifier + FREQUENCY_WEIGHT
  if (occC != null) { weighted += criteria.demandMatch.modifier * occC; weights += criteria.demandMatch.modifier }

  const tier: GoalLeverTier = occupancy == null ? 2 : occupancy > criteria.demandMatch.ceiling ? 3 : 1
  return {
    blocked:    fleetAfter < 1 || headway > maxHeadway,
    tier,
    cost:       weights > 0 ? weighted / weights : 0,
    headway,
    occupancy,
    components: { occupancy: occC, headway: headwayC, frequency },
  }
}

const maxHeadwayOf = (goal: VehiclePlanGoal, criteria: GoalCriteria) => goal.maxHeadwayMinutes ?? criteria.maxGap.ceiling

// ── suggestion ───────────────────────────────────────────────────────────────

/** Greedy: while a half hour is above the ceiling, take the cheapest car (per excess it relieves)
 *  out of a band touching one, tier by tier. Each pick recalculates the curve and the next cut
 *  of that band — cutting the same band again costs more by itself (occupancy and headway grow). */
export function suggestGoalLevers(context: GoalContext, goal: VehiclePlanGoal): GoalLever[] {
  const filter     = branchFilterOf(goal)
  const maxHeadway = maxHeadwayOf(goal, context.criteria)
  const inScope    = new Set(goal.lineIds)
  const locked     = new Set(goal.lockedLineIds)
  const cuts: CutMap = new Map()

  const ceiling = Math.max(...roundCurve(planCurve(context, cuts, filter))) - goal.amount

  for (let guard = 0; guard < 10_000; guard++) {
    const curve  = planCurve(context, cuts, filter)
    const excess = curve.map(v => excessOf(v, ceiling))
    if (excess.every(e => e === 0)) break

    let best: { key: string; tier: GoalLeverTier; ratio: number } | null = null
    for (const line of context.lines) {
      if (locked.has(line.lineId) || (inScope.size > 0 && !inScope.has(line.lineId))) continue
      const base = lineCurve(line, cuts, filter)
      line.bands.forEach((band, i) => {
        if (!measurable(band)) return
        const key = leverKey(line.lineId, i)
        const cut = cuts.get(key) ?? 0
        if (goal.maxCutPerBand != null && cut >= goal.maxCutPerBand) return
        const step = cutCost(line, band, band.fleet - cut - 1, context.criteria, maxHeadway)
        if (step.blocked || (step.tier === 2 && !goal.useLinesWithoutDemand)) return

        // a car out of the band lowers the curve wherever the band's trips are still on the road
        const after = lineCurve(line, new Map(cuts).set(key, cut + 1), filter)
        let relief = 0
        for (let s = 0; s < GOAL_SLOTS; s++) relief += Math.min(base[s] - after[s], excess[s])
        if (relief <= 1e-9) return

        const ratio = step.cost / relief
        if (!best || step.tier < best.tier || (step.tier === best.tier && ratio < best.ratio)) best = { key, tier: step.tier, ratio }
      })
    }
    if (!best) break
    const { key } = best as { key: string }
    cuts.set(key, (cuts.get(key) ?? 0) + 1)
  }

  return [...cuts.entries()].map(([key, cut]) => {
    const [lineId, bandIndex] = key.split('#')
    return { lineId, bandIndex: Number(bandIndex), cut }
  })
}

// ── evaluation (suggested or user-edited levers) ─────────────────────────────

export interface GoalLeverDetail extends GoalLever {
  code:          string
  from:          number
  to:            number
  fleetBefore:   number
  fleetAfter:    number
  headwayBefore: number
  occBefore:     number | null
  byBranchBefore: Record<string, number>
  byBranchAfter:  Record<string, number>
  // the goal's empresas lose this many cars in the band (shared lines: the rest falls on the others)
  gain:          number
  // the cut's state after it (cost of the whole cut, its last step's tier)
  after:         GoalCutCost
  // requirement (marco) windows narrower than the new headway — the generator anchors a
  // departure in them, which may shift its neighbors or need a reinforcement
  requirements:  string[]
}

export interface GoalEvaluation {
  reference:   number   // peak of the curve before
  ceiling:     number   // reference − amount
  // vehicles on the road per half hour, whole (see lineCurve)
  curveBefore: number[]
  curveAfter:  number[]
  maxAfter:    number
  reached:     boolean
  // half hours still above the ceiling
  excessSlots: number[]
  levers:      GoalLeverDetail[]
}

export function evaluateGoal(context: GoalContext, goal: VehiclePlanGoal, levers: GoalLever[]): GoalEvaluation {
  const filter      = branchFilterOf(goal)
  const maxHeadway  = maxHeadwayOf(goal, context.criteria)
  const cuts        = cutMapOf(levers)
  const curveBefore = roundCurve(planCurve(context, new Map(), filter))
  const curveAfter  = roundCurve(planCurve(context, cuts, filter))
  const reference   = Math.max(...curveBefore)
  const ceiling     = reference - goal.amount
  const maxAfter    = Math.max(...curveAfter)
  const linesById   = new Map(context.lines.map(l => [l.lineId, l]))

  const details: GoalLeverDetail[] = []
  for (const lever of levers) {
    const line = linesById.get(lever.lineId)
    const band = line?.bands[lever.bandIndex]
    if (!line || !band || lever.cut <= 0) continue
    const fleetAfter     = band.fleet - lever.cut
    const byBranchBefore = splitBandFleet(band, band.fleet)
    const byBranchAfter  = splitBandFleet(band, fleetAfter)
    const after          = cutCost(line, band, fleetAfter, context.criteria, maxHeadway)
    const lo = band.from * 60, hi = band.to * 60
    const requirements = line.requirements
      .filter(r => {
        const e = ((r.earliestMinutes % 1440) + 1440) % 1440
        return e < hi && e + (r.latestMinutes - r.earliestMinutes) >= lo && r.latestMinutes - r.earliestMinutes < after.headway
      })
      .map(r => r.label)
    details.push({
      ...lever,
      code: line.code, from: band.from, to: band.to,
      fleetBefore: band.fleet, fleetAfter,
      headwayBefore: bandHeadway(band, band.fleet),
      occBefore:     bandOccupancy(line, band, band.fleet),
      byBranchBefore, byBranchAfter,
      gain: sumFiltered(byBranchBefore, filter) - sumFiltered(byBranchAfter, filter),
      after, requirements,
    })
  }

  return {
    reference, ceiling, curveBefore, curveAfter, maxAfter,
    reached:     maxAfter <= ceiling,
    excessSlots: curveAfter.flatMap((v, s) => (v > ceiling ? [s] : [])),
    levers:      details,
  }
}
