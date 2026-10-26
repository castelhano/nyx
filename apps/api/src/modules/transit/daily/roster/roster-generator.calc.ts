import {
  ROSTER_COMP_TOLERANCE, shiftFits, shiftIdealDistance,
  type RangeCriterion, type RosterMemberStat, type RosterProposalSummary, type RosterPublishedChange, type RosterQuality, type RosterSettings, type RosterShortage, type ShiftWindow,
} from '@nyx/schemas'
import { rangeRaw, SCORE_SCALE } from '../../timetabling/vehicle-plan/scoring/plan-scoring.calc'
import { hungarian } from './hungarian'

// The real roster generator's pure part (docs/proposal/brainchild/plan_crew_rostering_impl_v2.md
// §5): who works which daily duty over a horizon of days, for one empresa and role.
//
//   construction  day by day, a minimum-cost assignment (Hungarian) of the day's duties to the
//                 crew members free that day, with the state carried from the days before
//                 (last duty per plan, changes, worked minutes, last sign-off)
//   improvement   simulated annealing over the horizon — a duty moves to / swaps with another
//                 crew member on its day, or two crew members swap a range of days
//
// The objective: coverage first (UNASSIGNED per duty without a crew member, UNASSIGNED_STANDBY per
// plantão — filled with who's left over), then WARN rule violations (WARN each), then the
// preferred crew members (PIN per step down the list, PIN_OUT for someone off it), then — with
// `compensate` — the hour bank (BANK × priority per crew member left free for a folga
// compensada), then the score — the average of each crew member's weighted criteria
// (roster.range + the crew interShiftRest ideal) on the 0–9999 scale of the other solvers. Each
// level outweighs everything below it, but the bank sits between a step down a preferred list
// and leaving it: a preferred crew member with more hours gives way to the next one listed,
// never to someone off the list.
// Redoing PUBLISHED days (includePublished), each day whose duty differs from the published one
// costs range.publishedChanges — the search changes the published roster only where it pays off.
// BLOCK rules and the always-blocking ones are hard: never assigned.

export const UNASSIGNED = 100_000_000
// a plantão (STANDBY) without anyone — it takes whoever is left once the duties are covered
export const UNASSIGNED_STANDBY = 10_000_000
export const WARN       = 1_000_000

export const missingCost = (d: RgDuty) => (d.standby ? UNASSIGNED_STANDBY : UNASSIGNED)

// a duty with preferred crew members (Duty.constraints.crewMemberIds): each step down the list
// costs PIN, anyone else PIN_OUT on top of the whole list — below a WARN rule, above the whole
// score (no criterion outweighs a preferred crew member)
export const PIN = SCORE_SCALE
// a crew member left free for a folga compensada: up to BANK by his priority (bankPriority)
export const BANK = 6 * SCORE_SCALE
const PIN_OUT = 8 * SCORE_SCALE
export const pinCost = (d: RgDuty, mi: number) => {
  if (!d.preferred.length) return 0
  const r = d.preferred.indexOf(mi)
  return r < 0 ? PIN_OUT + PIN * d.preferred.length : PIN * r
}

// The priority of a folga compensada (0..1): the previous month's balance first while it's 5h or
// more — it's what expires —, then the previous month's and the month's together
export function bankPriority(expiring: number, lot: number): number {
  if (expiring >= 300) return 0.6 + 0.4 * Math.min(1, expiring / 3000)
  return 0.4 * Math.min(1, Math.max(0, expiring + lot) / 3000)
}

// The folgas compensadas of a crew member's row (compensate): each free day he's left without a
// duty, but a holiday or a day the generation doesn't write (noComp) — in order, each one taking a journey off his balance (the previous
// month's first; a new month makes the month's the previous one). `each` gets the day and the
// balance before / after.
export function walkComps(input: RgInput, m: RgMember, row: Int32Array, each?: (t: number, before: number, after: number) => void): { days: number; reward: number } {
  if (!input.compensate || !m.bank) return { days: 0, reward: 0 }
  let { expiring, lot, negative } = m.bank
  let days = 0, reward = 0
  for (let t = 0; t < input.days.length; t++) {
    if (t > 0 && input.days[t].endsWith('-01')) { expiring = lot; lot = 0 }
    if (m.status[t] !== 'free' || row[t] >= 0 || input.noComp[t]) continue
    reward += BANK * bankPriority(expiring, lot)
    const before = expiring + lot + negative
    let d = m.bank.journey
    const a = Math.min(expiring, d); expiring -= a; d -= a
    const b = Math.min(lot, d); lot -= b; d -= b
    negative -= d
    days++
    each?.(t, before, expiring + lot + negative)
  }
  return { days, reward }
}

export interface RgDuty {
  id:     string
  day:    number
  start:  number
  end:    number
  paid:   number
  kind:   string
  // `${crewPlanId}#${logical duty}` (the duty's identity across days; made in the day: its
  // dominant line and shift under '-') — a change = a different one than the last worked under
  // the same crew plan (a Saturday plan keeps the weekday sequence apart)
  signature: string
  // the duty's shift code (diagnosis)
  shift:  string | null
  lineMinutes: { lineId: string; minutes: number }[]
  vehicleTypes: string[]
  // every line operated by the empresa (restrictToBranchLines)
  operated: boolean
  // a plantão (kind STANDBY)
  standby: boolean
  // the crew members (indices) who should work it, in order — none: anyone
  preferred: number[]
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
  // the empresa's priority lines for him (CrewMemberLine.priority) → 1
  priorityGrade: Record<string, number>
  blockedVehicleTypes: string[]
  overtimePreference: 'LIKES' | 'NEUTRAL' | 'AVOIDS'
  status:  RgStatus[]
  // the effective window per day (shift + the crew member's bounds + time-window requests)
  windows: (ShiftWindow | null)[]
  fixed:   (RgFixed | null)[]
  licenseExpired: boolean[]
  courseExpired:  boolean[]
  // load window = load period start .. horizon end, reduced by absences / compensatory days off
  targetMinutes: number
  // the target of one day — a folga compensada given by the generator takes it off
  dayLoad: number
  // the hour bank at the horizon's start (compensate) — none: outside the bank
  bank?: { expiring: number; lot: number; negative: number; journey: number }
  // before the horizon, inside the load window
  workedBefore:  number
  changesBefore: number
  // the last duty worked per crew plan (signatureGroup)
  lastSignatures: Record<string, string>
  // day index → the last duties from that day on, replacing the carried ones: a ferista takes the
  // titular's on the first day of the férias, and gets his own back the day after — the table
  // change of either day doesn't count
  lastSwaps?: Record<number, Record<string, string>>
  // sign-off the day before the horizon / sign-on the day after it
  prevEnd:   number | null
  nextStart: number | null
  // per day: the duty index held on a PUBLISHED day (-1 none), NOT_PUBLISHED otherwise
  published: number[]
  // per day: the duty index held now (-1 none) — the current allocation's quality
  current:   number[]
}

export const NOT_PUBLISHED = -2

// the plantão as a line in RgDuty.lineMinutes / RgMember.prefGrade / lineAccess
export const STANDBY_LINE = '__STANDBY__'

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
  // leave the crew members with the most hours free, for a folga compensada (walkComps)
  compensate: boolean
  // per day: no folga compensada — a holiday of the empresa, or a day without duties to write
  noComp:    boolean[]
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

export const signatureGroup = (sig: string) => sig.slice(0, sig.indexOf('#'))
// the member's last duties on day t (a swap of the day replaces them)
export const lastOn = (m: RgMember, t: number, last: Record<string, string>): Record<string, string> => {
  const swap = m.lastSwaps?.[t]
  return swap ? { ...swap } : last
}
// sig worked after `last` (per crew plan) changes the duty
export const isChange = (last: Record<string, string>, sig: string) => {
  const prev = last[signatureGroup(sig)]
  return prev != null && prev !== sig
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
  if (!rule(m.courseExpired[d.day], input.ruleModes.course)) return -1
  return warns
}

// The first fixed rule (BLOCK) that keeps a crew member off a duty, whatever he has that day —
// null when none does. The diagnosis of the duties left without anyone.
type Stage = 'window' | 'line' | 'vehicle' | 'license'
function blockedBy(input: RgInput, m: RgMember, d: RgDuty): Stage | null {
  const block = (broken: boolean, mode: 'BLOCK' | 'WARN') => broken && mode === 'BLOCK'
  const window = m.windows[d.day]
  if (!window || block(!shiftFits(window, d.start, d.end, d.kind), input.ruleModes.shiftWindow)) return 'window'
  const lines = d.lineMinutes.map(l => l.lineId)
  const lineBroken = input.lineAccessMode === 'WHITELIST' ? lines.some(l => m.lineAccess[l] !== 'ENABLED') : lines.some(l => m.lineAccess[l] === 'BLOCKED')
  if (block(lineBroken, input.ruleModes.lineAccess)) return 'line'
  if (block(d.vehicleTypes.some(t => m.blockedVehicleTypes.includes(t)), input.ruleModes.vehicleType)) return 'vehicle'
  if (block(m.licenseExpired[d.day], input.ruleModes.license) || block(m.courseExpired[d.day], input.ruleModes.course)) return 'license'
  return null
}

const STAGE_REASON: Record<Stage, string> = {
  window:  'nenhum operador livre cabe no horário',
  line:    'os livres do horário não podem operar a linha',
  vehicle: 'os livres do horário têm o tipo de veículo bloqueado',
  license: 'os livres do horário estão com CNH ou curso vencido',
}

// The most duties that can be covered: per day, a maximum matching between the day's duties
// and the crew members the fixed rules allow (Kuhn) — the rest between days and the change
// limit aren't counted, so it's an upper bound.
export function coverageBound(model: RosterModel): number {
  let total = 0
  for (const n of coverageByDay(model).values()) total += n
  return total
}

// the same matching, day by day (day index → duties covered) — the Painel de Escala's "cobríveis"
export function coverageByDay(model: RosterModel): Map<number, number> {
  const out = new Map<number, number>()
  const byDay = new Map<number, number[]>()
  model.input.duties.forEach((d, i) => byDay.set(d.day, [...(byDay.get(d.day) ?? []), i]))
  for (const [day, duties] of byDay) {
    const holder = new Map<number, number>()
    const tryDuty = (di: number, seen: Set<number>): boolean => {
      for (const mi of model.candidates[di]) {
        if (seen.has(mi)) continue
        seen.add(mi)
        const other = holder.get(mi)
        if (other == null || tryDuty(other, seen)) { holder.set(mi, di); return true }
      }
      return false
    }
    let n = 0
    for (const di of duties) if (tryDuty(di, new Set())) n++
    out.set(day, n)
  }
  return out
}

// Why each duty left without anyone has none — grouped by reason and shift.
export function diagnoseShortage(model: RosterModel, assign: Int32Array[], holder: Int32Array): RosterShortage[] {
  const { input } = model
  const groups = new Map<string, RosterShortage>()
  input.duties.forEach((d, di) => {
    if (holder[di] >= 0) return
    let reason: string
    if (!d.operated) reason = 'linha não operada pela empresa'
    else if (model.candidates[di].length) {
      // someone could take it: either all of them hold another duty that day, or the rest
      // between days / the change limit kept the free ones off
      const idle = [...model.candidates[di]].filter(mi => assign[mi][d.day] < 0).length
      reason = idle ? 'interjornada ou limite de trocas impede os livres'
        : d.standby ? 'plantão — ninguém sobrou depois das tabelas'
        : `faltam operadores — os ${model.candidates[di].length} que poderiam cobrir já estão em outras tabelas`
    } else {
      const free = input.members.filter(m => m.status[d.day] === 'free')
      const stages = free.map(m => blockedBy(input, m, d))
      const order: Stage[] = ['window', 'line', 'vehicle', 'license']
      // the first rule that leaves nobody
      const stage = order.find((_, k) => stages.every(s => s != null && order.indexOf(s) <= k)) ?? 'window'
      reason = free.length ? STAGE_REASON[stage] : 'nenhum operador livre no dia'
    }
    const key = `${reason}|${d.shift ?? ''}`
    const g = groups.get(key) ?? { reason, shift: d.shift, dutyIds: [], couldCover: [] }
    g.dutyIds.push(d.id)
    groups.set(key, g)
    // who'd fit but is on his rest pattern's day off
    for (const m of input.members) {
      if (g.couldCover.length >= 6 || m.status[d.day] !== 'off' || blockedBy(input, m, d)) continue
      const label = `${m.code} ${m.name}`
      if (!g.couldCover.includes(label)) g.couldCover.push(label)
    }
  })
  return [...groups.values()].sort((a, b) => b.dutyIds.length - a.dutyIds.length)
}

// graded share of the duty's trip minutes on the given lines (the member's preferred or priority
// ones): num / den is 0..1
function lineShare(grade: Record<string, number>, d: RgDuty): { num: number; den: number } {
  let num = 0, den = 0
  for (const l of d.lineMinutes) {
    den += l.minutes
    num += l.minutes * (grade[l.lineId] ?? 0)
  }
  return { num, den }
}

// ── model ─────────────────────────────────────────────────────────────────────

export interface MemberEval {
  score:   number   // weighted criteria average — 1 at best, below -1 only through convexRaw
  warns:   number
  // Σ pinCost of his duties
  pin:     number
  hard:    boolean
  worked:  number
  changes: number
  prefShare: number | null
  workedDays: number
  // the folgas compensadas' worth (walkComps)
  bank:    number
}

export class RosterModel {
  readonly M: number
  readonly T: number
  // rule per member × duty (-1 blocked / warns)
  readonly rule: Int8Array
  // per duty: the members it can go to
  readonly candidates: Int32Array[]
  readonly hasPrefs: boolean[]
  readonly hasPriority: boolean[]

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
    this.hasPriority = input.members.map(m => Object.keys(m.priorityGrade).length > 0)
  }

  ruleOf(mi: number, di: number): number {
    return this.rule[mi * this.input.duties.length + di]
  }

  // the crew member's whole horizon under `row` (duty index per day, -1 none)
  evaluate(mi: number, row: Int32Array): MemberEval {
    const { input } = this
    const m = input.members[mi]
    const restMode = input.ruleModes.interShiftRest
    let worked = m.workedBefore, changes = m.changesBefore
    let last = { ...m.lastSignatures }
    let prevEnd = m.prevEnd, prevFixed = true
    let warns = 0, hard = false, workedDays = 0, pin = 0
    let prefNum = 0, prefDen = 0, prioNum = 0, prioDen = 0, shiftSum = 0, shiftN = 0, restSum = 0, restN = 0, newChanges = 0
    let publishedDays = 0, publishedChanged = 0
    // compensate: a one-off substitution (a different duty, back to the usual one the next worked
    // day) doesn't count against maxChanges — its two changes still weigh in the score
    let exempt = 0, subFrom: string | null = null
    for (let t = 0; t < this.T; t++) {
      if (m.published[t] === NOT_PUBLISHED || m.status[t] !== 'free') continue
      publishedDays++
      if (row[t] !== m.published[t]) publishedChanged++
    }

    const restCheck = (rest: number, bothFixed: boolean) => {
      if (input.rest.active) { restSum += rangeRaw(rest, input.rest); restN++ }
      if (rest >= input.rest.floor || bothFixed) return
      if (restMode === 'BLOCK') hard = true
      else warns++
    }

    for (let t = 0; t < this.T; t++) {
      let start: number, end: number, paid: number, sig: string, isFixed: boolean
      last = lastOn(m, t, last)
      const f = m.status[t] === 'fixed' ? m.fixed[t] : null
      const di = row[t]
      if (f) {
        ({ start, end, paid } = f); sig = f.signature; isFixed = true
      } else if (di >= 0) {
        const d = input.duties[di]
        start = d.start; end = d.end; paid = d.paid; sig = d.signature; isFixed = false
        pin += pinCost(d, mi)
        // a blocked pair (only in an allocation made by hand) counts as one broken rule
        const rule = this.ruleOf(mi, di)
        warns += rule < 0 ? 1 : rule
        const p = lineShare(m.prefGrade, d)
        prefNum += p.num; prefDen += p.den
        const q = lineShare(m.priorityGrade, d)
        prioNum += q.num; prioDen += q.den
        const w = m.windows[t]
        if (w) { shiftSum += shiftIdealDistance(w, start, end); shiftN++ }
      } else {
        prevEnd = null
        continue
      }
      workedDays++
      if (prevEnd != null) restCheck(1440 + start - prevEnd, isFixed && prevFixed)
      worked += paid
      const group = signatureGroup(sig)
      const change = isChange(last, sig)
      if (change) {
        changes++
        if (!isFixed) newChanges++
        if (input.compensate && subFrom === sig) exempt += 2
      }
      subFrom = change && !isFixed ? last[group] : null
      last[group] = sig
      prevEnd = end
      prevFixed = isFixed
    }
    if (prevEnd != null && m.nextStart != null) restCheck(1440 + m.nextStart - prevEnd, prevFixed)
    if (newChanges > 0 && changes - exempt > input.maxChanges) hard = true

    // the folgas compensadas take their days off the target
    const comp = walkComps(input, m, row)
    const target = m.targetMinutes - comp.days * m.dayLoad
    const r = input.range
    let num = 0, den = 0
    const add = (c: RangeCriterion, value: number, raw = rangeRaw) => { num += c.modifier * raw(value, c); den += c.modifier }
    const share = this.hasPrefs[mi] && prefDen > 0 ? prefNum / prefDen * 100 : null
    if (r.priorityLine.active && this.hasPriority[mi] && prioDen > 0) add(r.priorityLine, prioNum / prioDen * 100)
    if (r.driverPrefLine.active && share != null) add(r.driverPrefLine, share)
    if (r.shiftFit.active && shiftN) add(r.shiftFit, shiftSum / shiftN)
    if (target > 0) {
      if (input.ensureMonthlyLoad) {
        if (r.loadDeficit.active) add(r.loadDeficit, Math.max(0, target - worked) / target * 100, convexRaw)
      } else if (r.overtimePref.active && m.overtimePreference !== 'LIKES') {
        const over = Math.max(0, worked - target)
        add(r.overtimePref, m.overtimePreference === 'AVOIDS' ? over : over / 2, convexRaw)
      }
    }
    if (r.tableChanges.active) add(r.tableChanges, changes)
    if (restN) add(input.rest, restSum / restN)
    if (r.publishedChanges.active && publishedDays) add(r.publishedChanges, publishedChanged)

    return { score: den ? num / den : 1, warns, hard, worked, changes, prefShare: share, workedDays, pin, bank: comp.reward }
  }

  // the objective (higher is better) — missing: Σ missingCost of the duties without anyone; pins:
  // Σ pinCost; bank: Σ the folgas compensadas' worth
  objective(scores: number, warns: number, missing: number, pins = 0, bank = 0): number {
    return SCORE_SCALE * scores / Math.max(1, this.M) - WARN * warns - missing - pins + bank
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
  const last    = input.members.map(m => ({ ...m.lastSignatures }))
  const prevEnd = input.members.map(m => m.prevEnd)
  const r = input.range
  const totalDays = input.loadDaysBefore + T

  for (let t = 0; t < T; t++) {
    const duties = byDay[t]
    for (let mi = 0; mi < M; mi++) last[mi] = lastOn(input.members[mi], t, last[mi])
    const free = [] as number[]
    for (let mi = 0; mi < M; mi++) if (input.members[mi].status[t] === 'free') free.push(mi)

    if (duties.length && free.length) {
      // rows = duties; columns = free members + one "unassigned" column per duty
      const cols = free.length + duties.length
      const cost = duties.map((di, row) => {
        const d = input.duties[di]
        const line = new Array<number>(cols).fill(UNASSIGNED * 10)
        line[free.length + row] = missingCost(d)
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
          const change = isChange(last[mi], d.signature)
          if (change && changes[mi] >= input.maxChanges) return
          if (change && r.tableChanges.active) x += r.tableChanges.modifier
          if (r.priorityLine.active && model.hasPriority[mi]) {
            const q = lineShare(m.priorityGrade, d)
            x += r.priorityLine.modifier * (1 - (q.den ? q.num / q.den : 0))
          }
          if (r.driverPrefLine.active && model.hasPrefs[mi]) {
            const p = lineShare(m.prefGrade, d)
            x += r.driverPrefLine.modifier * (1 - (p.den ? p.num / p.den : 0))
          }
          const w = m.windows[t]
          if (r.shiftFit.active && w) x += r.shiftFit.modifier * (1 - rangeRaw(shiftIdealDistance(w, d.start, d.end), r.shiftFit))
          x += pinCost(d, mi)
          // a published day keeps its duty unless something else pays more
          if (r.publishedChanges.active && m.published[t] !== NOT_PUBLISHED && m.published[t] !== di) x += r.publishedChanges.modifier
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
      if (isChange(last[mi], cur.signature)) changes[mi]++
      last[mi][signatureGroup(cur.signature)] = cur.signature
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
  // duties without anyone in the best allocation
  bestUnassigned: number

  private readonly assign: Int32Array[]
  private readonly holder: Int32Array
  private readonly evals: MemberEval[]
  private scoreSum = 0
  private warnSum = 0
  private pinSum = 0
  private bankSum = 0
  private unassigned = 0
  // Σ missingCost of the duties without anyone
  private missing = 0
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
    for (const e of this.evals) { this.scoreSum += e.score; this.warnSum += e.warns; this.pinSum += e.pin; this.bankSum += e.bank }
    this.unassigned = this.holder.filter(h => h < 0).length
    this.holder.forEach((h, di) => { if (h < 0) this.missing += missingCost(model.input.duties[di]) })
    this.current = this.objective()
    this.bestObjective = this.current
    this.bestUnassigned = this.unassigned
    this.best = this.assign.map(r => Int32Array.from(r))
    // ~ a third of one crew member's whole score
    this.t0 = SCORE_SCALE / Math.max(1, model.M) * 0.3
  }

  private objective(): number {
    return this.model.objective(this.scoreSum, this.warnSum, this.missing, this.pinSum, this.bankSum)
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

  // accept/reject a change touching the members in `touched` (their rows already changed);
  // unassignedDelta / missingDelta: duties without anyone, and their missingCost
  private settle(touched: number[], unassignedDelta: number, missingDelta: number, undo: () => void): void {
    const next = touched.map(mi => this.model.evaluate(mi, this.assign[mi]))
    if (next.some(e => e.hard)) { undo(); return }
    let scoreSum = this.scoreSum, warnSum = this.warnSum, pinSum = this.pinSum, bankSum = this.bankSum
    touched.forEach((mi, i) => {
      scoreSum += next[i].score - this.evals[mi].score
      warnSum  += next[i].warns - this.evals[mi].warns
      pinSum   += next[i].pin - this.evals[mi].pin
      bankSum  += next[i].bank - this.evals[mi].bank
    })
    const value = this.model.objective(scoreSum, warnSum, this.missing + missingDelta, pinSum, bankSum)
    const delta = value - this.current
    if (delta < 0 && this.random() >= Math.exp(delta / this.temperature())) { undo(); return }
    touched.forEach((mi, i) => { this.evals[mi] = next[i] })
    this.scoreSum = scoreSum
    this.warnSum = warnSum
    this.pinSum = pinSum
    this.bankSum = bankSum
    this.unassigned += unassignedDelta
    this.missing += missingDelta
    this.current = value
    if (value > this.bestObjective + 1e-9) {
      this.bestObjective = value
      this.bestUnassigned = this.unassigned
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
    const missingDelta = a < 0 ? -missingCost(input.duties[di]) + (e >= 0 ? missingCost(input.duties[e]) : 0) : 0
    this.settle(a >= 0 ? [a, b] : [b], unassignedDelta, missingDelta, () => {
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
    this.settle([a, b], 0, 0, swap)
  }
}

// ── quality ──

// What measures an allocation over the horizon (RosterQuality): table continuity, changes,
// preferred lines, load and shift fit.
export function rosterQuality(model: RosterModel, assign: Int32Array[]): RosterQuality {
  const { input, M, T } = model
  let kept = 0, days = 0, changes = 0, changedMembers = 0, prefDen = 0, prefMain = 0, prefAny = 0
  let belowLoad = 0, withLoad = 0, shiftSum = 0, shiftN = 0, warnings = 0
  const pinned = { duties: 0, first: 0, listed: 0 }
  for (let mi = 0; mi < M; mi++) {
    const m = input.members[mi]
    const e = model.evaluate(mi, assign[mi])
    warnings += e.warns
    const mine = e.changes - m.changesBefore
    changes += mine
    if (mine > 0) changedMembers++
    if (m.targetMinutes > 0) { withLoad++; if (e.worked < m.targetMinutes * 0.97) belowLoad++ }
    const top = Math.max(0, ...Object.values(m.prefGrade))
    let last = { ...m.lastSignatures }
    for (let t = 0; t < T; t++) {
      last = lastOn(m, t, last)
      const f = m.status[t] === 'fixed' ? m.fixed[t] : null
      const di = assign[mi][t]
      const sig = f ? f.signature : di >= 0 ? input.duties[di].signature : null
      if (!sig) continue
      if (!f) {
        const prev = last[signatureGroup(sig)]
        if (prev != null) { days++; if (prev === sig) kept++ }
        const d = input.duties[di]
        if (d.preferred.length) {
          const r = d.preferred.indexOf(mi)
          pinned.duties++
          if (r === 0) pinned.first++
          if (r >= 0) pinned.listed++
        }
        // a plantão counts as its own line (STANDBY_LINE), so a preferred plantão is a met preference
        if (top > 0 && d.lineMinutes.length) {
          const main = d.lineMinutes.reduce((a, l) => (l.minutes > a.minutes ? l : a))
          const grade = m.prefGrade[main.lineId] ?? 0
          prefDen++
          if (grade > 0) prefAny++
          if (grade >= top) prefMain++
        }
        const w = m.windows[t]
        if (w) { shiftSum += shiftIdealDistance(w, d.start, d.end); shiftN++ }
      }
      last[signatureGroup(sig)] = sig
    }
  }
  const pct = (n: number) => (prefDen ? Math.round(n / prefDen * 100) : null)
  return {
    keptTable: { kept, days }, changes, changedMembers,
    prefMain: pct(prefMain), prefAny: pct(prefAny),
    belowLoad, withLoad,
    shiftDev: shiftN ? Math.round(shiftSum / shiftN) : null,
    warnings, pinned,
  }
}

// the current allocation as the search sees it — null when nothing in the horizon is allocated
export function currentAssign(model: RosterModel): Int32Array[] | null {
  const rows = model.input.members.map(m => Int32Array.from(m.current))
  return rows.some(r => r.some(di => di >= 0)) ? rows : null
}

// ── proposal ──────────────────────────────────────────────────────────────────

function holderOf(assign: Int32Array[], dutyCount: number): Int32Array {
  const holder = new Int32Array(dutyCount).fill(-1)
  assign.forEach((row, mi) => row.forEach(di => { if (di >= 0) holder[di] = mi }))
  return holder
}

export interface RosterProposal {
  index:   number
  summary: RosterProposalSummary
  // [dailyDutyId, crewMemberId]
  assignments: [string, string][]
  // [day, crewMemberId] — the rest pattern's days off
  dayOffs: [string, string][]
  // [day, crewMemberId] — the folgas compensadas (compensate)
  compOffs: [string, string][]
}

// current: the allocation in place (currentAssign) — its quality goes alongside
export function buildProposal(model: RosterModel, assign: Int32Array[], index: number, bound: number, current: Int32Array[] | null = null): RosterProposal {
  const { input, M, T } = model
  const assignments: [string, string][] = []
  const dayOffs: [string, string][] = []
  const members: RosterMemberStat[] = []
  let scoreSum = 0, warns = 0
  const assignedByDay = new Array<number>(T).fill(0)
  const dutiesByDay = new Array<number>(T).fill(0)
  const freeByDay = new Array<number>(T).fill(0)
  for (const d of input.duties) dutiesByDay[d.day]++
  const publishedChanges: RosterPublishedChange[] = []
  const standbyIds = new Set(input.duties.filter(d => d.standby).map(d => d.id))
  const compOffs: [string, string][] = []
  const compensation = { days: 0, minutes: 0, idle: 0, alerts: [] as NonNullable<RosterProposalSummary['compensation']>['alerts'] }

  for (let mi = 0; mi < M; mi++) {
    const m = input.members[mi]
    const e = model.evaluate(mi, assign[mi])
    scoreSum += e.score
    warns += e.warns
    let offs = 0
    walkComps(input, m, assign[mi], (t, before, after) => {
      compOffs.push([input.days[t], m.id])
      compensation.days++
      compensation.minutes += m.bank!.journey
      if (after < -ROSTER_COMP_TOLERANCE) compensation.alerts.push({ crewMemberId: m.id, code: m.code, name: m.name, date: input.days[t], before, after })
    })
    for (let t = 0; t < T; t++) {
      const di = assign[mi][t]
      if (di >= 0) { assignments.push([input.duties[di].id, m.id]); assignedByDay[t]++ }
      else if (m.status[t] === 'free') { freeByDay[t]++; if (input.compensate) compensation.idle++ }
      if (m.status[t] === 'off') { dayOffs.push([input.days[t], m.id]); offs++ }
      if (m.status[t] === 'free' && m.published[t] !== NOT_PUBLISHED && m.published[t] !== di) {
        publishedChanges.push({ crewMemberId: m.id, code: m.code, name: m.name, date: input.days[t] })
      }
    }
    members.push({
      crewMemberId: m.id, code: m.code, name: m.name, workedDays: e.workedDays, dayOffs: offs,
      workedMinutes: e.worked, targetMinutes: Math.round(m.targetMinutes), changes: e.changes,
      prefShare: e.prefShare == null ? null : Math.round(e.prefShare), warnings: e.warns,
    })
  }
  compensation.idle -= compensation.days
  const assigned = assignments.length
  const unassigned = input.duties.length - assigned
  const rawScore = SCORE_SCALE * scoreSum / Math.max(1, M)
  return {
    index,
    assignments,
    dayOffs,
    compOffs,
    summary: {
      score: Math.max(0, Math.round(rawScore)), rawScore,
      duties: input.duties.length, assigned, unassigned, warnings: warns, dayOffs: dayOffs.length,
      days: input.days.map((date, t) => ({ date, duties: dutiesByDay[t], assigned: assignedByDay[t], free: freeByDay[t] })),
      members,
      bound,
      shortage: diagnoseShortage(model, assign, holderOf(assign, input.duties.length)),
      publishedChanges,
      quality: rosterQuality(model, assign),
      current: current ? rosterQuality(model, current) : null,
      standby: { duties: standbyIds.size, assigned: assignments.filter(([id]) => standbyIds.has(id)).length },
      compensation: input.compensate ? compensation : null,
    },
  }
}
