import type {
  CrewSettings, CrewPlanSummary, DutySummary, DutyIssue, DutyPieceStaleReason, RangeCriterion, ReliefPoint,
} from '@nyx/schemas'
import { rangeV, anchoredV, SCORE_SCALE } from '../vehicle-plan/scoring/plan-scoring.calc'
import { isReliefPoint, subtractSpans } from './relief-points'
import { walkMeters, walkMinutes, type CrewWalk } from './crew-walk'

// Pure crew-plan calculation (no Prisma) — the CrewPlan counterpart of plan-scoring.calc.ts.
// Produces, from persisted state: each piece's staleness against its block, each duty's
// summary + issues, and the plan summary (coverage, totals, score). Consumed by
// CrewPlanService.recalculate().
//
// Conventions:
// - Stale pieces are left out of everything else (summary, issues, coverage) — the span
//   they used to cover shows up as uncovered, the duty shows up as stale.
// - When a duty has no explicit SIGN_ON/SIGN_OFF activity, settings.signOnMinutes /
//   signOffMinutes are assumed before its first / after its last piece.
// - Breaks are the BREAK activities only (the vehicle's own intervals are never assumed as
//   crew breaks). A break may sit inside a piece (idle time only, enforced by
//   duty-occupancy.utils.ts): that time is rest, but the vehicle stays covered.
// - workMinutes = pieces minus the breaks inside them + non-break activities + paid breaks
//   (IntervalType.isPaid) + implicit sign-on/off + idle time; paidMinutes = workMinutes;
//   overtime = workMinutes above workTime.idealMin. A paid break still is a break: it splits
//   continuous driving and counts in breakMinutes (MEAL_BREAK).
// - Idle time: the gaps between pieces minus their activities, except a split duty's split
//   interval (its longest gap) — the driver is at the employer's disposal (walking included).
//   Only the meal break and the split interval are off the clock.
// - Between pieces at different places the driver walks (crew-walk.ts), unless a TRAVEL
//   activity is declared there: beyond settings.maxWalkMeters → WALK_DISTANCE; a gap shorter
//   than the walk → TRAVEL_GAP.
// - Stops: the vehicle's idle time within the duty's pieces + the idle gaps between them
//   (breaks and the split interval aside). A STRAIGHT meets the intrajornada in any form
//   settings.mealRule accepts — continuous (a meal BREAK) or fractioned (the stops add up to
//   fractionedMinTotal, one of at least fractionedMinLongest) — else MEAL_REQUIRED. A SPLIT's
//   own split interval is its rest; none accepted = no requirement.
// - A break of settings.mealBreakIntervalTypeId is a MEAL_LOCATION warning unless its place is
//   an allowsMealBreak stop (RouteLocality — per route) of the line that arrives there.
//   Inside a piece: where the vehicle stands, i.e. its last arrival (a deadrun arrival has no
//   line → flagged); between pieces: the previous piece's end, on the trip it ends on.

export interface CrewCalcBlock {
  id:       string
  branchId: string | null
  window:   { startMinutes: number; endMinutes: number } | null
  // where the vehicle needs a driver — see BlockReliefData.serviceSpans
  serviceSpans: { startMinutes: number; endMinutes: number }[]
  points:   ReliefPoint[]
  trips:    { id: string; departureMinutes: number; arrivalMinutes: number; lineId: string; routeId: string }[]
  deadruns: { departureMinutes: number; arrivalMinutes: number }[]
}

// a block's trips + deadruns as spans (where the vehicle moves), cached per block object
const movingCache = new WeakMap<CrewCalcBlock, Span[]>()
function blockMoving(block: CrewCalcBlock): Span[] {
  let spans = movingCache.get(block)
  if (!spans) {
    spans = [...block.trips, ...block.deadruns]
      .map(e => ({ startMinutes: e.departureMinutes, endMinutes: e.arrivalMinutes }))
      .sort((a, b) => a.startMinutes - b.startMinutes)
    movingCache.set(block, spans)
  }
  return spans
}

export interface CrewCalcPiece {
  id:              string
  vehicleBlockId:  string | null
  startMinutes:    number
  endMinutes:      number
  startLocalityId: string
  endLocalityId:   string
}

export interface CrewCalcDuty {
  id:         string
  role:       string
  kind:       'STRAIGHT' | 'SPLIT' | 'TRIPPER' | 'STANDBY'
  branchId:   string | null
  pieces:     CrewCalcPiece[]
  activities: { id: string; type: string; intervalTypeId: string | null; startMinutes: number; endMinutes: number; isPaidBreak: boolean }[]
}

export interface CrewCalcResult {
  pieces: Map<string, { isStale: boolean; staleReason: DutyPieceStaleReason | null }>
  duties: Map<string, { summary: DutySummary; issues: DutyIssue[]; isStale: boolean }>
  summary: CrewPlanSummary
}

type Span = { startMinutes: number; endMinutes: number }

const dur = (s: Span) => s.endMinutes - s.startMinutes

// Meal allowed where the vehicle stands at `minutes`: its last arrival there (trip end, crew
// change stop or deadrun end, optionally at a given locality) must be a trip whose route marks
// that stop allowsMealBreak — "the line that arrives" rules; a deadrun arrival has no line.
// Shared with the crew solver, so both place/flag meals the same way.
export function mealStopAt(
  block: Pick<CrewCalcBlock, 'points' | 'trips'>, minutes: number, mealStops: Set<string>, localityId?: string,
): boolean {
  let arrival: ReliefPoint | undefined
  for (const p of block.points) {
    if (p.kind === 'TRIP_ORIGIN' || p.kind === 'DEADRUN_ORIGIN' || p.minutes > minutes) continue
    if (localityId && p.localityId !== localityId) continue
    if (!arrival || p.minutes >= arrival.minutes) arrival = p
  }
  const trip = arrival?.tripId ? block.trips.find(t => t.id === arrival.tripId) : undefined
  return !!arrival && !!trip && mealStops.has(`${trip.routeId}:${arrival.localityId}`)
}

// whether a break's place is a meal stop (see the header) — null when the break can't be
// placed (no piece before it)
function mealPlaceAllowed(b: Span, live: CrewCalcPiece[], blocks: Map<string, CrewCalcBlock>, mealStops: Set<string>): boolean | null {
  const inside = live.find(p => p.startMinutes <= b.startMinutes && p.endMinutes >= b.endMinutes)
  if (inside) {
    const block = blocks.get(inside.vehicleBlockId!)
    return !!block && mealStopAt(block, b.startMinutes, mealStops)
  }
  // where the previous piece ends (it may end at the next trip's departure, after the layover)
  const prev = live.filter(p => p.endMinutes <= b.startMinutes).at(-1)
  if (!prev) return null
  const block = blocks.get(prev.vehicleBlockId!)
  return !!block && mealStopAt(block, prev.endMinutes, mealStops, prev.endLocalityId)
}

function pieceStaleReason(p: CrewCalcPiece, block: CrewCalcBlock | undefined): DutyPieceStaleReason | null {
  if (!p.vehicleBlockId || !block) return 'BLOCK_REMOVED'
  if (!block.window || p.startMinutes < block.window.startMinutes || p.endMinutes > block.window.endMinutes) return 'OUT_OF_BLOCK_WINDOW'
  if (!isReliefPoint(block.points, p.startLocalityId, p.startMinutes) || !isReliefPoint(block.points, p.endLocalityId, p.endMinutes)) {
    return 'INVALID_RELIEF_POINT'
  }
  return null
}

// minutes of [start, end] inside the night window, the window repeating every day and
// possibly wrapping midnight (e.g. 22h → 5h); minutes > 1440 are the next calendar day
function nightOverlap(span: Span, startHour: number, endHour: number): number {
  const from = startHour * 60
  const to   = endHour <= startHour ? endHour * 60 + 1440 : endHour * 60
  let total = 0
  for (let day = -1; day <= 2; day++) {
    const w0 = from + day * 1440, w1 = to + day * 1440
    total += Math.max(0, Math.min(span.endMinutes, w1) - Math.max(span.startMinutes, w0))
  }
  return total
}

// value outside [floor, ceiling] → error; between the ideal and floor/ceiling it only costs score
function rangeIssue(code: DutyIssue['code'], value: number, c: RangeCriterion): DutyIssue | null {
  if (!c.active) return null
  if (value < c.floor)   return { code, severity: 'error', value, limit: c.floor }
  if (value > c.ceiling) return { code, severity: 'error', value, limit: c.ceiling }
  return null
}

// rangeV without the floor at 0: inside the bands the same, past floor/ceiling it keeps falling
// with the band's slope (a band of zero width counts 1 per unit)
function rangeRaw(value: number, c: RangeCriterion): number {
  if (value < c.floor && c.idealMin > c.floor) return (value - c.floor) / (c.idealMin - c.floor)
  if (value > c.ceiling) return (c.ceiling - value) / Math.max(c.ceiling - c.idealMax, 1)
  return rangeV(value, c)
}

function anchoredRaw(realized: number, theoreticalMin: number, c: CrewSettings['anchored']['dutyCount']): number {
  if (theoreticalMin <= 0) return 1
  return rangeRaw(realized / theoreticalMin, {
    active: c.active, modifier: 0, floor: 1, idealMin: 1,
    idealMax: 1 + c.idealMaxOverPercent / 100,
    ceiling:  1 + c.ceilingOverPercent  / 100,
  })
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.startMinutes - b.startMinutes)
  const out: Span[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.startMinutes <= last.endMinutes) last.endMinutes = Math.max(last.endMinutes, s.endMinutes)
    else out.push({ ...s })
  }
  return out
}

// What a duty's evaluation needs besides the duty itself — shared by every duty of a plan.
export interface CrewCalcContext {
  settings:      CrewSettings
  blocks:        Map<string, CrewCalcBlock>
  walk:          CrewWalk            // crew walking between relief points
  mealStops:     Set<string>         // `${routeId}:${localityId}` of RouteLocality.allowsMealBreak
  // the day type runs on consecutive days — enables DutySummary.interShiftRestMinutes
  repeatsNextDay?: boolean
}

export interface DutyEvaluation {
  summary:    DutySummary
  issues:     DutyIssue[]
  isStale:    boolean
  pieceState: Map<string, { isStale: boolean; staleReason: DutyPieceStaleReason | null }>
  // non-stale pieces, by start — the coverage they give
  live:       CrewCalcPiece[]
  // trip minutes per line inside the pieces — the duty's split across lines (byLine)
  lineMinutes: Map<string, number>
  // the per-duty score criteria that apply to this duty (active only), value 0–1 (raw: unfloored)
  criteria:   { key: string; weight: number; value: number; raw: number }[]
}

// One duty on its own: summary, issues and its per-duty score criteria. No plan state — the
// solver re-evaluates only the duties a move touches.
export function evaluateDuty(duty: CrewCalcDuty, ctx: CrewCalcContext): DutyEvaluation {
  const { settings, blocks } = ctx
  const range = settings.range

  const pieceState = new Map<string, { isStale: boolean; staleReason: DutyPieceStaleReason | null }>()
  const live: CrewCalcPiece[] = []
  for (const p of duty.pieces) {
    const reason = pieceStaleReason(p, p.vehicleBlockId ? blocks.get(p.vehicleBlockId) : undefined)
    pieceState.set(p.id, { isStale: reason != null, staleReason: reason })
    if (!reason) live.push(p)
  }
  live.sort((a, b) => a.startMinutes - b.startMinutes)
  const acts = [...duty.activities].sort((a, b) => a.startMinutes - b.startMinutes)

  const hasSignOn  = acts.some(a => a.type === 'SIGN_ON')
  const hasSignOff = acts.some(a => a.type === 'SIGN_OFF')
  const events     = [...live, ...acts]
  const implicitOn  = !hasSignOn  && live.length > 0 ? settings.signOnMinutes  : 0
  const implicitOff = !hasSignOff && live.length > 0 ? settings.signOffMinutes : 0

  // implicit sign-on/off extend the spread only when they fall outside the explicit events
  const first = events.length ? Math.min(...events.map(e => e.startMinutes), live.length ? live[0].startMinutes - implicitOn : Infinity) : 0
  const last  = events.length ? Math.max(...events.map(e => e.endMinutes), live.length ? live[live.length - 1].endMinutes + implicitOff : -Infinity) : 0

  const breaks       = acts.filter(a => a.type === 'BREAK')
  const breakMinutes = breaks.reduce((s, b) => s + dur(b), 0)
  const paidBreaks   = breaks.filter(b => b.isPaidBreak)
  // the time driven: live pieces minus every break taken inside them
  const segments     = live.flatMap(p => subtractSpans(p, breaks).map(s => ({ ...s, pieceId: p.id })))
  const pieceMinutes = segments.reduce((s, sg) => s + dur(sg), 0)
  const otherActs    = acts.filter(a => a.type !== 'BREAK')

  // gaps between consecutive pieces; in a split duty the longest one is the split interval
  const gaps = live.slice(1).map((p, i) => ({ prev: live[i], next: p, minutes: p.startMinutes - live[i].endMinutes }))
  const splitGap  = gaps.length ? Math.max(...gaps.map(g => g.minutes)) : 0
  const restGap   = duty.kind === 'SPLIT' ? gaps.find(g => g.minutes === splitGap) : undefined
  const idleSpans = gaps.filter(g => g !== restGap && g.minutes > 0)
    .flatMap(g => subtractSpans({ startMinutes: g.prev.endMinutes, endMinutes: g.next.startMinutes }, acts))
  const idleMinutes = idleSpans.reduce((s, sp) => s + dur(sp), 0)

  const workMinutes  = pieceMinutes + [...otherActs, ...paidBreaks].reduce((s, a) => s + dur(a), 0) + implicitOn + implicitOff + idleMinutes
  const paidMinutes  = workMinutes
  const overtime     = Math.max(0, workMinutes - range.workTime.idealMin)

  const workSpans: Span[] = [...segments, ...otherActs, ...paidBreaks, ...idleSpans]
  if (implicitOn)  workSpans.push({ startMinutes: live[0].startMinutes - implicitOn, endMinutes: live[0].startMinutes })
  if (implicitOff) workSpans.push({ startMinutes: live[live.length - 1].endMinutes, endMinutes: live[live.length - 1].endMinutes + implicitOff })
  const nightMinutes = workSpans.reduce((s, sp) => s + nightOverlap(sp, settings.nightStartHour, settings.nightEndHour), 0)

  let vehicleChanges = 0
  const lineSeq: string[] = []
  const lineMinutes = new Map<string, number>()
  for (let i = 0; i < live.length; i++) {
    if (i > 0 && live[i].vehicleBlockId !== live[i - 1].vehicleBlockId) vehicleChanges++
    const block = blocks.get(live[i].vehicleBlockId!)
    const trips = (block?.trips ?? [])
      .filter(t => t.arrivalMinutes > live[i].startMinutes && t.departureMinutes < live[i].endMinutes)
      .sort((a, b) => a.departureMinutes - b.departureMinutes)
    for (const t of trips) {
      if (lineSeq[lineSeq.length - 1] !== t.lineId) lineSeq.push(t.lineId)
      const overlap = Math.min(t.arrivalMinutes, live[i].endMinutes) - Math.max(t.departureMinutes, live[i].startMinutes)
      lineMinutes.set(t.lineId, (lineMinutes.get(t.lineId) ?? 0) + overlap)
    }
  }
  const lineChanges = Math.max(0, lineSeq.length - 1)

  // walking between pieces at different places (a declared TRAVEL there stands for it)
  let walked = 0
  const walkIssues: DutyIssue[] = []
  for (const g of gaps) {
    if (g.prev.endLocalityId === g.next.startLocalityId) continue
    if (acts.some(a => a.type === 'TRAVEL' && a.startMinutes >= g.prev.endMinutes && a.endMinutes <= g.next.startMinutes)) continue
    const meters = walkMeters(ctx.walk, g.prev.endLocalityId, g.next.startLocalityId)
    if (meters == null) {
      walkIssues.push({ code: 'TRAVEL_GAP', severity: 'warning', value: g.minutes, pieceId: g.next.id })
    } else if (meters > settings.maxWalkMeters) {
      walkIssues.push({ code: 'WALK_DISTANCE', severity: 'error', value: Math.round(meters), limit: settings.maxWalkMeters, pieceId: g.next.id })
    } else {
      walked += meters
      if (g.minutes < walkMinutes(meters)) walkIssues.push({ code: 'TRAVEL_GAP', severity: 'error', value: g.minutes, limit: walkMinutes(meters), pieceId: g.next.id })
    }
  }

  // stops (fractioned intrajornada): vehicle idle within the pieces + idle gaps, merged
  const stops = mergeSpans([
    ...live.flatMap(p => { const b = blocks.get(p.vehicleBlockId!); return b ? subtractSpans(p, [...blockMoving(b), ...acts]) : [] }),
    ...idleSpans,
  ]).filter(sp => dur(sp) > 0)
  const stopMinutes = stops.reduce((s, sp) => s + dur(sp), 0)
  const longestStop = stops.reduce((m, sp) => Math.max(m, dur(sp)), 0)

  const hasWork = live.length > 0
  const rule    = settings.mealRule
  let mealForm: DutySummary['mealForm'] = null
  if (hasWork && duty.kind === 'STRAIGHT') {
    const hasMeal = !!settings.mealBreakIntervalTypeId && breaks.some(b => b.intervalTypeId === settings.mealBreakIntervalTypeId)
    if (rule.continuous && hasMeal) mealForm = 'CONTINUOUS'
    else if (rule.fractioned && stopMinutes >= rule.fractionedMinTotal && longestStop >= rule.fractionedMinLongest) mealForm = 'FRACTIONED'
  }
  // what the meal criterion measures: the break, or the stops when fractioned
  const mealMinutes = mealForm === 'FRACTIONED' ? stopMinutes : breakMinutes

  const summary: DutySummary = {
    spreadMinutes: events.length ? last - first : 0,
    workMinutes, paidMinutes, breakMinutes,
    overtimeMinutes: overtime,
    nightMinutes,
    pieceCount: live.length,
    vehicleChanges, lineChanges,
    lineCount: lineMinutes.size,
    startMinutes: events.length ? first : null,
    endMinutes:   events.length ? last : null,
    interShiftRestMinutes: ctx.repeatsNextDay && events.length ? first + 1440 - last : null,
    idleMinutes,
    walkMeters: Math.round(walked),
    stopMinutes,
    longestStopMinutes: longestStop,
    mealForm,
  }

  // ── issues ───────────────────────────────────────────────────────────────
  const issues: DutyIssue[] = []
  const push = (i: DutyIssue | null) => { if (i) issues.push(i) }

  if (hasWork && duty.kind !== 'TRIPPER' && duty.kind !== 'STANDBY') push(rangeIssue('WORK_TIME', workMinutes, range.workTime))
  if (hasWork && duty.kind !== 'STANDBY') push(rangeIssue('SPREAD', summary.spreadMinutes, range.spread))
  if (hasWork && duty.kind === 'STRAIGHT') push(rangeIssue('MEAL_BREAK', mealMinutes, range.mealBreak))
  if (hasWork && duty.kind === 'STRAIGHT' && (rule.continuous || rule.fractioned) && !mealForm) {
    push(rule.fractioned
      ? { code: 'MEAL_REQUIRED', severity: 'error', value: stopMinutes, limit: rule.fractionedMinTotal }
      : { code: 'MEAL_REQUIRED', severity: 'error', value: breakMinutes })
  }
  if (hasWork && duty.kind === 'SPLIT') push(rangeIssue('SPLIT_INTERVAL', splitGap, range.splitInterval))

  // continuous driving: worked segments chained until a break sits between them (in the
  // gap between pieces or inside a piece) — or, in a split duty, the split interval itself
  const splitRest = duty.kind === 'SPLIT' ? range.splitInterval.floor : Infinity
  const restsBetween = (prev: Span, next: Span) => next.startMinutes - prev.endMinutes >= splitRest
    || breaks.some(b => b.startMinutes < next.startMinutes && b.endMinutes > prev.endMinutes)
  let chain = 0
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    chain = i === 0 || restsBetween(segments[i - 1], seg) ? dur(seg) : chain + dur(seg)
    const endsChain = i === segments.length - 1 || restsBetween(seg, segments[i + 1])
    if (endsChain && chain > settings.maxContinuousDrivingMinutes) {
      push({ code: 'CONTINUOUS_DRIVING', severity: 'error', value: chain, limit: settings.maxContinuousDrivingMinutes, pieceId: seg.pieceId })
    }
  }

  for (const p of live) {
    if (dur(p) < settings.minPieceMinutes) {
      push({ code: 'MIN_PIECE', severity: 'warning', value: dur(p), limit: settings.minPieceMinutes, pieceId: p.id })
    }
  }

  issues.push(...walkIssues)

  if (settings.mealBreakIntervalTypeId) {
    for (const b of breaks.filter(a => a.intervalTypeId === settings.mealBreakIntervalTypeId)) {
      if (mealPlaceAllowed(b, live, blocks, ctx.mealStops) === false) push({ code: 'MEAL_LOCATION', severity: 'warning', value: 0, activityId: b.id })
    }
  }

  if (duty.branchId) {
    for (const p of live) {
      const b = blocks.get(p.vehicleBlockId!)
      if (b?.branchId && b.branchId !== duty.branchId) push({ code: 'BRANCH_MISMATCH', severity: 'error', value: 0, pieceId: p.id })
    }
  }

  // per-duty criteria enter the plan score with the same applicability as the issues
  const criteria: DutyEvaluation['criteria'] = []
  const crit = (key: string, c: RangeCriterion, value: number) => {
    if (c.active) criteria.push({ key, weight: c.modifier, value: rangeV(value, c), raw: rangeRaw(value, c) })
  }
  if (hasWork) {
    if (duty.kind !== 'TRIPPER' && duty.kind !== 'STANDBY') crit('workTime', range.workTime, workMinutes)
    if (duty.kind !== 'STANDBY') crit('spread', range.spread, summary.spreadMinutes)
    if (duty.kind === 'STRAIGHT') crit('mealBreak', range.mealBreak, mealMinutes)
    if (duty.kind === 'SPLIT') crit('splitInterval', range.splitInterval, splitGap)
    crit('vehicleChanges', range.vehicleChanges, vehicleChanges)
    crit('lineChanges', range.lineChanges, lineChanges)
    crit('walkDistance', range.walkDistance, walked)
  }

  return { summary, issues, isStale: live.length !== duty.pieces.length, pieceState, live, lineMinutes, criteria }
}

// A block's DRIVER coverage over its service spans — only they need a driver (its own intervals
// and time parked at the depot don't; blockMinutes/coveredMinutes are measured on that basis).
function blockCoverage(block: CrewCalcBlock, pieces: Span[]): { covered: number; uncovered: Span[] } {
  const coverage = mergeSpans(pieces)
  const uncovered: Span[] = []
  let covered = 0
  for (const span of block.serviceSpans) {
    let cursor = span.startMinutes
    for (const s of coverage) {
      if (s.endMinutes <= cursor || s.startMinutes >= span.endMinutes) continue
      if (s.startMinutes > cursor) uncovered.push({ startMinutes: cursor, endMinutes: s.startMinutes })
      covered += Math.min(s.endMinutes, span.endMinutes) - Math.max(s.startMinutes, cursor)
      cursor = Math.min(span.endMinutes, Math.max(cursor, s.endMinutes))
    }
    if (cursor < span.endMinutes) uncovered.push({ startMinutes: cursor, endMinutes: span.endMinutes })
  }
  return { covered, uncovered }
}

// Plan state behind the score, kept incrementally: add/remove a duty (with its evaluation) and
// read the score without walking the plan — what the solver's moves need. computeCrewPlan scores
// through it too, so the screen and the solver share one rule.
//
// Score: every active criterion enters once with its weight — a per-duty one with the mean of
// its value over the duties it applies to, a plan one with its value. Values are 0–1, so the
// score is 0–9999 and a criterion costs at most its share (weight ÷ Σ weights).
export class CrewScoreAggregate {
  readonly blockMinutes: number
  private dutyCount = 0
  private driverDuties = 0
  private driverPaid = 0
  private totalWork = 0
  private totalOvertime = 0
  private readonly byKind  = new Map<string, number>()
  private readonly perDuty = new Map<string, { weight: number; sum: number; raw: number; n: number }>()
  // DRIVER pieces per block, and each block's covered minutes (recomputed only when touched)
  private readonly pieces  = new Map<string, CrewCalcPiece[]>()
  // DRIVER duties per block (duty id → its pieces there) and the running totals of the mean
  private readonly drivers = new Map<string, Map<string, number>>()
  private driverSlots = 0
  private drivenBlocks = 0
  private readonly covered = new Map<string, number>()
  private readonly dirty   = new Set<string>()

  constructor(private readonly ctx: CrewCalcContext) {
    let total = 0
    for (const b of ctx.blocks.values()) for (const s of b.serviceSpans) total += dur(s)
    this.blockMinutes = total
  }

  add(duty: Pick<CrewCalcDuty, 'id' | 'role' | 'kind'>, ev: DutyEvaluation): void { this.apply(duty, ev, 1) }

  remove(duty: Pick<CrewCalcDuty, 'id' | 'role' | 'kind'>, ev: DutyEvaluation): void { this.apply(duty, ev, -1) }

  private apply(duty: Pick<CrewCalcDuty, 'id' | 'role' | 'kind'>, ev: DutyEvaluation, sign: 1 | -1): void {
    this.dutyCount += sign
    this.byKind.set(duty.kind, (this.byKind.get(duty.kind) ?? 0) + sign)
    this.totalWork     += sign * ev.summary.workMinutes
    this.totalOvertime += sign * ev.summary.overtimeMinutes
    for (const c of ev.criteria) {
      const cur = this.perDuty.get(c.key) ?? { weight: c.weight, sum: 0, raw: 0, n: 0 }
      cur.sum += sign * c.value; cur.raw += sign * c.raw; cur.n += sign
      this.perDuty.set(c.key, cur)
    }
    if (duty.role !== 'DRIVER') return
    this.driverDuties += sign
    this.driverPaid   += sign * ev.summary.paidMinutes
    for (const p of ev.live) {
      const list = this.pieces.get(p.vehicleBlockId!) ?? []
      this.pieces.set(p.vehicleBlockId!, sign > 0 ? [...list, p] : list.filter(x => x !== p))
      this.dirty.add(p.vehicleBlockId!)

      const byDuty = this.drivers.get(p.vehicleBlockId!) ?? new Map<string, number>()
      const before = byDuty.size
      const n = (byDuty.get(duty.id) ?? 0) + sign
      if (n > 0) byDuty.set(duty.id, n)
      else byDuty.delete(duty.id)
      this.drivers.set(p.vehicleBlockId!, byDuty)
      this.driverSlots += byDuty.size - before
      this.drivenBlocks += (byDuty.size > 0 ? 1 : 0) - (before > 0 ? 1 : 0)
    }
  }

  // distinct DRIVER duties per vehicle, mean over the vehicles with a driver
  get driversPerVehicle(): number {
    return this.drivenBlocks > 0 ? this.driverSlots / this.drivenBlocks : 0
  }

  piecesOf(blockId: string): CrewCalcPiece[] { return this.pieces.get(blockId) ?? [] }

  get coveredMinutes(): number {
    for (const id of this.dirty) {
      const block = this.ctx.blocks.get(id)
      this.covered.set(id, block ? blockCoverage(block, this.piecesOf(id)).covered : 0)
    }
    this.dirty.clear()
    let total = 0
    for (const m of this.covered.values()) total += m
    return total
  }

  kindCount(kind: string): number { return this.byKind.get(kind) ?? 0 }

  criteria(): CrewPlanSummary['criteria'] {
    const { range, anchored } = this.ctx.settings
    const out: CrewPlanSummary['criteria'] = []
    for (const [key, c] of this.perDuty) if (c.n > 0) out.push({ key, weight: c.weight, value: c.sum / c.n, raw: c.raw / c.n })
    if (this.dutyCount <= 0) return out
    const plan = (key: 'overtimeRatio' | 'splitRatio' | 'tripperRatio' | 'coverage' | 'driversPerVehicle', value: number) => {
      if (range[key].active) out.push({ key, weight: range[key].modifier, value: rangeV(value, range[key]), raw: rangeRaw(value, range[key]) })
    }
    const covered = this.coveredMinutes
    plan('overtimeRatio', this.totalWork > 0 ? (this.totalOvertime / this.totalWork) * 100 : 0)
    plan('splitRatio',   (this.kindCount('SPLIT') / this.dutyCount) * 100)
    plan('tripperRatio', (this.kindCount('TRIPPER') / this.dutyCount) * 100)
    if (anchored.dutyCount.active && range.workTime.idealMin > 0) {
      const min = Math.ceil(this.blockMinutes / range.workTime.idealMin)
      out.push({ key: 'dutyCount', weight: anchored.dutyCount.weight, value: anchoredV(this.driverDuties, min, anchored.dutyCount), raw: anchoredRaw(this.driverDuties, min, anchored.dutyCount) })
    }
    if (anchored.efficiency.active) {
      out.push({ key: 'efficiency', weight: anchored.efficiency.weight, value: anchoredV(this.driverPaid, covered, anchored.efficiency), raw: anchoredRaw(this.driverPaid, covered, anchored.efficiency) })
    }
    if (this.blockMinutes > 0) plan('coverage', (covered / this.blockMinutes) * 100)
    if (this.drivenBlocks > 0) plan('driversPerVehicle', this.driversPerVehicle)
    return out
  }

  // unrounded — a single duty moves the mean by less than a point
  score(criteria = this.criteria()): number {
    const weightTotal = criteria.reduce((s, c) => s + c.weight, 0)
    return weightTotal > 0 ? (criteria.reduce((s, c) => s + c.weight * c.value, 0) / weightTotal) * SCORE_SCALE : 0
  }

  // same from the unfloored values — what the solver optimizes
  rawScore(criteria = this.criteria()): number {
    const weightTotal = criteria.reduce((s, c) => s + c.weight, 0)
    return weightTotal > 0 ? (criteria.reduce((s, c) => s + c.weight * (c.raw ?? c.value), 0) / weightTotal) * SCORE_SCALE : 0
  }
}

export function computeCrewPlan(input: {
  duties:        CrewCalcDuty[]
  blocks:        CrewCalcBlock[]
  settings:      CrewSettings
  walk:          CrewWalk            // crew walking between relief points
  mealStops:     Set<string>         // `${routeId}:${localityId}` of RouteLocality.allowsMealBreak
  // the day type runs on consecutive days — enables DutySummary.interShiftRestMinutes
  repeatsNextDay?: boolean
}): CrewCalcResult {
  const ctx: CrewCalcContext = {
    settings: input.settings, blocks: new Map(input.blocks.map(b => [b.id, b])),
    walk: input.walk, mealStops: input.mealStops, repeatsNextDay: input.repeatsNextDay,
  }
  const agg = new CrewScoreAggregate(ctx)

  const pieceState = new Map<string, { isStale: boolean; staleReason: DutyPieceStaleReason | null }>()
  const dutyOut    = new Map<string, { summary: DutySummary; issues: DutyIssue[]; isStale: boolean }>()

  let totalWork = 0, totalPaid = 0, totalOvertime = 0, totalNight = 0
  const byLine   = new Map<string, CrewPlanSummary['byLine'][number]>()
  const byBranch = new Map<string, CrewPlanSummary['byBranch'][number]>()
  const byRole: Record<string, number> = {}
  const byKind: Record<string, number> = {}

  for (const duty of input.duties) {
    byRole[duty.role] = (byRole[duty.role] ?? 0) + 1
    byKind[duty.kind] = (byKind[duty.kind] ?? 0) + 1

    const ev = evaluateDuty(duty, ctx)
    for (const [id, st] of ev.pieceState) pieceState.set(id, st)
    dutyOut.set(duty.id, { summary: ev.summary, issues: ev.issues, isStale: ev.isStale })
    agg.add(duty, ev)

    // ── plan-level accumulation ──────────────────────────────────────────────
    const { workMinutes, paidMinutes, overtimeMinutes: overtime, nightMinutes } = ev.summary
    totalWork += workMinutes; totalPaid += paidMinutes; totalOvertime += overtime; totalNight += nightMinutes

    const tripTotal = [...ev.lineMinutes.values()].reduce((s, m) => s + m, 0)
    const shares: [string | null, number][] = tripTotal > 0
      ? [...ev.lineMinutes].map(([lineId, m]) => [lineId, m / tripTotal])
      : [[null, 1]]
    for (const [lineId, share] of shares) {
      const key = `${lineId ?? ''}|${duty.role}|${duty.branchId ?? ''}`
      const cur = byLine.get(key) ?? { lineId, role: duty.role, branchId: duty.branchId, dutyShare: 0, workMinutes: 0, paidMinutes: 0, overtimeMinutes: 0, nightMinutes: 0 }
      cur.dutyShare       += share
      cur.workMinutes     += workMinutes * share
      cur.paidMinutes     += paidMinutes * share
      cur.overtimeMinutes += overtime * share
      cur.nightMinutes    += nightMinutes * share
      byLine.set(key, cur)
    }
    const branchKey = `${duty.branchId ?? ''}|${duty.role}`
    const branch = byBranch.get(branchKey) ?? { branchId: duty.branchId, role: duty.role, dutyCount: 0, paidMinutes: 0, overtimeMinutes: 0, nightMinutes: 0 }
    branch.dutyCount++
    branch.paidMinutes     += paidMinutes
    branch.overtimeMinutes += overtime
    branch.nightMinutes    += nightMinutes
    byBranch.set(branchKey, branch)
  }

  // ── coverage (DRIVER only) ─────────────────────────────────────────────────
  const uncovered: CrewPlanSummary['uncovered'] = []
  let coveredMinutes = 0
  const coveredByBranch = new Map<string | null, number>()
  for (const b of input.blocks) {
    const cov = blockCoverage(b, agg.piecesOf(b.id))
    for (const u of cov.uncovered) uncovered.push({ vehicleBlockId: b.id, ...u })
    coveredMinutes += cov.covered
    coveredByBranch.set(b.branchId, (coveredByBranch.get(b.branchId) ?? 0) + cov.covered)
  }

  const criteria   = agg.criteria()
  const dutyValues = [...dutyOut.values()]
  return {
    pieces: pieceState,
    duties: dutyOut,
    summary: {
      dutyCount:        input.duties.length,
      byRole, byKind,
      workMinutes:      totalWork,
      paidMinutes:      totalPaid,
      overtimeMinutes:  totalOvertime,
      nightMinutes:     totalNight,
      uncoveredMinutes: uncovered.reduce((s, u) => s + dur(u), 0),
      uncovered,
      staleDutyCount:   dutyValues.filter(d => d.isStale).length,
      issueDutyCount:   dutyValues.filter(d => d.issues.length > 0).length,
      score:            Math.round(agg.score(criteria)),
      rawScore:         Math.round(agg.rawScore(criteria)),
      driversPerVehicle: agg.driversPerVehicle,
      criteria,
      coveredMinutes,
      coveredByBranch:  [...coveredByBranch].map(([branchId, minutes]) => ({ branchId, minutes })),
      byLine:           [...byLine.values()],
      byBranch:         [...byBranch.values()],
    },
  }
}
