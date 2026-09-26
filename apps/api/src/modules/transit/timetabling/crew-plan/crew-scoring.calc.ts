import type {
  CrewSettings, CrewPlanSummary, DutySummary, DutyIssue, DutyPieceStaleReason, RangeCriterion, ReliefPoint,
} from '@nyx/schemas'
import { rangeV, anchoredV, SCORE_SCALE } from '../vehicle-plan/scoring/plan-scoring.calc'
import { isReliefPoint, subtractSpans } from './relief-points'

// Pure crew-plan calculation (no Prisma) — the CrewPlan counterpart of plan-scoring.calc.ts.
// Produces, from persisted state: each piece's staleness against its block, each duty's
// summary + issues, and the plan summary (coverage, totals, score). Consumed by
// CrewPlanService.recalculate(). See docs/proposal/plan_crew_plan_v1.md ("Sinalização").
//
// Conventions:
// - Stale pieces are left out of everything else (summary, issues, coverage) — the span
//   they used to cover shows up as uncovered, the duty shows up as stale.
// - When a duty has no explicit SIGN_ON/SIGN_OFF activity, settings.signOnMinutes /
//   signOffMinutes are assumed before its first / after its last piece.
// - Breaks are the BREAK activities only (the vehicle's own intervals are never assumed as
//   crew breaks). A break may sit inside a piece (idle time only, enforced by
//   duty-occupancy.utils.ts): that time is rest, not work, but the vehicle stays covered.
// - workMinutes = pieces minus the breaks inside them + non-break activities + implicit
//   sign-on/off; paidMinutes adds paid breaks (IntervalType.isPaid); overtime = workMinutes
//   above workTime.idealMin.

export interface CrewCalcBlock {
  id:       string
  branchId: string | null
  window:   { startMinutes: number; endMinutes: number } | null
  // where the vehicle needs a driver — see BlockReliefData.serviceSpans
  serviceSpans: { startMinutes: number; endMinutes: number }[]
  points:   ReliefPoint[]
  trips:    { departureMinutes: number; arrivalMinutes: number; lineId: string }[]
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
  activities: { type: string; startMinutes: number; endMinutes: number; isPaidBreak: boolean }[]
}

export interface CrewCalcResult {
  pieces: Map<string, { isStale: boolean; staleReason: DutyPieceStaleReason | null }>
  duties: Map<string, { summary: DutySummary; issues: DutyIssue[]; isStale: boolean }>
  summary: CrewPlanSummary
}

type Span = { startMinutes: number; endMinutes: number }

const dur = (s: Span) => s.endMinutes - s.startMinutes

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

// value outside [floor, ceiling] → error; outside [idealMin, idealMax] → warning
function rangeIssue(code: DutyIssue['code'], value: number, c: RangeCriterion): DutyIssue | null {
  if (!c.active) return null
  if (value < c.floor)    return { code, severity: 'error',   value, limit: c.floor }
  if (value > c.ceiling)  return { code, severity: 'error',   value, limit: c.ceiling }
  if (value < c.idealMin) return { code, severity: 'warning', value, limit: c.idealMin }
  if (value > c.idealMax) return { code, severity: 'warning', value, limit: c.idealMax }
  return null
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

export function computeCrewPlan(input: {
  duties:        CrewCalcDuty[]
  blocks:        CrewCalcBlock[]
  settings:      CrewSettings
  matrixMinutes: Map<string, number> // `${from}:${to}` → baseMinutes (crew travel between relief points)
}): CrewCalcResult {
  const { settings } = input
  const range  = settings.range
  const blocks = new Map(input.blocks.map(b => [b.id, b]))

  const pieceState = new Map<string, { isStale: boolean; staleReason: DutyPieceStaleReason | null }>()
  const dutyOut    = new Map<string, { summary: DutySummary; issues: DutyIssue[]; isStale: boolean }>()

  let weightedSum = 0, weightTotal = 0
  const add = (weight: number, value: number) => { weightedSum += weight * value; weightTotal += weight }

  const driverCoverage = new Map<string, Span[]>()
  let totalWork = 0, totalPaid = 0, totalOvertime = 0, totalNight = 0
  let driverDuties = 0, driverPaid = 0
  const byRole: Record<string, number> = {}
  const byKind: Record<string, number> = {}

  for (const duty of input.duties) {
    byRole[duty.role] = (byRole[duty.role] ?? 0) + 1
    byKind[duty.kind] = (byKind[duty.kind] ?? 0) + 1

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
    const paidBreak    = breaks.filter(b => b.isPaidBreak).reduce((s, b) => s + dur(b), 0)
    // the time actually worked on vehicles: live pieces minus the breaks taken inside them
    const segments     = live.flatMap(p => subtractSpans(p, breaks).map(s => ({ ...s, pieceId: p.id })))
    const pieceMinutes = segments.reduce((s, sg) => s + dur(sg), 0)
    const otherActs    = acts.filter(a => a.type !== 'BREAK')
    const workMinutes  = pieceMinutes + otherActs.reduce((s, a) => s + dur(a), 0) + implicitOn + implicitOff
    const paidMinutes  = workMinutes + paidBreak
    const overtime     = Math.max(0, workMinutes - range.workTime.idealMin)

    const workSpans: Span[] = [...segments, ...otherActs]
    if (implicitOn)  workSpans.push({ startMinutes: live[0].startMinutes - implicitOn, endMinutes: live[0].startMinutes })
    if (implicitOff) workSpans.push({ startMinutes: live[live.length - 1].endMinutes, endMinutes: live[live.length - 1].endMinutes + implicitOff })
    const nightMinutes = workSpans.reduce((s, sp) => s + nightOverlap(sp, settings.nightStartHour, settings.nightEndHour), 0)

    let vehicleChanges = 0
    const lineSeq: string[] = []
    for (let i = 0; i < live.length; i++) {
      if (i > 0 && live[i].vehicleBlockId !== live[i - 1].vehicleBlockId) vehicleChanges++
      const block = blocks.get(live[i].vehicleBlockId!)
      const trips = (block?.trips ?? [])
        .filter(t => t.arrivalMinutes > live[i].startMinutes && t.departureMinutes < live[i].endMinutes)
        .sort((a, b) => a.departureMinutes - b.departureMinutes)
      for (const t of trips) if (lineSeq[lineSeq.length - 1] !== t.lineId) lineSeq.push(t.lineId)
    }
    const lineChanges = Math.max(0, lineSeq.length - 1)

    const summary: DutySummary = {
      spreadMinutes: events.length ? last - first : 0,
      workMinutes, paidMinutes, breakMinutes,
      overtimeMinutes: overtime,
      nightMinutes,
      pieceCount: live.length,
      vehicleChanges, lineChanges,
    }

    // ── issues ───────────────────────────────────────────────────────────────
    const issues: DutyIssue[] = []
    const push = (i: DutyIssue | null) => { if (i) issues.push(i) }
    const hasWork = live.length > 0

    // gaps between consecutive pieces (for SPLIT interval and travel checks)
    const gaps = live.slice(1).map((p, i) => ({ prev: live[i], next: p, minutes: p.startMinutes - live[i].endMinutes }))

    if (hasWork && duty.kind !== 'TRIPPER' && duty.kind !== 'STANDBY') push(rangeIssue('WORK_TIME', workMinutes, range.workTime))
    if (hasWork && duty.kind !== 'STANDBY') push(rangeIssue('SPREAD', summary.spreadMinutes, range.spread))
    if (hasWork && duty.kind === 'STRAIGHT') push(rangeIssue('MEAL_BREAK', breakMinutes, range.mealBreak))
    if (hasWork && duty.kind === 'SPLIT') {
      push(rangeIssue('SPLIT_INTERVAL', gaps.length ? Math.max(...gaps.map(g => g.minutes)) : 0, range.splitInterval))
    }

    // continuous driving: worked segments chained until a break sits between them (in the
    // gap between pieces or inside a piece)
    const restsBetween = (prev: Span, next: Span) => breaks.some(b => b.startMinutes < next.startMinutes && b.endMinutes > prev.endMinutes)
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

    for (const g of gaps) {
      if (g.prev.endLocalityId === g.next.startLocalityId) continue
      const travel   = input.matrixMinutes.get(`${g.prev.endLocalityId}:${g.next.startLocalityId}`)
      const declared = acts.some(a => a.type === 'TRAVEL' && a.startMinutes >= g.prev.endMinutes && a.endMinutes <= g.next.startMinutes)
      if (travel != null && g.minutes < travel) {
        push({ code: 'TRAVEL_GAP', severity: 'error', value: g.minutes, limit: Math.ceil(travel), pieceId: g.next.id })
      } else if (travel == null && !declared) {
        push({ code: 'TRAVEL_GAP', severity: 'warning', value: g.minutes, pieceId: g.next.id })
      }
    }

    if (duty.branchId) {
      for (const p of live) {
        const b = blocks.get(p.vehicleBlockId!)
        if (b?.branchId && b.branchId !== duty.branchId) push({ code: 'BRANCH_MISMATCH', severity: 'error', value: 0, pieceId: p.id })
      }
    }

    dutyOut.set(duty.id, { summary, issues, isStale: live.length !== duty.pieces.length })

    // ── plan-level accumulation ──────────────────────────────────────────────
    totalWork += workMinutes; totalPaid += paidMinutes; totalOvertime += overtime; totalNight += nightMinutes
    if (duty.role === 'DRIVER') {
      driverDuties++
      driverPaid += paidMinutes
      for (const p of live) {
        if (!driverCoverage.has(p.vehicleBlockId!)) driverCoverage.set(p.vehicleBlockId!, [])
        driverCoverage.get(p.vehicleBlockId!)!.push(p)
      }
    }

    // per-duty criteria enter the plan score with the same applicability as the issues
    if (hasWork) {
      if (range.workTime.active && duty.kind !== 'TRIPPER' && duty.kind !== 'STANDBY') add(range.workTime.modifier, rangeV(workMinutes, range.workTime))
      if (range.spread.active && duty.kind !== 'STANDBY') add(range.spread.modifier, rangeV(summary.spreadMinutes, range.spread))
      if (range.mealBreak.active && duty.kind === 'STRAIGHT') add(range.mealBreak.modifier, rangeV(breakMinutes, range.mealBreak))
      if (range.splitInterval.active && duty.kind === 'SPLIT') {
        add(range.splitInterval.modifier, rangeV(gaps.length ? Math.max(...gaps.map(g => g.minutes)) : 0, range.splitInterval))
      }
      if (range.vehicleChanges.active) add(range.vehicleChanges.modifier, rangeV(vehicleChanges, range.vehicleChanges))
    }
  }

  // ── coverage (DRIVER only) ─────────────────────────────────────────────────
  // only the block's service spans need a driver — its own intervals and time parked at
  // the depot don't (blockMinutes/coveredMinutes are measured on that same basis)
  const uncovered: CrewPlanSummary['uncovered'] = []
  let blockMinutes = 0, coveredMinutes = 0
  for (const b of input.blocks) {
    const coverage = mergeSpans(driverCoverage.get(b.id) ?? [])
    for (const span of b.serviceSpans) {
      blockMinutes += dur(span)
      let cursor = span.startMinutes
      for (const s of coverage) {
        if (s.endMinutes <= cursor || s.startMinutes >= span.endMinutes) continue
        if (s.startMinutes > cursor) uncovered.push({ vehicleBlockId: b.id, startMinutes: cursor, endMinutes: s.startMinutes })
        coveredMinutes += Math.min(s.endMinutes, span.endMinutes) - Math.max(s.startMinutes, cursor)
        cursor = Math.min(span.endMinutes, Math.max(cursor, s.endMinutes))
      }
      if (cursor < span.endMinutes) uncovered.push({ vehicleBlockId: b.id, startMinutes: cursor, endMinutes: span.endMinutes })
    }
  }

  // ── plan-level criteria ────────────────────────────────────────────────────
  if (input.duties.length > 0) {
    if (range.overtimeRatio.active) add(range.overtimeRatio.modifier, rangeV(totalWork > 0 ? (totalOvertime / totalWork) * 100 : 0, range.overtimeRatio))
    if (range.splitRatio.active)    add(range.splitRatio.modifier, rangeV(((byKind.SPLIT ?? 0) / input.duties.length) * 100, range.splitRatio))
    const anchored = settings.anchored
    if (anchored.dutyCount.active && range.workTime.idealMin > 0) {
      add(anchored.dutyCount.weight, anchoredV(driverDuties, Math.ceil(blockMinutes / range.workTime.idealMin), anchored.dutyCount))
    }
    if (anchored.efficiency.active) add(anchored.efficiency.weight, anchoredV(driverPaid, coveredMinutes, anchored.efficiency))
  }

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
      score:            weightTotal > 0 ? Math.round((weightedSum / weightTotal) * SCORE_SCALE) : 0,
    },
  }
}
