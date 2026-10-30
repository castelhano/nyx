import {
  CONSOLE_SECTIONS, CONSOLE_FUTURE_DAYS, DAILY_ISSUE_LABEL, restGroupIndex, restGroupLabel, restGroupOffsets, restPatternWorks, shiftFits,
  type ConsoleAlert, type ConsoleChangeRequest, type ConsoleCrewData, type ConsoleDailyError, type ConsoleGroupPattern, type ConsoleGroups, type ConsoleLineRow,
  type ConsolePlanRow, type ConsoleSection, type ConsoleSectionStatus, type ConsoleShift, type ConsoleShiftsAnalysis, type ConsoleSnapshot,
  type ConsoleSizing, type ConsoleStaffing, type RestCycle, type RosterSettings, type ShiftWindow,
} from '@nyx/schemas'
import { RosterModel, STANDBY_LINE, type RgDuty, type RgInput, type RgMember } from '../daily/roster/roster-generator.calc'
import { daysBetween } from '../daily/roster/roster-generator.input'
import { BANKED_SHARE } from '../hour-bank/hour-bank.calc'
import { addDays, type Day } from '../timetabling/plan-validity'

// The Painel de Escala's figures — pure: everything comes in ConsoleInput (console.input.ts).
// Effective plans × active crew over a reference window of days; each day type takes the worst of
// its days. Who may cover what is decided by the roster generator's own rules (RosterModel /
// pairRule), so the Painel never says "ok" to a crew the generator can't roster.

export interface ConsolePattern { id: string; name: string; cycle: RestCycle; staggered: boolean }

// an open CrewChangeRequest of the crew — what was asked (console.actions rates it)
export interface ConsoleRequestInput {
  id:            string
  kind:          'SHIFT' | 'REST_GROUP'
  status:        'REQUESTED' | 'QUEUED'
  crewMemberId:  string
  change:        string
  notes:         string | null
  createdAt:     string
  shiftId:       string | null
  restPatternId: string | null
  restOffset:    number | null
}

export interface ConsoleCrew {
  id:   string
  code: string
  name: string
  hireDate:  Day
  shiftId:   string | null
  // first day of the current shift link
  shiftSince: Day | null
  // his shift's window (his own bounds apart: notBefore / notAfter)
  window:    ShiftWindow | null
  // his own bounds ("não inicia antes de / não termina depois de")
  notBefore: number | null
  notAfter:  number | null
  // his daily journey in minutes (contract weekly hours ÷ days worked a week) — null: no contract
  journey:   number | null
  pattern:   ConsolePattern | null
  // the pattern is his own (CrewMember.restPatternId) — else his shift's, and changes with it
  ownPattern: boolean
  offset:    number
  lineAccess:    Record<string, 'ENABLED' | 'BLOCKED'>
  prefLines:     string[]
  priorityLines: string[]
  blockedVehicleTypes: string[]
  standbyBlocked: boolean
  rosterable: boolean
  away:      { reason: string; until: Day } | null
  vacation:  { until: Day; cover: string | null } | null
}

export interface ConsoleDuty {
  id:        string
  dayTypeId: string
  shiftId:   string | null
  kind:      string
  start:     number
  end:       number
  paid:      number
  // planned overtime (DutySummary.overtimeMinutes)
  overtime:  number
  lineMinutes:  { lineId: string; minutes: number }[]
  vehicleTypes: string[]
  standby:   boolean
  // D10, C10… (plantões of the reserve targets: null)
  label:     string | null
  // the crew members who should work it, in order (Duty.constraints.crewMemberIds)
  preferred: string[]
}

export interface ConsoleInput {
  scopeId:  string
  branchId: string
  role:     string
  today:    Day
  scopes:   { id: string; name: string }[]
  // the reference window: each day with its weekday (0 = Monday) and day type
  days:     { day: Day; weekday: number; dayTypeId: string }[]
  dayTypes: { id: string; code: string; name: string }[]
  shifts:   (ConsoleShift & ShiftWindow & { pattern: ConsolePattern | null })[]
  plans:    ConsolePlanRow[]
  duties:   ConsoleDuty[]
  crew:     ConsoleCrew[]
  // every rest pattern (a crew member may switch to)
  patterns: ConsolePattern[]
  lines:    { id: string; code: string }[]
  lineAccessMode: RosterSettings['lineAccessMode']
  lineMarginPct:  number
  ruleModes:      RosterSettings['ruleModes']
  // the interjornada's floor (crew settings) — a duty out of his shift must keep it to his own
  // shift's duties on the days around
  restFloor:      number
  // RosterSettings.hourBankCompPct
  bankCompPct:    number
  noProfile:   ConsoleCrewData['noProfile']
  fixedCar:    ConsoleCrewData['fixedCar']
  dailyErrors: ConsoleDailyError[]
  // open change requests, oldest first
  requests:    ConsoleRequestInput[]
}

const ref = (m: ConsoleCrew) => ({ id: m.id, code: m.code, name: m.name })
// in the supply: rosterable, with a shift and not away (férias never take anyone out)
export const inSupply = (m: ConsoleCrew) => m.rosterable && !!m.shiftId && !m.away
const worksOn = (m: ConsoleCrew, day: Day, offset = m.offset) => !m.pattern || restPatternWorks(m.pattern.cycle, offset, day)
// rounded up, ignoring float noise (12 × 7/6 is 14, not 15)
const ceil = (x: number) => Math.ceil(x - 1e-9)
const dominantLine = (d: ConsoleDuty) => d.lineMinutes.reduce<{ lineId: string; minutes: number } | null>((a, l) => (!a || l.minutes > a.minutes ? l : a), null)?.lineId ?? null

// days of the cycle per day worked — 6x1 → 7/6; no pattern: 7/6
function cycleFactor(crew: ConsoleCrew[]): number {
  const withPattern = crew.filter(m => m.pattern)
  if (!withPattern.length) return 7 / 6
  const worked = withPattern.reduce((n, m) => n + [...m.pattern!.cycle.pattern].filter(c => c === 'T').length / m.pattern!.cycle.pattern.length, 0) / withPattern.length
  return worked > 0 ? 1 / worked : 7 / 6
}

// longest run of 'T' going round the cycle
export function maxRun(pattern: string): number {
  if (!pattern.includes('F')) return pattern.length
  let best = 0, run = 0
  for (const c of pattern + pattern) {
    run = c === 'T' ? run + 1 : 0
    best = Math.max(best, run)
  }
  return Math.min(best, pattern.length)
}

// ── the generator's model over the window ───────────────────────────────────

// RgInput of the window: every day carries its day type's duties; the crew is free unless off by
// the rest pattern. Only the fixed rules matter here (candidates) — the score fields are neutral.
function windowModel(input: ConsoleInput, crew: ConsoleCrew[]): RosterModel {
  const T = input.days.length
  const duties: RgDuty[] = []
  input.days.forEach((d, t) => {
    for (const x of input.duties.filter(x => x.dayTypeId === d.dayTypeId)) {
      duties.push({
        id: `${x.id}@${t}`, day: t, start: x.start, end: x.end, paid: x.paid, kind: x.kind, signature: x.id, shift: x.shiftId,
        lineMinutes: x.standby ? [{ lineId: STANDBY_LINE, minutes: x.end - x.start }] : x.lineMinutes,
        vehicleTypes: x.vehicleTypes, operated: true, standby: x.standby, preferred: [],
      })
    }
  })
  const members: RgMember[] = crew.map(m => ({
    id: m.id, code: m.code, name: m.name,
    lineAccess: { ...m.lineAccess, [STANDBY_LINE]: m.standbyBlocked ? 'BLOCKED' : 'ENABLED' },
    prefGrade: {}, priorityGrade: {}, blockedVehicleTypes: m.blockedVehicleTypes, overtimePreference: 'NEUTRAL',
    status: input.days.map(d => (worksOn(m, d.day) ? 'free' : 'off')),
    windows: input.days.map(() => m.window), limits: input.days.map(() => ({ notBefore: m.notBefore, notAfter: m.notAfter })),
    fixed: input.days.map(() => null),
    licenseExpired: input.days.map(() => false), courseExpired: input.days.map(() => false),
    targetMinutes: 0, dayLoad: 0, workedBefore: 0, changesBefore: 0, lastSignatures: {}, prevEnd: null, nextStart: null,
    published: input.days.map(() => -2), current: input.days.map(() => -1),
  }))
  const neutral = { active: false, modifier: 0, floor: 0, idealMin: 0, idealMax: 0, ceiling: 0 }
  const rg: RgInput = {
    days: input.days.map(d => d.day), duties, members, loadDaysBefore: 0, ensureMonthlyLoad: false, maxChanges: T,
    lineAccessMode: input.lineAccessMode, ruleModes: input.ruleModes,
    range: { priorityLine: neutral, driverPrefLine: neutral, shiftFit: neutral, loadDeficit: neutral, overtimePref: neutral, tableChanges: neutral, publishedChanges: neutral },
    rest: neutral, compensate: false, noComp: input.days.map(() => true),
  }
  return new RosterModel(rg)
}

// ── B: demand × crew ────────────────────────────────────────────────────────

// covered: the supply's coverage per day (WindowCover.coveredByDay), when already at hand
export function staffing(input: ConsoleInput, crew = input.crew, covered?: Map<number, number>): ConsoleStaffing {
  const supply = crew.filter(inSupply)
  const demandOf = (shiftId: string | null, dayTypeId: string) => input.duties.filter(d => d.shiftId === shiftId && d.dayTypeId === dayTypeId).length
  const typeIds = input.dayTypes.map(t => t.id)

  const rows = input.shifts.map(s => {
    const team = supply.filter(m => m.shiftId === s.id)
    const cells: ConsoleStaffing['rows'][number]['cells'] = {}
    for (const t of typeIds) {
      const dates = input.days.filter(d => d.dayTypeId === t)
      if (!dates.length) continue
      const per = dates.map(d => team.filter(m => worksOn(m, d.day)).length)
      const worst = Math.min(...per), demand = demandOf(s.id, t)
      cells[t] = { demand, worst, avg: per.reduce((a, b) => a + b, 0) / per.length, balance: worst - demand }
    }
    return { shiftId: s.id, cells, current: team.length }
  })

  covered ??= new WindowCover(input, supply).coveredByDay()
  const totals: ConsoleStaffing['totals'] = {}
  const noShift: ConsoleStaffing['noShift'] = {}
  for (const t of typeIds) {
    const idx = input.days.map((d, i) => (d.dayTypeId === t ? i : -1)).filter(i => i >= 0)
    if (!idx.length) continue
    const demand = input.duties.filter(d => d.dayTypeId === t).length
    totals[t] = { demand, coverable: Math.min(...idx.map(i => covered.get(i) ?? 0)) }
    noShift[t] = demandOf(null, t)
  }
  return { rows, noShift, totals }
}

// ── B: the crew the plans need ──────────────────────────────────────────────

// share of the time a crew member is on vacation: 30 days a year, even through the year
const VACATION_SHARE = 30 / 365
// days a month of each kind of day (by weekday, 0 = Monday) — the sector's convention for the
// planned overtime of a month
const MONTH_DAYS = [21, 21, 21, 21, 21, 4, 5]
// a journey when nobody of the shift has a contract: 44h over 6 days
const DEFAULT_JOURNEY = 440

interface CoverMember {
  shiftId: string | null
  // the group he counts in: `${shiftId}|${patternId}|${offset}`
  group:   string
  // per day: whether he works (rest pattern) and the slots (duty-days) he may take
  works:   boolean[]
  slots:   number[][]
  real:    boolean
}

// Who covers what over the window: per day, a maximum matching between the duty-days (slots) and
// the crew, by the roster generator's own rules (RosterModel.candidates). A duty out of the crew
// member's shift (shiftWindow WARN) also keeps the interjornada to his own shift on the days
// around (when interShiftRest blocks) — the per-day matching can't see the days around otherwise.
// The matching is kept up to date as crew members are added (virtual ones) or taken out: each
// change is one augmenting path, so trying a candidate costs a search, not a new matching.
export class WindowCover {
  readonly slots: { t: number; duty: ConsoleDuty }[] = []
  readonly members: CoverMember[] = []
  // per slot: the members who may take it
  private readonly cands: number[][]
  // per slot: its member, -1 none; per member and day: his slot, -1 none
  private holder: Int32Array
  private dutyOf: Int32Array[] = []
  private readonly removed: boolean[] = []
  // per day: slots nobody holds
  readonly uncovered: Int32Array
  private readonly T: number

  constructor(private readonly input: ConsoleInput, crew: ConsoleCrew[]) {
    this.T = input.days.length
    const model = windowModel(input, crew)
    const byId = new Map(input.duties.map(d => [d.id, d]))
    for (const d of model.input.duties) this.slots.push({ t: d.day, duty: byId.get(d.signature)! })
    this.cands = this.slots.map(() => [])
    this.holder = new Int32Array(this.slots.length).fill(-1)
    this.uncovered = new Int32Array(this.T)
    for (const s of this.slots) this.uncovered[s.t]++

    crew.forEach(m => {
      const slots: number[][] = Array.from({ length: this.T }, () => [])
      const works = input.days.map(d => worksOn(m, d.day))
      this.members.push({ shiftId: m.shiftId, group: groupKey(m.shiftId, m.pattern, m.offset), works, slots, real: true })
    })
    model.candidates.forEach((list, si) => {
      const { t, duty } = this.slots[si]
      for (const mi of list) {
        const m = crew[mi]
        if (!m.window || this.restKept(m.window, (day: Day) => worksOn(m, day), t, duty)) {
          this.members[mi].slots[t].push(si)
          this.cands[si].push(mi)
        }
      }
    })
    for (let mi = 0; mi < crew.length; mi++) {
      this.dutyOf.push(new Int32Array(this.T).fill(-1))
      this.removed.push(false)
      for (let t = 0; t < this.T; t++) if (this.reach(this.members[mi].slots[t], t, new Set(), mi, true)) this.uncovered[t]--
    }
  }

  // a duty out of the shift: the rest to the shift's latest end the day before and to its
  // earliest start the day after, on the days he works
  private restKept(shift: ShiftWindow, works: (day: Day) => boolean, t: number, d: ConsoleDuty): boolean {
    if (shiftFits(shift, d.start, d.end, d.kind) || this.input.ruleModes.interShiftRest !== 'BLOCK') return true
    const day = this.input.days[t].day
    if (works(addDays(day, -1)) && 1440 + d.start - shift.endCeiling < this.input.restFloor) return false
    if (works(addDays(day, 1)) && 1440 + shift.startFloor - d.end < this.input.restFloor) return false
    return true
  }

  // an augmenting path from a member (mi; -1: a candidate not added yet) through his slots on day t
  private reach(slots: number[], t: number, seen: Set<number>, mi: number, commit: boolean): boolean {
    for (const s of slots) {
      if (seen.has(s)) continue
      seen.add(s)
      const h = this.holder[s]
      if (h < 0 || this.reach(this.members[h].slots[t], t, seen, h, commit)) {
        if (commit) { this.holder[s] = mi; this.dutyOf[mi][t] = s }
        return true
      }
    }
    return false
  }

  // an augmenting path from a slot nobody holds, through the members who may take it
  private reachSlot(s: number, t: number, seen: Set<number>): boolean {
    for (const mi of this.cands[s]) {
      if (this.removed[mi] || seen.has(mi)) continue
      seen.add(mi)
      const o = this.dutyOf[mi][t]
      if (o < 0 || this.reachSlot(o, t, seen)) {
        this.holder[s] = mi
        this.dutyOf[mi][t] = s
        return true
      }
    }
    return false
  }

  coveredByDay(): Map<number, number> {
    const out = new Map<number, number>()
    this.slots.forEach(s => out.set(s.t, (out.get(s.t) ?? 0) + 1))
    for (const [t, n] of out) out.set(t, n - this.uncovered[t])
    return out
  }

  // a virtual crew member of the shift in the group (offset of the shift's pattern): his slots
  virtual(shift: ConsoleInput['shifts'][number], offset: number): CoverMember {
    const works = (day: Day) => !shift.pattern || restPatternWorks(shift.pattern.cycle, offset, day)
    const warn = this.input.ruleModes.shiftWindow === 'WARN'
    const slots: number[][] = Array.from({ length: this.T }, () => [])
    this.slots.forEach(({ t, duty }, si) => {
      if (!works(this.input.days[t].day)) return
      const fits = shiftFits(shift, duty.start, duty.end, duty.kind)
      if (fits || (warn && this.restKept(shift, works, t, duty))) slots[t].push(si)
    })
    return { shiftId: shift.id, group: groupKey(shift.id, shift.pattern, offset), works: this.input.days.map(d => works(d.day)), slots, real: false }
  }

  // days the member would cover that nobody does now
  gain(c: CoverMember): number {
    let n = 0
    for (let t = 0; t < this.T; t++) if (this.uncovered[t] && c.slots[t].length && this.reach(c.slots[t], t, new Set(), -1, false)) n++
    return n
  }

  add(c: CoverMember): void {
    const mi = this.members.push(c) - 1
    this.dutyOf.push(new Int32Array(this.T).fill(-1))
    this.removed.push(false)
    for (let t = 0; t < this.T; t++) for (const s of c.slots[t]) this.cands[s].push(mi)
    for (let t = 0; t < this.T; t++) if (this.uncovered[t] && this.reach(c.slots[t], t, new Set(), mi, true)) this.uncovered[t]--
  }

  // takes the member out if everything he holds is taken by someone else; else nothing changes
  tryRemove(mi: number): boolean {
    const holder = this.holder.slice(), dutyOf = this.dutyOf.map(a => a.slice())
    this.removed[mi] = true
    for (let t = 0; t < this.T; t++) {
      const s = this.dutyOf[mi][t]
      if (s < 0) continue
      this.holder[s] = -1
      this.dutyOf[mi][t] = -1
      if (!this.reachSlot(s, t, new Set([mi]))) {
        this.holder = holder
        this.dutyOf = dutyOf
        this.removed[mi] = false
        return false
      }
    }
    return true
  }

  // the shifts whose duties the member may take on day t
  servable(mi: number, t: number): Set<string | null> { return new Set(this.members[mi].slots[t].map(si => this.slots[si].duty.shiftId)) }
  // whether the member works day t without a duty
  idle(mi: number, t: number): boolean { return !this.removed[mi] && this.members[mi].works[t] && this.dutyOf[mi][t] < 0 }
}

// `total` split in proportion to `exact`: the floors, then one more to the largest remainders
function largestRemainder(total: number, exact: number[]): number[] {
  const out = exact.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  for (const i of exact.map((_, i) => i).sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])))) {
    if (left <= 0) break
    out[i]++
    left--
  }
  return out
}

const groupKey = (shiftId: string | null, pattern: { id: string } | null, offset: number) => `${shiftId}|${pattern?.id ?? '-'}|${offset}`

// The operational crew from the current coverage: virtual crew members — one per shift × group of
// the shift's pattern — added while one covers more, the one covering the most days first (ties:
// the shift of lowest priority, then the smaller group); then the current crew members nothing
// needs taken out. Greedy: a good bound, not always the fewest.
function operationalRun(input: ConsoleInput, cover: WindowCover) {
  const size = new Map<string, number>()
  cover.members.forEach(m => size.set(m.group, (size.get(m.group) ?? 0) + 1))
  const priority = new Map(input.shifts.map(s => [s.id, s.priority]))

  // operational: add
  const candidates = input.shifts.flatMap(s => (s.pattern ? restGroupOffsets({ pattern: s.pattern.cycle.pattern, staggered: s.pattern.staggered }) : [0]).map(o => cover.virtual(s, o)))
  const added = new Map<string, number>()
  for (;;) {
    let best: CoverMember | null = null, bestGain = 0
    for (const c of candidates) {
      const g = cover.gain(c)
      if (g > bestGain || (g === bestGain && g > 0 && best && (
        (priority.get(c.shiftId!) ?? 0) < (priority.get(best.shiftId!) ?? 0)
        || ((priority.get(c.shiftId!) ?? 0) === (priority.get(best.shiftId!) ?? 0) && (size.get(c.group) ?? 0) < (size.get(best.group) ?? 0))
      ))) { best = c; bestGain = g }
    }
    if (!best) break
    cover.add({ ...best })
    added.set(best.group, (added.get(best.group) ?? 0) + 1)
    size.set(best.group, (size.get(best.group) ?? 0) + 1)
  }

  // operational: take out one at a time from the group with the most crew left, so the groups stay
  // even (emptying one first would leave the others unable to cover its days); a group is done at
  // its first crew member needed
  const removedOf = new Map<string, number>()
  const pool = new Map<string, number[]>()
  cover.members.forEach((m, mi) => { if (m.real) pool.set(m.group, [...(pool.get(m.group) ?? []), mi]) })
  for (;;) {
    const next = [...pool].filter(([, list]) => list.length).sort((a, b) => b[1].length - a[1].length)[0]
    if (!next) break
    const [group, list] = next
    if (!cover.tryRemove(list.pop()!)) { pool.delete(group); continue }
    removedOf.set(group, (removedOf.get(group) ?? 0) + 1)
  }

  // per day type: what's left nobody can take, on its worst day
  const unfit: ConsoleSizing['unfit'] = {}
  input.days.forEach((d, t) => { if (cover.uncovered[t]) unfit[d.dayTypeId] = Math.max(unfit[d.dayTypeId] ?? 0, cover.uncovered[t]) })
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
  return { cover, added, removedOf, unfit, net: total(added) - total(removedOf) }
}

// The crew the plans need (ConsoleSizing): the operational crew and the vacation reserve — the
// hour bank's crew apart. Under shiftWindow WARN the greedy run may keep crew of one shift holding another's
// duties where that shift's own crew would do with fewer — a crew that doesn't cross is a crew
// that may: the strict run wins when it takes fewer, leaving no more duties without anyone.
export function sizing(input: ConsoleInput, cover: WindowCover): ConsoleSizing {
  const supply = input.crew.filter(inSupply)
  const priority = new Map(input.shifts.map(s => [s.id, s.priority]))
  let run = operationalRun(input, cover)
  if (input.ruleModes.shiftWindow === 'WARN') {
    const strict: ConsoleInput = { ...input, ruleModes: { ...input.ruleModes, shiftWindow: 'BLOCK' } }
    const alt = operationalRun(strict, new WindowCover(strict, supply))
    const lost = (u: ConsoleSizing['unfit']) => Object.values(u).reduce((a, b) => a + b, 0)
    if (alt.net < run.net && lost(alt.unfit) <= lost(run.unfit)) run = alt
  }
  const { added, removedOf, unfit } = run
  cover = run.cover

  // per shift: current and operational
  const shiftOfGroup = (g: string) => g.split('|')[0]
  const rows = input.shifts.map(s => {
    const current = supply.filter(m => m.shiftId === s.id).length
    let op = current
    for (const [g, n] of added) if (shiftOfGroup(g) === s.id) op += n
    for (const [g, n] of removedOf) if (shiftOfGroup(g) === s.id) op -= n
    return { shiftId: s.id, current, operational: op, vacation: 0, bank: 0, required: 0 }
  })
  const operational = rows.reduce((n, r) => n + r.operational, 0)

  // vacation: on the operational crew, split among the shifts by the largest remainder
  largestRemainder(ceil(operational * VACATION_SHARE), rows.map(r => r.operational * VACATION_SHARE)).forEach((n, i) => { rows[i].vacation = n })

  // the hour bank: the planned overtime's banked share, as days off of each shift's journey a
  // month — per day type, its days a month by the convention. The crew working idle absorbs them
  // first: an idle crew member on a day takes the days off of a shift whose duties he may take that
  // day, the neediest first (by his own shift it'd be arbitrary — overlapping windows leave the
  // matching free to pick who stays idle). What's left becomes crew, rounded on the total.
  const typeDays = new Map<string, number[]>()
  input.days.forEach((d, t) => typeDays.set(d.dayTypeId, [...(typeDays.get(d.dayTypeId) ?? []), t]))
  const monthDays = new Map([...typeDays].map(([type, ts]) => {
    const count = new Array(7).fill(0)
    for (const t of ts) count[input.days[t].weekday]++
    return [type, MONTH_DAYS[count.indexOf(Math.max(...count))]] as const
  }))
  const journeys = (list: ConsoleCrew[]) => list.flatMap(m => (m.journey ? [m.journey] : []))
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const allJourney = avg(journeys(supply)) ?? DEFAULT_JOURNEY
  const need = new Map(rows.map(r => {
    const overtime = input.duties.filter(d => d.shiftId === r.shiftId).reduce((n, d) => n + d.overtime * (monthDays.get(d.dayTypeId) ?? 0), 0)
    const journey = avg(journeys(supply.filter(m => m.shiftId === r.shiftId))) ?? allJourney
    return [r.shiftId, overtime * BANKED_SHARE * input.bankCompPct / 100 / journey] as const
  }))
  for (const [type, ts] of typeDays) {
    const w = (monthDays.get(type) ?? 0) / ts.length
    for (const t of ts) {
      cover.members.forEach((_, mi) => {
        if (!cover.idle(mi, t)) return
        let best: string | null = null
        for (const id of cover.servable(mi, t)) if (id && (need.get(id) ?? 0) > 0 && (!best || need.get(id)! > need.get(best)!)) best = id
        if (best) need.set(best, Math.max(0, need.get(best)! - w))
      })
    }
  }
  const owed = rows.map(r => {
    const cycle = input.shifts.find(s => s.id === r.shiftId)!.pattern?.cycle.pattern
    const worked = 30 * (cycle ? [...cycle].filter(c => c === 'T').length / cycle.length : 6 / 7)
    return (need.get(r.shiftId) ?? 0) / worked
  })
  largestRemainder(ceil(owed.reduce((a, b) => a + b, 0)), owed).forEach((n, i) => { rows[i].bank = n })
  // the bank's crew apart: what the plans need is operational + vacation
  for (const r of rows) r.required = r.operational + r.vacation

  // where the operational crew differs from the current one
  const groupRows: ConsoleSizing['groups'] = [...new Set([...added.keys(), ...removedOf.keys()])].map(g => {
    const [shiftId, patternId, offset] = g.split('|')
    const pattern = input.patterns.find(p => p.id === patternId) ?? input.shifts.find(s => s.pattern?.id === patternId)?.pattern ?? null
    const idx = pattern ? restGroupIndex({ pattern: pattern.cycle.pattern, staggered: pattern.staggered }, Number(offset)) : null
    return {
      shiftId, offset: Number(offset), label: idx == null ? null : restGroupLabel(idx),
      current: cover.members.filter(m => m.real && m.group === g).length, add: added.get(g) ?? 0, remove: removedOf.get(g) ?? 0,
    }
  }).sort((a, b) => (priority.get(a.shiftId) ?? 0) - (priority.get(b.shiftId) ?? 0) || a.offset - b.offset)

  const sum = (k: 'operational' | 'vacation' | 'bank' | 'required') => rows.reduce((n, r) => n + r[k], 0)
  return {
    current: supply.length, operational: sum('operational'), vacation: sum('vacation'), required: sum('required'),
    balance: supply.length - sum('required'), bank: sum('bank'), bankPct: input.bankCompPct, shifts: rows, groups: groupRows, unfit,
  }
}

// ── C: shifts ───────────────────────────────────────────────────────────────

function shiftsAnalysis(input: ConsoleInput, st: ConsoleStaffing): ConsoleShiftsAnalysis {
  const starts: ConsoleShiftsAnalysis['starts'] = {}
  const noShift: ConsoleShiftsAnalysis['noShift'] = {}
  const overlap = new Map<string, number>()
  for (const t of input.dayTypes) {
    const duties = input.duties.filter(d => d.dayTypeId === t.id && !d.standby)
    starts[t.id] = duties.map(d => d.start).sort((a, b) => a - b)
    const none = duties.filter(d => !d.shiftId).map(d => d.start)
    noShift[t.id] = { count: none.length, earliest: none.length ? Math.min(...none) : null, latest: none.length ? Math.max(...none) : null }
    for (const d of duties) {
      const fit = input.shifts.filter(s => shiftFits(s, d.start, d.end, d.kind)).map(s => s.id)
      if (fit.length > 1) {
        const key = fit.slice(0, 2).join('|')
        overlap.set(key, (overlap.get(key) ?? 0) + 1)
      }
    }
  }
  const idle: ConsoleShiftsAnalysis['idle'] = []
  for (const r of st.rows) {
    // crew working that day type (a regime off on it — Domingo Fixo — leaves nobody idle)
    for (const [t, c] of Object.entries(r.cells)) if (c.avg > 0 && c.demand === 0) idle.push({ shiftId: r.shiftId, dayTypeId: t, crew: Math.ceil(c.avg) })
  }
  return {
    starts, noShift, idle,
    overlaps: [...overlap].map(([k, count]) => ({ shiftIds: k.split('|') as [string, string], count })).sort((a, b) => b.count - a.count),
    noCrew: st.rows.filter(r => r.current === 0 && Object.values(r.cells).some(c => c.demand > 0)).map(r => r.shiftId),
  }
}

// ── D: rest groups ──────────────────────────────────────────────────────────

// The groups of one pattern within a shift that maximize the shift's worst balance over the window:
// one crew member at a time goes to the group that leaves the worst day best (ties: the group whose
// days off have the most to spare — the low-demand weekdays — then the one he's already in, so the
// fewest move, then the emptier one). The rest of the shift stays as it is.
export function idealGroupCounts(input: ConsoleInput, team: ConsoleCrew[], patternId: string): number[] {
  const mine = team.filter(m => m.pattern?.id === patternId)
  const p = mine[0]?.pattern
  if (!p) return []
  const offsets = restGroupOffsets({ pattern: p.cycle.pattern, staggered: p.staggered })
  const others = team.filter(m => m.pattern?.id !== patternId)
  const demand = input.days.map(d => input.duties.filter(x => x.shiftId === team[0]?.shiftId && x.dayTypeId === d.dayTypeId).length)
  const supply = input.days.map(d => others.filter(m => worksOn(m, d.day)).length)
  const works = offsets.map(o => input.days.map(d => restPatternWorks(p.cycle, o, d.day)))
  const counts = offsets.map(() => 0)
  // where they are now — on a tie a group keeps its own people, so the fewest move
  const shape = { pattern: p.cycle.pattern, staggered: p.staggered }
  const current = offsets.map((_, g) => mine.filter(m => restGroupIndex(shape, m.offset) === g).length)
  const keeps = (g: number) => (counts[g] < current[g] ? 1 : 0)
  for (let i = 0; i < mine.length; i++) {
    let best = 0, bestWorst = -Infinity, bestSpare = -Infinity
    for (let g = 0; g < offsets.length; g++) {
      // worst: the shift's worst day with him in g; spare: how much his days off can spare him
      let worst = Infinity, spare = Infinity
      for (let t = 0; t < supply.length; t++) {
        worst = Math.min(worst, supply[t] + (works[g][t] ? 1 : 0) - demand[t])
        if (!works[g][t]) spare = Math.min(spare, supply[t] - demand[t])
      }
      const tie = worst === bestWorst && spare === bestSpare
      if (worst > bestWorst || (worst === bestWorst && spare > bestSpare) || (tie && (keeps(g) > keeps(best) || (keeps(g) === keeps(best) && counts[g] < counts[best])))) {
        best = g; bestWorst = worst; bestSpare = spare
      }
    }
    counts[best]++
    works[best].forEach((w, t) => { if (w) supply[t]++ })
  }
  return counts
}

function worstBalance(input: ConsoleInput, team: ConsoleCrew[], shiftId: string): number {
  if (!input.days.length) return 0
  return Math.min(...input.days.map(d => team.filter(m => worksOn(m, d.day)).length - input.duties.filter(x => x.shiftId === shiftId && x.dayTypeId === d.dayTypeId).length))
}

function groups(input: ConsoleInput): ConsoleGroups[] {
  const supply = input.crew.filter(inSupply)
  return input.shifts.map(s => {
    const team = supply.filter(m => m.shiftId === s.id)
    const patternIds = [...new Set(team.flatMap(m => (m.pattern ? [m.pattern.id] : [])))]
    let ideal = team
    const patterns: ConsoleGroupPattern[] = patternIds.map(pid => {
      const mine = team.filter(m => m.pattern?.id === pid)
      const p = mine[0].pattern!
      const shape = { pattern: p.cycle.pattern, staggered: p.staggered }
      const offsets = restGroupOffsets(shape)
      const counts = idealGroupCounts(input, team, pid)
      // the ideal crew: this pattern's members spread as `counts` say (for worstIdeal)
      const spread = counts.flatMap((n, g) => Array.from({ length: n }, () => offsets[g]))
      let k = 0
      ideal = ideal.map(m => (m.pattern?.id === pid ? { ...m, offset: spread[k++] ?? m.offset } : m))
      return {
        patternId: pid, name: p.name, maxRun: maxRun(p.cycle.pattern),
        groups: offsets.map((o, g) => ({ label: restGroupLabel(g), offset: o, count: mine.filter(m => restGroupIndex(shape, m.offset) === g).length, ideal: counts[g] })),
        outside: mine.filter(m => restGroupIndex(shape, m.offset) == null).length,
      }
    })
    const weekdays = [0, 1, 2, 3, 4, 5, 6].map(w => {
      const dates = input.days.filter(d => d.weekday === w)
      if (!dates.length) return { supply: 0, demand: 0 }
      return {
        supply: Math.min(...dates.map(d => team.filter(m => worksOn(m, d.day)).length)),
        demand: Math.max(...dates.map(d => input.duties.filter(x => x.shiftId === s.id && x.dayTypeId === d.dayTypeId).length)),
      }
    })
    return {
      shiftId: s.id, patterns, noPattern: team.filter(m => !m.pattern).length, weekdays,
      worstNow: worstBalance(input, team, s.id), worstIdeal: worstBalance(input, ideal, s.id),
    }
  })
}

// ── E: lines per shift ──────────────────────────────────────────────────────

export function canOperate(m: ConsoleCrew, lineId: string, mode: RosterSettings['lineAccessMode']): boolean {
  return mode === 'WHITELIST' ? m.lineAccess[lineId] === 'ENABLED' : m.lineAccess[lineId] !== 'BLOCKED'
}

// per shift, never the whole day — spare crew in one shift doesn't cover another's shortage
export function lineRows(input: ConsoleInput): ConsoleLineRow[] {
  const supply = input.crew.filter(inSupply)
  const code = new Map(input.lines.map(l => [l.id, l.code]))
  const out: ConsoleLineRow[] = []
  for (const s of input.shifts) {
    const team = supply.filter(m => m.shiftId === s.id)
    const factor = cycleFactor(team)
    const byLine = new Map<string, ConsoleDuty[]>()
    for (const d of input.duties.filter(x => x.shiftId === s.id && !x.standby)) {
      const l = dominantLine(d)
      if (l) byLine.set(l, [...(byLine.get(l) ?? []), d])
    }
    for (const [lineId, duties] of byLine) {
      const count = Math.max(...input.dayTypes.map(t => duties.filter(d => d.dayTypeId === t.id).length))
      // may take at least one of the line's duties: access, and a vehicle type he doesn't block
      const able = team.filter(m => canOperate(m, lineId, input.lineAccessMode) && duties.some(d => !d.vehicleTypes.some(v => m.blockedVehicleTypes.includes(v))))
      const need = ceil(count * factor)
      out.push({
        lineId, lineCode: code.get(lineId) ?? '?', shiftId: s.id, duties: count, need, ideal: ceil(need * (1 + input.lineMarginPct / 100)), enabled: able.length,
        bonded: able.filter(m => m.priorityLines.includes(lineId) || m.prefLines.includes(lineId)).length, gap: able.length - need,
      })
    }
  }
  return out.sort((a, b) => a.gap - b.gap || a.lineCode.localeCompare(b.lineCode))
}

// ── alerts ──────────────────────────────────────────────────────────────────

const daysAhead = (from: Day, to: Day) => daysBetween(from, to)

function alerts(input: ConsoleInput, s: Omit<ConsoleSnapshot, 'alerts' | 'status'>): ConsoleAlert[] {
  const out: ConsoleAlert[] = []
  const typeName = new Map(input.dayTypes.map(t => [t.id, t.name]))
  const shiftName = new Map(input.shifts.map(x => [x.id, x.name]))
  const push = (a: ConsoleAlert) => out.push(a)

  if (input.scopes.length > 1) {
    push({ code: 'BRANCH_MULTI_SCOPE', severity: 'warning', section: 'plans', text: `A empresa opera em ${input.scopes.length} escopos com o mesmo quadro — os operadores contam em cada um` })
  }
  for (const p of s.plans) {
    const t = typeName.get(p.dayTypeId) ?? '?'
    if (!p.vehiclePlan) continue
    if (!p.crewPlan) push({ code: 'PLAN_NO_CREW', severity: 'error', section: 'plans', text: `${t}: plano efetivo sem escala ativa — o tipo de dia fica sem demanda`, link: { kind: 'vehicle-plan', id: p.vehiclePlan.id } })
    if (p.crewPlan?.noBranch) push({ code: 'DUTY_NO_BRANCH', severity: 'error', section: 'plans', text: `${t}: ${p.crewPlan.noBranch} tabela(s) sem empresa`, link: { kind: 'crew-plan', id: p.crewPlan.id } })
    if (p.linesWithoutPlan.length) push({ code: 'LINE_NO_PLAN', severity: 'error', section: 'plans', text: `${t}: linha(s) ${p.linesWithoutPlan.join(', ')} fora do plano efetivo`, link: { kind: 'vehicle-plan', id: p.vehiclePlan.id } })
    if (p.future && p.vehiclePlan.validFrom) push({ code: 'PLAN_FUTURE', severity: 'warning', section: 'plans', text: `${t}: plano efetivo só começa em ${p.vehiclePlan.validFrom.slice(8, 10)}/${p.vehiclePlan.validFrom.slice(5, 7)} — a análise já considera ele`, link: { kind: 'vehicle-plan', id: p.vehiclePlan.id } })
    if (p.crewPlan?.uncoveredMinutes) push({ code: 'PLAN_UNCOVERED', severity: 'warning', section: 'plans', text: `${t}: ${p.crewPlan.uncoveredMinutes} min de serviço sem tabela`, link: { kind: 'crew-plan', id: p.crewPlan.id } })
    if (p.crewPlan?.stale) push({ code: 'PLAN_STALE', severity: 'warning', section: 'plans', text: `${t}: ${p.crewPlan.stale} tabela(s) desatualizada(s)`, link: { kind: 'crew-plan', id: p.crewPlan.id } })
  }
  const z = s.sizing
  if (z.balance < 0) {
    const bank = z.bank ? ` — e +${z.bank} para abater ${z.bankPct}% do banco` : ''
    push({ code: 'CREW_SHORT', severity: 'error', section: 'staffing', text: `Faltam ${-z.balance} no quadro: necessário ${z.required} (operacional ${z.operational} · férias +${z.vacation}), atual ${z.current}${bank}` })
  }
  for (const [t, n] of Object.entries(z.unfit)) {
    push({ code: 'DUTY_UNFIT', severity: 'warning', section: 'staffing', text: `${typeName.get(t)}: ${n} tabela(s) que ninguém pode cobrir no pior dia — nenhum turno aceita o horário, ou ninguém pode operar a linha ou o veículo` })
  }
  for (const [t, x] of Object.entries(s.shiftsAnalysis.noShift)) {
    if (x.count) push({ code: 'DUTY_NO_SHIFT', severity: 'warning', section: 'shifts', text: `${typeName.get(t)}: ${x.count} tabela(s) fora de qualquer turno` })
  }
  for (const id of s.shiftsAnalysis.noCrew) push({ code: 'SHIFT_NO_CREW', severity: 'warning', section: 'shifts', text: `Turno ${shiftName.get(id)} tem tabelas e nenhum operador`, link: { kind: 'crew-shift', id } })
  for (const x of s.shiftsAnalysis.idle) push({ code: 'SHIFT_IDLE', severity: 'info', section: 'shifts', text: `Turno ${shiftName.get(x.shiftId)}: ${x.crew} operador(es) trabalhando e nenhuma tabela no ${typeName.get(x.dayTypeId)}` })
  for (const g of s.groups) {
    for (const p of g.patterns) {
      const off = p.groups.reduce((n, x) => n + Math.max(0, x.count - x.ideal), 0) + p.outside
      if (off >= 2 && g.worstIdeal > g.worstNow) {
        push({ code: 'GROUPS_OFF_DEMAND', severity: 'warning', section: 'groups', text: `Turno ${shiftName.get(g.shiftId)} · ${p.name}: ${off} operador(es) fora da distribuição pela demanda (pior dia ${g.worstNow} → ${g.worstIdeal})` })
      }
    }
  }
  const longRuns = new Map(s.groups.flatMap(g => g.patterns.filter(p => p.maxRun > 6).map(p => [p.patternId, p] as const)))
  for (const p of longRuns.values()) push({ code: 'REST_RUN_LONG', severity: 'warning', section: 'groups', text: `Regime ${p.name}: até ${p.maxRun} dias seguidos de trabalho`, link: { kind: 'rest-pattern', id: p.patternId } })
  for (const l of s.crewData.lines) {
    const where = `Linha ${l.lineCode} · ${shiftName.get(l.shiftId)}`
    if (l.gap < 0) push({ code: 'LINE_SHORT', severity: 'error', section: 'crew', text: `${where}: ${l.enabled} habilitados para ${l.need} necessários` })
    else if (l.enabled < l.ideal) push({ code: 'LINE_MARGIN', severity: 'warning', section: 'crew', text: `${where}: ${l.enabled} habilitados — abaixo da margem (${l.ideal} para ${l.need} necessários)` })
  }
  if (s.crewData.noProfile.length) push({ code: 'NO_PROFILE', severity: 'warning', section: 'crew', text: `${s.crewData.noProfile.length} funcionário(s) com cargo da função e sem perfil de operador` })
  if (s.crewData.noShift.length) push({ code: 'NO_SHIFT', severity: 'warning', section: 'crew', text: `${s.crewData.noShift.length} operador(es) sem turno vigente` })
  if (s.crewData.noPattern.length) push({ code: 'NO_PATTERN', severity: 'warning', section: 'crew', text: `${s.crewData.noPattern.length} operador(es) sem regime de folga` })
  for (const f of s.crewData.fixedCar) push({ code: 'FIXED_CAR_CONFLICT', severity: 'warning', section: 'crew', text: `${f.code} ${f.name}: carro fixo ${f.vehicleCode} — ${f.reason}`, link: { kind: 'crew-member', id: f.id } })
  if (s.crewData.away.length) push({ code: 'AWAY', severity: 'info', section: 'crew', text: `${s.crewData.away.length} operador(es) afastado(s) fora do quadro` })
  const asked = s.requests.filter(r => r.status === 'REQUESTED').length
  if (asked) push({ code: 'CHANGE_REQUESTED', severity: 'info', section: 'requests', text: `${asked} pedido(s) de troca de turno ou grupo aguardando análise` })
  const ready = s.requests.filter(r => r.status === 'QUEUED' && r.ready).length
  if (ready) push({ code: 'CHANGE_READY', severity: 'warning', section: 'requests', text: `${ready} pedido(s) na fila já podem ser atendidos` })
  for (const d of s.dailyErrors) {
    const when = daysAhead(input.today, d.date) <= 1 ? 'Amanhã' : `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`
    push({
      code: 'DAILY_ERROR', severity: 'error', section: 'daily', link: { kind: 'escala', date: d.date },
      text: `${when}: ${[...d.issues.map(i => `${i.count} ${i.label.toLowerCase()}`), ...(d.outdated ? ['desatualizado'] : [])].join(', ')}`,
    })
  }
  const rank = { error: 0, warning: 1, info: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

function sectionStatus(list: ConsoleAlert[]): Record<ConsoleSection, ConsoleSectionStatus> {
  const rank = { error: 0, warning: 1, info: 2 }
  const out = {} as Record<ConsoleSection, ConsoleSectionStatus>
  for (const section of CONSOLE_SECTIONS) {
    const mine = list.filter(a => a.section === section).sort((a, b) => rank[a.severity] - rank[b.severity])
    out[section] = mine.length ? { severity: mine[0].severity, count: mine.filter(a => a.severity === mine[0].severity).length } : { severity: 'ok', count: 0 }
  }
  return out
}

// ── the snapshot ────────────────────────────────────────────────────────────

// `requests`: the open change requests rated (console.actions changeRequestRows)
export function computeConsole(input: ConsoleInput, requests: ConsoleChangeRequest[] = []): ConsoleSnapshot {
  const cover = new WindowCover(input, input.crew.filter(inSupply))
  const st = staffing(input, input.crew, cover.coveredByDay())
  const crewData: ConsoleCrewData = {
    noProfile: input.noProfile,
    noShift:   input.crew.filter(m => !m.shiftId && !m.away).map(ref),
    noPattern: input.crew.filter(m => m.shiftId && !m.pattern && !m.away).map(ref),
    outOfGenerator: input.crew.filter(m => !m.rosterable).map(ref),
    away:      input.crew.filter(m => m.away).map(m => ({ ...ref(m), reason: m.away!.reason, until: m.away!.until })),
    vacation:  input.crew.filter(m => m.vacation).map(m => ({ ...ref(m), until: m.vacation!.until, cover: m.vacation!.cover })),
    fixedCar:  input.fixedCar,
    lines:     lineRows(input),
  }
  const typeDays = new Map<string, number>()
  for (const d of input.days) typeDays.set(d.dayTypeId, (typeDays.get(d.dayTypeId) ?? 0) + 1)
  const base: Omit<ConsoleSnapshot, 'alerts' | 'status'> = {
    scopeId: input.scopeId, branchId: input.branchId, role: input.role, today: input.today, scopes: input.scopes,
    dayTypes: input.dayTypes.map(t => ({ ...t, days: typeDays.get(t.id) ?? 0 })),
    shifts: input.shifts.map(({ id, code, name, startFloor, startIdealMin, startIdealMax, startCeiling, endFloor, endIdealMin, endIdealMax, endCeiling, allowSplit }) =>
      ({ id, code, name, startFloor, startIdealMin, startIdealMax, startCeiling, endFloor, endIdealMin, endIdealMax, endCeiling, allowSplit })),
    plans: input.plans.map(p => ({ ...p, future: !!p.vehiclePlan?.validFrom && daysAhead(input.today, p.vehiclePlan.validFrom) > CONSOLE_FUTURE_DAYS })),
    staffing: st,
    sizing: sizing(input, cover),
    shiftsAnalysis: shiftsAnalysis(input, st),
    groups: groups(input),
    crew: { active: input.crew.filter(inSupply).length, away: crewData.away.length, vacation: crewData.vacation.length },
    crewData,
    dailyErrors: input.dailyErrors,
    requests,
  }
  const list = alerts(input, base)
  return { ...base, alerts: list, status: sectionStatus(list) }
}

export const dailyIssueLabel = (code: string) => (DAILY_ISSUE_LABEL as Record<string, string>)[code] ?? code
