import {
  shiftFits, shiftIdealDistance,
  type RangeCriterion, type RosterMemberStat, type RosterProposalSummary, type RosterSettings, type ShiftWindow,
} from '@nyx/schemas'
import { rangeRaw, SCORE_SCALE } from '../../timetabling/vehicle-plan/scoring/plan-scoring.calc'
import { hungarian } from './hungarian'

// The real roster generator's pure part (docs/proposal/brainchild/plan_crew_rostering_impl_v2.md
// §5): who works which daily duty over a horizon of days, for one empresa and role.
//
//   construction  day by day, a minimum-cost assignment (Hungarian) of the day's duties to the
//                 crew members free that day, with the state carried from the days before
//                 (signature, changes, worked minutes, last sign-off)
//   improvement   simulated annealing over the horizon — a duty moves to / swaps with another
//                 crew member on its day, or two crew members swap a range of days
//
// The objective: coverage first (UNASSIGNED per duty without a crew member), then WARN rule
// violations (WARN each), then the score — the average of each crew member's weighted criteria
// (roster.range + the crew interShiftRest ideal) on the 0–9999 scale of the other solvers.
// BLOCK rules and the always-blocking ones are hard: never assigned.

export const UNASSIGNED = 100_000
export const WARN       = 1_000

export interface RgDuty {
  id:     string
  day:    number
  start:  number
  end:    number
  paid:   number
  kind:   string
  // (dominant line, shift) — a change = a signature different from the last one worked
  signature: string
  lineMinutes: { lineId: string; minutes: number }[]
  vehicleTypes: string[]
  // every line operated by the empresa (restrictToBranchLines)
  operated: boolean
}

export interface RgFixed { start: number; end: number; paid: number; signature: string }

// per day: free = assignable; off = rest pattern day off (becomes a DAY_OFF); away = absent,
// inactive, without a shift or a fixed day off; fixed = holds a fixed duty (locked / day not
// PLANNED)
export type RgStatus = 'free' | 'off' | 'away' | 'fixed'

export interface RgMember {
  id:   string
  code: string
  name: string
  lineAccess: Record<string, 'ENABLED' | 'BLOCKED'>
  // preferred line → its grade (0..1)
  prefGrade:  Record<string, number>
  blockedVehicleTypes: string[]
  overtimePreference: 'LIKES' | 'NEUTRAL' | 'AVOIDS'
  status:  RgStatus[]
  // the effective window per day (shift + the crew member's bounds + time-window requests)
  windows: (ShiftWindow | null)[]
  fixed:   (RgFixed | null)[]
  licenseExpired: boolean[]
  // load window = load period start .. horizon end, reduced by absences / compensatory days off
  targetMinutes: number
  // before the horizon, inside the load window
  workedBefore:  number
  changesBefore: number
  lastSignature: string | null
  // sign-off the day before the horizon / sign-on the day after it
  prevEnd:   number | null
  nextStart: number | null
}

export interface RgInput {
  days:    string[]
  duties:  RgDuty[]
  members: RgMember[]
  // days of the load window before the horizon (pro rata of the target during construction)
  loadDaysBefore: number
  ensureMonthlyLoad: boolean
  maxChanges: number
  lineAccessMode: RosterSettings['lineAccessMode']
  ruleModes: RosterSettings['ruleModes']
  range:     RosterSettings['range']
  rest:      RangeCriterion
}

export interface RgResult {
  // per member, per day: duty index or -1
  assign: Int32Array[]
}

// A one-sided "less is better" criterion (load deficit, overtime) as a convex reward: 1 up to
// idealMax, 0 at the ceiling, then keeps falling quadratically. rangeRaw would flatten at -1 far
// from the ideal — a crew member far below his load would gain nothing from one more duty, and
// the load would pile up on a few; the square spreads it evenly.
function convexRaw(value: number, c: RangeCriterion): number {
  if (value <= c.idealMax) return 1
  const x = (value - c.idealMax) / Math.max(1, c.ceiling - c.idealMax)
  return Math.max(-30, 1 - x * x)
}

// ── pair rules ────────────────────────────────────────────────────────────────

// -1 = blocked, else the number of WARN rules the pair breaks
export function pairRule(input: RgInput, m: RgMember, d: RgDuty): number {
  if (m.status[d.day] !== 'free' || !d.operated) return -1
  let warns = 0
  const rule = (broken: boolean, mode: 'BLOCK' | 'WARN') => {
    if (!broken) return true
    if (mode === 'BLOCK') return false
    warns++
    return true
  }
  const window = m.windows[d.day]
  if (!window) return -1
  const lines = d.lineMinutes.map(l => l.lineId)
  const lineBroken = input.lineAccessMode === 'WHITELIST'
    ? lines.some(l => m.lineAccess[l] !== 'ENABLED')
    : lines.some(l => m.lineAccess[l] === 'BLOCKED')
  if (!rule(lineBroken, input.ruleModes.lineAccess)) return -1
  if (!rule(d.vehicleTypes.some(t => m.blockedVehicleTypes.includes(t)), input.ruleModes.vehicleType)) return -1
  if (!rule(!shiftFits(window, d.start, d.end, d.kind), input.ruleModes.shiftWindow)) return -1
  if (!rule(m.licenseExpired[d.day], input.ruleModes.license)) return -1
  return warns
}

// graded share (0..1) of the duty's trip minutes on the member's preferred lines; null without
function prefShare(m: RgMember, d: RgDuty): { num: number; den: number } {
  let num = 0, den = 0
  for (const l of d.lineMinutes) {
    den += l.minutes
    num += l.minutes * (m.prefGrade[l.lineId] ?? 0)
  }
  return { num, den }
}

// ── model ─────────────────────────────────────────────────────────────────────

export interface MemberEval {
  score:   number   // weighted criteria average — 1 at best, below -1 only through convexRaw
  warns:   number
  hard:    boolean
  worked:  number
  changes: number
  prefShare: number | null
  workedDays: number
}

export class RosterModel {
  readonly M: number
  readonly T: number
  // rule per member × duty (-1 blocked / warns)
  readonly rule: Int8Array
  // per duty: the members it can go to
  readonly candidates: Int32Array[]
  readonly hasPrefs: boolean[]

  constructor(readonly input: RgInput) {
    this.M = input.members.length
    this.T = input.days.length
    const D = input.duties.length
    this.rule = new Int8Array(this.M * D)
    this.candidates = []
    for (let di = 0; di < D; di++) {
      const list: number[] = []
      for (let mi = 0; mi < this.M; mi++) {
        const r = pairRule(input, input.members[mi], input.duties[di])
        this.rule[mi * D + di] = r
        if (r >= 0) list.push(mi)
      }
      this.candidates.push(Int32Array.from(list))
    }
    this.hasPrefs = input.members.map(m => Object.keys(m.prefGrade).length > 0)
  }

  ruleOf(mi: number, di: number): number {
    return this.rule[mi * this.input.duties.length + di]
  }

  // the crew member's whole horizon under `row` (duty index per day, -1 none)
  evaluate(mi: number, row: Int32Array): MemberEval {
    const { input } = this
    const m = input.members[mi]
    const restMode = input.ruleModes.interShiftRest
    let worked = m.workedBefore, changes = m.changesBefore, last = m.lastSignature
    let prevEnd = m.prevEnd, prevFixed = true
    let warns = 0, hard = false, workedDays = 0
    let prefNum = 0, prefDen = 0, shiftSum = 0, shiftN = 0, restSum = 0, restN = 0, newChanges = 0

    const restCheck = (rest: number, bothFixed: boolean) => {
      if (input.rest.active) { restSum += rangeRaw(rest, input.rest); restN++ }
      if (rest >= input.rest.floor || bothFixed) return
      if (restMode === 'BLOCK') hard = true
      else warns++
    }

    for (let t = 0; t < this.T; t++) {
      let start: number, end: number, paid: number, sig: string, isFixed: boolean
      const f = m.status[t] === 'fixed' ? m.fixed[t] : null
      const di = row[t]
      if (f) {
        ({ start, end, paid } = f); sig = f.signature; isFixed = true
      } else if (di >= 0) {
        const d = input.duties[di]
        start = d.start; end = d.end; paid = d.paid; sig = d.signature; isFixed = false
        warns += this.ruleOf(mi, di)
        const p = prefShare(m, d)
        prefNum += p.num; prefDen += p.den
        const w = m.windows[t]
        if (w) { shiftSum += shiftIdealDistance(w, start, end); shiftN++ }
      } else {
        prevEnd = null
        continue
      }
      workedDays++
      if (prevEnd != null) restCheck(1440 + start - prevEnd, isFixed && prevFixed)
      worked += paid
      if (last != null && sig !== last) { changes++; if (!isFixed) newChanges++ }
      last = sig
      prevEnd = end
      prevFixed = isFixed
    }
    if (prevEnd != null && m.nextStart != null) restCheck(1440 + m.nextStart - prevEnd, prevFixed)
    if (newChanges > 0 && changes > input.maxChanges) hard = true

    const r = input.range
    let num = 0, den = 0
    const add = (c: RangeCriterion, value: number, raw = rangeRaw) => { num += c.modifier * raw(value, c); den += c.modifier }
    const share = this.hasPrefs[mi] && prefDen > 0 ? prefNum / prefDen * 100 : null
    if (r.driverPrefLine.active && share != null) add(r.driverPrefLine, share)
    if (r.shiftFit.active && shiftN) add(r.shiftFit, shiftSum / shiftN)
    if (m.targetMinutes > 0) {
      if (input.ensureMonthlyLoad) {
        if (r.loadDeficit.active) add(r.loadDeficit, Math.max(0, m.targetMinutes - worked) / m.targetMinutes * 100, convexRaw)
      } else if (r.overtimePref.active && m.overtimePreference !== 'LIKES') {
        const over = Math.max(0, worked - m.targetMinutes)
        add(r.overtimePref, m.overtimePreference === 'AVOIDS' ? over : over / 2, convexRaw)
      }
    }
    if (r.tableChanges.active) add(r.tableChanges, changes)
    if (restN) add(input.rest, restSum / restN)

    return { score: den ? num / den : 1, warns, hard, worked, changes, prefShare: share, workedDays }
  }

  // the objective (higher is better)
  objective(scores: number, warns: number, unassigned: number): number {
    return SCORE_SCALE * scores / Math.max(1, this.M) - WARN * warns - UNASSIGNED * unassigned
  }
}

// ── construction ──────────────────────────────────────────────────────────────

export function construct(model: RosterModel): RgResult {
  const { input, M, T } = model
  const assign = Array.from({ length: M }, () => new Int32Array(T).fill(-1))
  const byDay: number[][] = Array.from({ length: T }, () => [])
  input.duties.forEach((d, i) => byDay[d.day].push(i))

  // carried state
  const worked  = input.members.map(m => m.workedBefore)
  const changes = input.members.map(m => m.changesBefore)
  const last    = input.members.map(m => m.lastSignature)
  const prevEnd = input.members.map(m => m.prevEnd)
  const r = input.range
  const totalDays = input.loadDaysBefore + T

  for (let t = 0; t < T; t++) {
    const duties = byDay[t]
    const free = [] as number[]
    for (let mi = 0; mi < M; mi++) if (input.members[mi].status[t] === 'free') free.push(mi)

    if (duties.length && free.length) {
      // rows = duties; columns = free members + one "unassigned" column per duty
      const cols = free.length + duties.length
      const cost = duties.map((di, row) => {
        const d = input.duties[di]
        const line = new Array<number>(cols).fill(UNASSIGNED * 10)
        line[free.length + row] = UNASSIGNED
        free.forEach((mi, c) => {
          const m = input.members[mi]
          const rule = model.ruleOf(mi, di)
          if (rule < 0) return
          let x = WARN * rule
          const pe = prevEnd[mi]
          if (pe != null) {
            const rest = 1440 + d.start - pe
            if (rest < input.rest.floor) {
              if (input.ruleModes.interShiftRest === 'BLOCK') return
              x += WARN
            }
            if (input.rest.active) x += input.rest.modifier * (1 - rangeRaw(rest, input.rest))
          }
          // the last day against the fixed sign-on of the day after the horizon
          if (t === T - 1 && m.nextStart != null && 1440 + m.nextStart - d.end < input.rest.floor) {
            if (input.ruleModes.interShiftRest === 'BLOCK') return
            x += WARN
          }
          const change = last[mi] != null && last[mi] !== d.signature
          if (change && changes[mi] >= input.maxChanges) return
          if (change && r.tableChanges.active) x += r.tableChanges.modifier
          if (r.driverPrefLine.active && model.hasPrefs[mi]) {
            const p = prefShare(m, d)
            x += r.driverPrefLine.modifier * (1 - (p.den ? p.num / p.den : 0))
          }
          const w = m.windows[t]
          if (r.shiftFit.active && w) x += r.shiftFit.modifier * (1 - rangeRaw(shiftIdealDistance(w, d.start, d.end), r.shiftFit))
          if (m.targetMinutes > 0) {
            // the load due by this day
            const expected = m.targetMinutes * (input.loadDaysBefore + t + 1) / totalDays
            if (input.ensureMonthlyLoad) {
              if (r.loadDeficit.active) x -= r.loadDeficit.modifier * Math.min(2, Math.max(0, expected - worked[mi]) / Math.max(1, m.targetMinutes) * 100 / Math.max(1, r.loadDeficit.ceiling))
            } else if (r.overtimePref.active) {
              const over = Math.max(0, worked[mi] + d.paid - expected)
              if (m.overtimePreference === 'AVOIDS') x += r.overtimePref.modifier * Math.min(2, over / Math.max(1, r.overtimePref.ceiling))
              if (m.overtimePreference === 'LIKES') x -= r.overtimePref.modifier * 0.25
            }
          }
          line[c] = x
        })
        return line
      })
      const chosen = hungarian(cost, cols)
      duties.forEach((di, row) => {
        const c = chosen[row]
        if (c < 0 || c >= free.length || cost[row][c] >= UNASSIGNED * 10) return
        assign[free[c]][t] = di
      })
    }

    // carry the state into the next day
    for (let mi = 0; mi < M; mi++) {
      const m = input.members[mi]
      const f = m.status[t] === 'fixed' ? m.fixed[t] : null
      const di = assign[mi][t]
      const cur = f ?? (di >= 0 ? { start: input.duties[di].start, end: input.duties[di].end, paid: input.duties[di].paid, signature: input.duties[di].signature } : null)
      if (!cur) { prevEnd[mi] = null; continue }
      worked[mi] += cur.paid
      if (last[mi] != null && last[mi] !== cur.signature) changes[mi]++
      last[mi] = cur.signature
      prevEnd[mi] = cur.end
    }
  }
  return { assign }
}

// ── improvement ───────────────────────────────────────────────────────────────

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Simulated annealing over the horizon. One cooling cycle lasts `cycleMs`; the next one starts
// hot again from where the search is.
export class RosterImprover {
  attempts = 0
  improvements = 0
  lastImprovementAt = Date.now()
  bestObjective: number

  private readonly assign: Int32Array[]
  private readonly holder: Int32Array
  private readonly evals: MemberEval[]
  private scoreSum = 0
  private warnSum = 0
  private unassigned = 0
  private current: number
  private best: Int32Array[]
  private readonly random: () => number
  private cycleStart = Date.now()
  private readonly t0: number

  constructor(private readonly model: RosterModel, initial: RgResult, private readonly cycleMs: number, seed: number) {
    this.random = rng(seed)
    this.assign = initial.assign.map(r => Int32Array.from(r))
    this.holder = new Int32Array(model.input.duties.length).fill(-1)
    this.assign.forEach((row, mi) => row.forEach(di => { if (di >= 0) this.holder[di] = mi }))
    this.evals = this.assign.map((row, mi) => model.evaluate(mi, row))
    for (const e of this.evals) { this.scoreSum += e.score; this.warnSum += e.warns }
    this.unassigned = this.holder.filter(h => h < 0).length
    this.current = this.objective()
    this.bestObjective = this.current
    this.best = this.assign.map(r => Int32Array.from(r))
    // ~ a third of one crew member's whole score
    this.t0 = SCORE_SCALE / Math.max(1, model.M) * 0.3
  }

  private objective(): number {
    return this.model.objective(this.scoreSum, this.warnSum, this.unassigned)
  }

  bestAssign(): Int32Array[] { return this.best }

  run(sliceMs: number): void {
    const until = Date.now() + sliceMs
    const D = this.model.input.duties.length
    if (!D || !this.model.M) return
    while (Date.now() < until) {
      for (let k = 0; k < 200; k++) {
        this.attempts++
        if (this.random() < 0.75) this.moveDuty()
        else this.swapRange()
      }
    }
  }

  private temperature(): number {
    const now = Date.now()
    if (now - this.cycleStart >= this.cycleMs) this.cycleStart = now
    const f = (now - this.cycleStart) / Math.max(1, this.cycleMs)
    return this.t0 * Math.pow(0.001, f)
  }

  // accept/reject a change touching the members in `touched` (their rows already changed)
  private settle(touched: number[], unassignedDelta: number, undo: () => void): void {
    const next = touched.map(mi => this.model.evaluate(mi, this.assign[mi]))
    if (next.some(e => e.hard)) { undo(); return }
    let scoreSum = this.scoreSum, warnSum = this.warnSum
    touched.forEach((mi, i) => {
      scoreSum += next[i].score - this.evals[mi].score
      warnSum  += next[i].warns - this.evals[mi].warns
    })
    const value = this.model.objective(scoreSum, warnSum, this.unassigned + unassignedDelta)
    const delta = value - this.current
    if (delta < 0 && this.random() >= Math.exp(delta / this.temperature())) { undo(); return }
    touched.forEach((mi, i) => { this.evals[mi] = next[i] })
    this.scoreSum = scoreSum
    this.warnSum = warnSum
    this.unassigned += unassignedDelta
    this.current = value
    if (value > this.bestObjective + 1e-9) {
      this.bestObjective = value
      this.best = this.assign.map(r => Int32Array.from(r))
      this.improvements++
      this.lastImprovementAt = Date.now()
    }
  }

  // a duty goes to another crew member of its day; his duty (if any) goes back to the holder
  private moveDuty(): void {
    const { input } = this.model
    const di = Math.floor(this.random() * input.duties.length)
    const cands = this.model.candidates[di]
    if (!cands.length) return
    const b = cands[Math.floor(this.random() * cands.length)]
    const a = this.holder[di]
    if (a === b) return
    const t = input.duties[di].day
    const e = this.assign[b][t]
    if (a >= 0 && e >= 0 && this.model.ruleOf(a, e) < 0) return

    this.assign[b][t] = di
    this.holder[di] = b
    if (a >= 0) { this.assign[a][t] = e; if (e >= 0) this.holder[e] = a }
    else if (e >= 0) this.holder[e] = -1
    const unassignedDelta = (a < 0 ? -1 : 0) + (a < 0 && e >= 0 ? 1 : 0)
    this.settle(a >= 0 ? [a, b] : [b], unassignedDelta, () => {
      this.assign[b][t] = e
      if (e >= 0) this.holder[e] = b
      this.holder[di] = a
      if (a >= 0) this.assign[a][t] = di
    })
  }

  // two crew members swap their duties over a range of days (the days both are free)
  private swapRange(): void {
    const { M, T } = this.model
    if (M < 2) return
    const a = Math.floor(this.random() * M)
    let b = Math.floor(this.random() * (M - 1))
    if (b >= a) b++
    const len = 2 + Math.floor(this.random() * Math.min(6, T))
    const t0 = Math.floor(this.random() * T)
    const ma = this.model.input.members[a], mb = this.model.input.members[b]
    const days: number[] = []
    for (let t = t0; t < Math.min(T, t0 + len); t++) {
      if (ma.status[t] !== 'free' || mb.status[t] !== 'free') continue
      const x = this.assign[a][t], y = this.assign[b][t]
      if (x === y) continue
      if ((x >= 0 && this.model.ruleOf(b, x) < 0) || (y >= 0 && this.model.ruleOf(a, y) < 0)) return
      days.push(t)
    }
    if (!days.length) return
    const swap = () => {
      for (const t of days) {
        const x = this.assign[a][t], y = this.assign[b][t]
        this.assign[a][t] = y; this.assign[b][t] = x
        if (x >= 0) this.holder[x] = b
        if (y >= 0) this.holder[y] = a
      }
    }
    swap()
    this.settle([a, b], 0, swap)
  }
}

// ── proposal ──────────────────────────────────────────────────────────────────

export interface RosterProposal {
  index:   number
  summary: RosterProposalSummary
  // [dailyDutyId, crewMemberId]
  assignments: [string, string][]
  // [day, crewMemberId] — the rest pattern's days off
  dayOffs: [string, string][]
}

export function buildProposal(model: RosterModel, assign: Int32Array[], index: number): RosterProposal {
  const { input, M, T } = model
  const assignments: [string, string][] = []
  const dayOffs: [string, string][] = []
  const members: RosterMemberStat[] = []
  let scoreSum = 0, warns = 0
  const assignedByDay = new Array<number>(T).fill(0)
  const dutiesByDay = new Array<number>(T).fill(0)
  const freeByDay = new Array<number>(T).fill(0)
  for (const d of input.duties) dutiesByDay[d.day]++

  for (let mi = 0; mi < M; mi++) {
    const m = input.members[mi]
    const e = model.evaluate(mi, assign[mi])
    scoreSum += e.score
    warns += e.warns
    let offs = 0
    for (let t = 0; t < T; t++) {
      const di = assign[mi][t]
      if (di >= 0) { assignments.push([input.duties[di].id, m.id]); assignedByDay[t]++ }
      else if (m.status[t] === 'free') freeByDay[t]++
      if (m.status[t] === 'off') { dayOffs.push([input.days[t], m.id]); offs++ }
    }
    members.push({
      crewMemberId: m.id, code: m.code, name: m.name, workedDays: e.workedDays, dayOffs: offs,
      workedMinutes: e.worked, targetMinutes: Math.round(m.targetMinutes), changes: e.changes,
      prefShare: e.prefShare == null ? null : Math.round(e.prefShare), warnings: e.warns,
    })
  }
  const assigned = assignments.length
  const unassigned = input.duties.length - assigned
  const rawScore = SCORE_SCALE * scoreSum / Math.max(1, M)
  return {
    index,
    assignments,
    dayOffs,
    summary: {
      score: Math.max(0, Math.round(rawScore)), rawScore,
      duties: input.duties.length, assigned, unassigned, warnings: warns, dayOffs: dayOffs.length,
      days: input.days.map((date, t) => ({ date, duties: dutiesByDay[t], assigned: assignedByDay[t], free: freeByDay[t] })),
      members,
    },
  }
}
