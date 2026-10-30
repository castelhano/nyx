import {
  nextRestDay, restGroupIndex, restGroupLabel, restGroupOffsets, restPatternWorks,
  type ConsoleActionKind, type ConsoleChangeRequest, type ConsoleImpact, type ConsoleMove, type ConsoleSuggestion, type RebalanceRules,
} from '@nyx/schemas'
import { addDays, type Day } from '../timetabling/plan-validity'
import {
  canOperate, idealGroupCounts, inSupply, lineRows, staffing,
  type ConsoleCrew, type ConsoleInput, type ConsolePattern,
} from './console.calc'

// The Painel de Escala's adjustments, pure (the service loads ConsoleInput and writes the result).
// Each one: how many from the balances, who by the empresa's selection rule
// (transit.roster.rebalanceRules) after the fixed filters. Only crew records change — the
// generator rosters the new crew from the next generation on.

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const monthYear = (d: Day) => `${d.slice(5, 7)}/${d.slice(0, 4)}`
const fmtDay = (d: Day) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const fmtTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

type Shift = ConsoleInput['shifts'][number]
export interface MoveItem { crewMemberId: string; to: string; offset: number | null; patternId?: string | null; lineId?: string | null }

const works = (m: ConsoleCrew, day: Day) => !m.pattern || restPatternWorks(m.pattern.cycle, m.offset, day)

// ── crew after the moves ────────────────────────────────────────────────────

// the crew member as he'd be: in the destination shift (its window), with his own
// pattern, the one set by the adjustment, or the shift's, and the given group
export function moved(m: ConsoleCrew, to: Shift, offset: number | null, pattern?: ConsolePattern | null): ConsoleCrew {
  const own = pattern !== undefined && pattern !== null
  return {
    ...m, shiftId: to.id,
    window: to,
    pattern: own ? pattern : m.ownPattern ? m.pattern : to.pattern,
    ownPattern: own || m.ownPattern,
    offset: offset ?? m.offset,
  }
}

// a new crew profile (profiles action): an employee in the shift, the given group — in the given
// pattern, else the shift's
function newcomer(input: ConsoleInput, employeeId: string, to: Shift, offset: number | null, pattern?: ConsolePattern | null): ConsoleCrew | null {
  const e = input.noProfile.find(x => x.employeeId === employeeId)
  if (!e) return null
  return moved({
    id: e.employeeId, code: e.code, name: e.name, hireDate: e.hireDate, shiftId: to.id, shiftSince: input.today,
    window: null, notBefore: null, notAfter: null, journey: null, pattern: to.pattern, ownPattern: false, offset: 0,
    lineAccess: {}, prefLines: [], priorityLines: [], blockedVehicleTypes: [], standbyBlocked: false, rosterable: true, away: null, vacation: null,
  }, to, offset, pattern)
}

export function applyMoves(input: ConsoleInput, kind: ConsoleActionKind, items: MoveItem[]): ConsoleInput {
  const shiftById = new Map(input.shifts.map(s => [s.id, s]))
  const patternById = new Map(input.patterns.map(p => [p.id, p]))
  const mark = input.lineAccessMode === 'WHITELIST' ? 'ENABLED' : null
  if (kind === 'profiles') {
    const added = items.flatMap(i => newcomer(input, i.crewMemberId, shiftById.get(i.to)!, i.offset, i.patternId ? patternById.get(i.patternId) ?? null : undefined) ?? [])
    return { ...input, crew: [...input.crew, ...added] }
  }
  const by = new Map(items.map(i => [i.crewMemberId, i]))
  return {
    ...input,
    crew: input.crew.map(m => {
      const i = by.get(m.id)
      if (!i) return m
      if (kind === 'lines' && i.lineId) {
        const lineAccess = { ...m.lineAccess }
        if (mark) lineAccess[i.lineId] = mark
        else delete lineAccess[i.lineId]
        return { ...m, lineAccess }
      }
      if (kind === 'priority' && i.lineId) return { ...m, priorityLines: [...new Set([...m.priorityLines, i.lineId])] }
      return moved(m, shiftById.get(i.to)!, i.offset, i.patternId ? patternById.get(i.patternId) ?? null : undefined)
    }),
  }
}

// ── shared helpers ──────────────────────────────────────────────────────────

// each shift over the window, by the label (cheap — no matching): its worst balance, and the
// shortage — Σ of the duties missing crew over the days (one move rarely lifts the worst day, as
// he's off on one of them; it always lowers the shortage)
function shiftBalances(input: ConsoleInput, crew: ConsoleCrew[]): Map<string, { worst: number; shortage: number }> {
  const supply = crew.filter(inSupply)
  const out = new Map<string, { worst: number; shortage: number }>()
  for (const s of input.shifts) {
    const team = supply.filter(m => m.shiftId === s.id)
    let worst = Infinity, shortage = 0
    for (const d of input.days) {
      const n = team.filter(m => works(m, d.day)).length
      const demand = input.duties.filter(x => x.shiftId === s.id && x.dayTypeId === d.dayTypeId).length
      worst = Math.min(worst, n - demand)
      shortage += Math.max(0, demand - n)
    }
    out.set(s.id, { worst: worst === Infinity ? 0 : worst, shortage })
  }
  return out
}
const worstOf = (b: Map<string, { worst: number }>, id: string) => b.get(id)?.worst ?? 0

// why a crew member can't go to the destination — null: he can
function blockedFrom(input: ConsoleInput, m: ConsoleCrew, to: Shift): string | null {
  if (m.notBefore != null && m.notBefore > to.startCeiling) return `Não inicia antes de ${fmtTime(m.notBefore)}`
  if (m.notAfter != null && m.notAfter < to.endFloor) return `Não termina depois de ${fmtTime(m.notAfter)}`
  const duties = input.duties.filter(d => d.shiftId === to.id && !d.standby)
  if (!duties.length) return null
  const able = duties.filter(d => {
    const line = d.lineMinutes.reduce<{ lineId: string; minutes: number } | null>((a, l) => (!a || l.minutes > a.minutes ? l : a), null)
    return (!line || canOperate(m, line.lineId, input.lineAccessMode)) && !d.vehicleTypes.some(v => m.blockedVehicleTypes.includes(v))
  }).length
  return able * 2 < duties.length ? `Não opera a maioria das tabelas do turno (${able} de ${duties.length})` : null
}

// the order of the selection rule — the first ones move; matrícula last
// `spread`: the lineSpread criterion (rest groups only) — how far above their fair share his lines
// are in his group; the higher first. Without it the criterion is skipped.
function rank<T extends Pick<ConsoleCrew, 'code' | 'hireDate' | 'shiftSince'>>(list: T[], rules: RebalanceRules, spread?: (m: T) => number): T[] {
  const keys = rules.criteria.filter(c => c.active).map(c => c.key)
  return [...list].sort((a, b) => {
    for (const k of keys) {
      if (k === 'lineSpread') {
        const x = spread ? spread(b) - spread(a) : 0
        if (Math.abs(x) > 1e-9) return x
        continue
      }
      // the most recent first: later dates sort first
      const x = k === 'shiftTenure' ? (b.shiftSince ?? '').localeCompare(a.shiftSince ?? '') : b.hireDate.localeCompare(a.hireDate)
      if (x) return x
    }
    return a.code.localeCompare(b.code, 'pt-BR', { numeric: true })
  })
}

function reasons(m: Pick<ConsoleCrew, 'hireDate' | 'shiftSince'>, rules: RebalanceRules): string[] {
  return rules.criteria.filter(c => c.active && c.key !== 'lineSpread').map(c => (c.key === 'shiftTenure'
    ? (m.shiftSince ? `No turno desde ${monthYear(m.shiftSince)}` : 'Sem data no turno')
    : `Admissão ${monthYear(m.hireDate)}`))
}

// "B · folga Dom" — weekly cycles name the weekday off
export function groupLabel(p: ConsolePattern, offset: number, today: Day): string {
  const shape = { pattern: p.cycle.pattern, staggered: p.staggered }
  const g = restGroupIndex(shape, offset)
  const letter = g == null ? `+${offset}` : restGroupLabel(g)
  if (p.cycle.pattern.length !== 7) return letter
  const off = nextRestDay(p.cycle, offset, today)
  return off ? `${letter} · folga ${WEEKDAYS[(new Date(`${off}T00:00:00Z`).getUTCDay() + 6) % 7]}` : letter
}

function groupOptions(p: ConsolePattern | null, today: Day): ConsoleMove['groupOptions'] {
  return p ? restGroupOffsets({ pattern: p.cycle.pattern, staggered: p.staggered }).map(offset => ({ offset, label: groupLabel(p, offset, today) })) : []
}

// where one more crew member goes in the destination, with `team` already there: the group (in
// pattern `p`; none → he works every day) that lowers its shortage the most, then the best worst
// day, then the group with fewest of the team — and the shortage and worst day it leaves
function placement(input: ConsoleInput, team: ConsoleCrew[], to: Shift, p: ConsolePattern | null): { offset: number | null; short: number; worst: number } {
  const demand = input.days.map(d => input.duties.filter(x => x.shiftId === to.id && x.dayTypeId === d.dayTypeId).length)
  const supply = input.days.map(d => team.filter(m => works(m, d.day)).length)
  const shape = p && { pattern: p.cycle.pattern, staggered: p.staggered }
  const inGroup = (o: number) => team.filter(m => m.pattern?.id === p!.id && restGroupIndex(shape!, m.offset) === restGroupIndex(shape!, o)).length
  let best = { offset: null as number | null, short: Infinity, worst: -Infinity }, bestCount = Infinity
  for (const o of shape ? restGroupOffsets(shape) : [null]) {
    let worst = Infinity, short = 0
    input.days.forEach((d, t) => {
      const b = supply[t] + (o == null || restPatternWorks(p!.cycle, o, d.day) ? 1 : 0) - demand[t]
      worst = Math.min(worst, b)
      short += Math.max(0, -b)
    })
    const count = o == null ? 0 : inGroup(o)
    if (short < best.short || (short === best.short && (worst > best.worst || (worst === best.worst && count < bestCount)))) {
      best = { offset: o, short, worst }
      bestCount = count
    }
  }
  return best
}
const bestOffset = (input: ConsoleInput, team: ConsoleCrew[], to: Shift, p: ConsolePattern | null) => (p ? placement(input, team, to, p).offset : null)

// The suggestions balance only the day types with an effective crew plan — on the others the only
// demand left is the plantões, which would steer everyone to their shifts
export function planned(input: ConsoleInput): { input: ConsoleInput; left: string[] } {
  const types = new Set(input.plans.filter(p => p.crewPlan).map(p => p.dayTypeId))
  const left = input.dayTypes.filter(t => !types.has(t.id) && input.days.some(d => d.dayTypeId === t.id)).map(t => t.name)
  return { input: { ...input, days: input.days.filter(d => types.has(d.dayTypeId)) }, left }
}

const empty = (kind: ConsoleActionKind, title: string, summary: string): ConsoleSuggestion => ({ kind, title, summary, moves: [], bench: {}, excluded: [] })

// ── shifts ──────────────────────────────────────────────────────────────────

export function suggestShifts(input: ConsoleInput, rules: RebalanceRules): ConsoleSuggestion {
  const shiftById = new Map(input.shifts.map(s => [s.id, s]))
  let crew = input.crew
  const taken = new Set<string>()
  const moves: ConsoleMove[] = []
  const bench: ConsoleSuggestion['bench'] = {}
  const excluded = new Map<string, ConsoleSuggestion['excluded'][number]>()
  const toMove = (m: ConsoleCrew, from: Shift, to: Shift, offset: number | null, why: string[] = []): ConsoleMove => {
    const p = m.ownPattern ? m.pattern : to.pattern
    return {
      crewMemberId: m.id, code: m.code, name: m.name, from: from.id, to: to.id, offset,
      groupLabel: p && offset != null ? groupLabel(p, offset, input.today) : null, patternName: p?.name ?? null,
      groupOptions: groupOptions(p, input.today), change: `${from.name} → ${to.name}`, reasons: [...why, ...reasons(m, rules)],
    }
  }
  // his group in the destination: the one he queued for in its pattern, else where it needs one most
  const groupIn = (m: ConsoleCrew, to: Shift, team: ConsoleCrew[]) => {
    const p = m.ownPattern ? m.pattern : to.pattern
    return queuedGroup(input, m.id, p) ?? bestOffset(input, team, to, p)
  }

  const balance = shiftBalances(input, crew)
  const short = input.shifts.filter(s => worstOf(balance, s.id) < 0).sort((a, b) => worstOf(balance, a.id) - worstOf(balance, b.id))
  for (const target of short) {
    // the queue first: who asked for this shift, oldest first, from any shift with crew to spare
    for (const r of input.requests.filter(x => x.status === 'QUEUED' && x.kind === 'SHIFT' && x.shiftId === target.id)) {
      const cur = shiftBalances(input, crew)
      if (worstOf(cur, target.id) >= 0) break
      const m = crew.find(x => x.id === r.crewMemberId)
      const from = m?.shiftId ? shiftById.get(m.shiftId) : undefined
      if (!m || !from || !inSupply(m) || taken.has(m.id) || from.id === target.id || worstOf(cur, from.id) <= 0 || blockedFrom(input, m, target)) continue
      const offset = groupIn(m, target, crew.filter(x => inSupply(x) && x.shiftId === target.id))
      const trial = crew.map(x => (x.id === m.id ? moved(x, target, offset) : x))
      const after = shiftBalances(input, trial)
      if (worstOf(after, from.id) < 0 || after.get(target.id)!.shortage >= cur.get(target.id)!.shortage) continue
      crew = trial
      taken.add(m.id)
      moves.push(toMove(m, from, target, offset, [`Pedido na fila desde ${fmtDay(r.createdAt.slice(0, 10))}`]))
    }
    const donors = input.shifts.filter(s => s.id !== target.id && worstOf(balance, s.id) > 0).sort((a, b) => worstOf(balance, b.id) - worstOf(balance, a.id))
    for (const donor of donors) {
      if (worstOf(shiftBalances(input, crew), target.id) >= 0) break
      const able: ConsoleCrew[] = []
      for (const m of crew.filter(x => inSupply(x) && x.shiftId === donor.id && !taken.has(x.id))) {
        const why = blockedFrom(input, m, target)
        if (why) excluded.set(m.id, { crewMemberId: m.id, code: m.code, name: m.name, reason: why })
        else able.push(m)
      }
      const left: ConsoleCrew[] = []
      for (const m of rank(able, rules)) {
        const cur = shiftBalances(input, crew)
        if (worstOf(cur, target.id) >= 0 || worstOf(cur, donor.id) <= 0) { left.push(m); continue }
        const offset = groupIn(m, target, crew.filter(x => inSupply(x) && x.shiftId === target.id))
        const trial = crew.map(x => (x.id === m.id ? moved(x, target, offset) : x))
        const after = shiftBalances(input, trial)
        // the donor never goes short, and the destination's shortage has to drop
        if (worstOf(after, donor.id) < 0 || after.get(target.id)!.shortage >= cur.get(target.id)!.shortage) { left.push(m); continue }
        crew = trial
        taken.add(m.id)
        moves.push(toMove(m, donor, target, offset))
      }
      const team = crew.filter(x => inSupply(x) && x.shiftId === target.id)
      bench[`${donor.id}>${target.id}`] = left.map(m => toMove(m, donor, target, bestOffset(input, team, target, m.ownPattern ? m.pattern : target.pattern)))
    }
  }

  // never trade coverage: drop the last moves while the crew can cover fewer duties than before. The
  // rest groups the moves unbalance ride along in the same adjustment, checked in the same pass (one
  // coverage check in the usual case — each is a full WindowCover); dropped first when it fails.
  const before = staffing(input).totals
  const asItems = (list: ConsoleMove[]) => list.map(m => ({ crewMemberId: m.crewMemberId, to: m.to, offset: m.offset }))
  const covers = (list: ConsoleMove[]) => {
    const after = staffing(applyMoves(input, 'shifts', asItems(list))).totals
    return Object.entries(before).every(([t, x]) => (after[t]?.coverable ?? 0) >= x.coverable)
  }
  const fixFor = (list: ConsoleMove[]) => (list.length ? compensateGroups(input, rules, applyMoves(input, 'shifts', asItems(list)).crew, list) : [])
  let groupFix = fixFor(moves)
  while (moves.length && !covers([...moves, ...groupFix])) {
    if (groupFix.length) { groupFix = []; continue }
    const last = moves.pop()!
    const key = `${last.from}>${last.to}`
    bench[key] = [last, ...(bench[key] ?? [])]
  }

  const pairs = new Map<string, number>()
  for (const m of moves) pairs.set(`${m.from}>${m.to}`, (pairs.get(`${m.from}>${m.to}`) ?? 0) + 1)
  const summary = [...pairs].map(([k, n]) => {
    const [a, b] = k.split('>')
    return `${n} de ${shiftById.get(a)!.name} para ${shiftById.get(b)!.name}`
  }).join(' · ')

  return {
    kind: 'shifts', title: 'Balancear turnos',
    summary: [summary || (short.length ? 'Nenhum operador elegível nos turnos com sobra' : 'Turnos equilibrados'), groupFix.length && `${groupFix.length} acerto(s) de grupo de folga`].filter(Boolean).join(' · '),
    moves: [...moves, ...groupFix], bench, excluded: [...excluded.values()],
  }
}

// the group a crew member queued for in pattern `p` — null: none
function queuedGroup(input: ConsoleInput, crewMemberId: string, p: ConsolePattern | null): number | null {
  if (!p) return null
  return input.requests.find(r => r.status === 'QUEUED' && r.kind === 'REST_GROUP' && r.crewMemberId === crewMemberId && r.restPatternId === p.id && r.restOffset != null)?.restOffset ?? null
}

// After shift moves (`crew`: as they leave it), the rest groups of each shift × pattern they touched,
// back to the demand's counts (idealGroupCounts): one move per crew member who left or came, at most —
// what was off before stays for the groups action. The movers stay put (the one arriving already took
// the group the destination needs most). Who goes: the oldest queued for an open group, else the
// selection rule, out of an overfull group into the emptiest.
function compensateGroups(input: ConsoleInput, rules: RebalanceRules, after: ConsoleCrew[], moves: ConsoleMove[]): ConsoleMove[] {
  const out: ConsoleMove[] = []
  const pinned = new Set(moves.map(m => m.crewMemberId))
  let crew = after
  const budget = new Map<string, number>()
  for (const mv of moves) {
    const was = input.crew.find(x => x.id === mv.crewMemberId)?.pattern
    const now = crew.find(x => x.id === mv.crewMemberId)?.pattern
    if (was) budget.set(`${mv.from}|${was.id}`, (budget.get(`${mv.from}|${was.id}`) ?? 0) + 1)
    if (now) budget.set(`${mv.to}|${now.id}`, (budget.get(`${mv.to}|${now.id}`) ?? 0) + 1)
  }
  for (const [key, n] of budget) {
    const [shiftId, pid] = key.split('|')
    for (let k = 0; k < n; k++) {
      const team = crew.filter(x => inSupply(x) && x.shiftId === shiftId)
      const mine = team.filter(x => x.pattern?.id === pid)
      if (!mine.length) break
      const p = mine[0].pattern!
      const shape = { pattern: p.cycle.pattern, staggered: p.staggered }
      const offsets = restGroupOffsets(shape)
      const ideal = idealGroupCounts(input, team, pid)
      const count = (g: number) => mine.filter(x => restGroupIndex(shape, x.offset) === g).length
      const under = offsets.map((_, g) => g).filter(g => count(g) < ideal[g])
      const pool = mine.filter(x => { const g = restGroupIndex(shape, x.offset); return !pinned.has(x.id) && g != null && count(g) > ideal[g] })
      if (!under.length || !pool.length) break
      const asked = input.requests.find(r => r.status === 'QUEUED' && r.kind === 'REST_GROUP' && r.restPatternId === pid && r.restOffset != null
        && under.includes(restGroupIndex(shape, r.restOffset)!) && pool.some(x => x.id === r.crewMemberId))
      const m = asked ? pool.find(x => x.id === asked.crewMemberId)! : rank(pool, rules)[0]
      const offset = asked ? asked.restOffset! : offsets[under.reduce((a, g) => (count(g) - ideal[g] < count(a) - ideal[a] ? g : a), under[0])]
      out.push({
        crewMemberId: m.id, code: m.code, name: m.name, from: shiftId, to: shiftId, offset, patternId: null,
        groupLabel: groupLabel(p, offset, input.today), patternName: p.name, groupOptions: groupOptions(p, input.today),
        change: `${groupLabel(p, m.offset, input.today)} → ${groupLabel(p, offset, input.today)}`,
        reasons: [asked ? `Pedido na fila desde ${fmtDay(asked.createdAt.slice(0, 10))}` : 'Acerto de grupo da troca de turno', ...reasons(m, rules)],
      })
      pinned.add(m.id)
      crew = crew.map(x => (x.id === m.id ? { ...x, offset } : x))
    }
  }
  return out
}

// ── rest groups by demand ───────────────────────────────────────────────────

// Within a shift, each pattern's crew spread over its groups as the demand asks (idealGroupCounts):
// the overfull groups give the ones the rule picks (and anyone between groups) to the short groups.
// Every row may also switch to another pattern.
// How many per group: the demand (idealGroupCounts). Who leaves an overfull group and where to: by
// the selection rule, where lineSpread (when active) weighs his lines — those bonded (priority or
// preferred) with duties in the shift — against their fair share in each group, ∝ the group's size.
export function suggestGroups(input: ConsoleInput, rules: RebalanceRules, shiftId: string): ConsoleSuggestion {
  const shift = input.shifts.find(s => s.id === shiftId)
  if (!shift) return empty('groups', 'Grupos de folga', 'Turno não encontrado')
  const team = input.crew.filter(m => inSupply(m) && m.shiftId === shiftId)
  const spreading = rules.criteria.some(c => c.key === 'lineSpread' && c.active)
  const shiftLines = new Set(lineRows(input).filter(r => r.shiftId === shiftId).map(r => r.lineId))
  const lineCode = new Map(input.lines.map(l => [l.id, l.code]))
  const linesOf = (m: ConsoleCrew) => [...new Set([...m.priorityLines, ...m.prefLines])].filter(l => shiftLines.has(l))
  const moves: ConsoleMove[] = [], benchList: ConsoleMove[] = []
  const toMove = (m: ConsoleCrew, offset: number, why: string[] = []): ConsoleMove => ({
    crewMemberId: m.id, code: m.code, name: m.name, from: shiftId, to: shiftId, offset, patternId: null,
    groupLabel: groupLabel(m.pattern!, offset, input.today), patternName: m.pattern!.name, groupOptions: groupOptions(m.pattern, input.today),
    change: `${groupLabel(m.pattern!, m.offset, input.today)} → ${groupLabel(m.pattern!, offset, input.today)}`, reasons: [...why, ...reasons(m, rules)],
  })
  for (const pid of [...new Set(team.flatMap(m => (m.pattern ? [m.pattern.id] : [])))]) {
    const mine = team.filter(m => m.pattern?.id === pid)
    const p = mine[0].pattern!
    const shape = { pattern: p.cycle.pattern, staggered: p.staggered }
    const offsets = restGroupOffsets(shape)
    const ideal = idealGroupCounts(input, team, pid)
    const idealTotal = ideal.reduce((a, b) => a + b, 0) || 1
    // where each one is as the moves go: group index (null: between groups)
    const at = new Map(mine.map(m => [m.id, restGroupIndex(shape, m.offset)]))
    const count = (g: number) => mine.filter(m => at.get(m.id) === g).length
    const bonded = new Map<string, number>()
    for (const m of mine) for (const l of linesOf(m)) bonded.set(l, (bonded.get(l) ?? 0) + 1)
    // his line l in group g: those there with it, over its fair share there
    const above = (l: string, g: number) => mine.filter(x => at.get(x.id) === g && linesOf(x).includes(l)).length - bonded.get(l)! * ideal[g] / idealTotal
    const excess = (m: ConsoleCrew) => {
      const g = at.get(m.id)
      return spreading && g != null ? linesOf(m).reduce((n, l) => n + above(l, g), 0) : 0
    }
    // why: his most concentrated line in the group he leaves
    const why = (m: ConsoleCrew): string[] => {
      const g = at.get(m.id)
      if (!spreading || g == null || !linesOf(m).length) return []
      const l = linesOf(m).sort((a, b) => above(b, g) - above(a, g))[0]
      if (above(l, g) <= 0) return []
      return [`Linha ${lineCode.get(l) ?? '?'}: ${mine.filter(x => at.get(x.id) === g && linesOf(x).includes(l)).length} no grupo ${restGroupLabel(g)}`]
    }
    const place = (m: ConsoleCrew) => {
      const open = offsets.map((_, g) => g).filter(g => count(g) < ideal[g])
      if (!open.length) return
      // the open group where his lines are least represented; ties: the first
      const score = (g: number) => (spreading ? linesOf(m).reduce((n, l) => n + above(l, g), 0) : 0)
      const g = open.reduce((best, h) => (score(h) < score(best) - 1e-9 ? h : best), open[0])
      moves.push(toMove(m, offsets[g], why(m)))
      at.set(m.id, g)
    }
    // the queued for a group of this pattern, oldest first (the requests' order)
    const queued = input.requests.filter(r => r.status === 'QUEUED' && r.kind === 'REST_GROUP' && r.restPatternId === pid && r.restOffset != null)
    // anyone between groups first, then one at a time out of the overfull groups
    for (const m of mine.filter(x => at.get(x.id) == null)) place(m)
    for (;;) {
      const over = mine.filter(m => { const g = at.get(m.id); return g != null && count(g) > ideal[g] && !moves.some(x => x.crewMemberId === m.id) })
      if (!over.length || offsets.every((_, g) => count(g) >= ideal[g])) break
      // whoever queued for an open group goes there first
      const asked = queued.find(r => { const g = restGroupIndex(shape, r.restOffset!); return g != null && count(g) < ideal[g] && over.some(m => m.id === r.crewMemberId) })
      if (asked) {
        const m = over.find(x => x.id === asked.crewMemberId)!
        moves.push(toMove(m, asked.restOffset!, [`Pedido na fila desde ${fmtDay(asked.createdAt.slice(0, 10))}`, ...why(m)]))
        at.set(m.id, restGroupIndex(shape, asked.restOffset!))
        continue
      }
      const before = moves.length
      place(rank(over, rules, excess)[0])
      if (moves.length === before) break
    }
    benchList.push(...rank(mine.filter(m => !moves.some(x => x.crewMemberId === m.id)), rules).map(m => toMove(m, m.offset)))
  }
  return {
    kind: 'groups', title: `Grupos de folga · ${shift.name}`,
    summary: moves.length ? `${moves.length} operador(es) mudam de grupo` : 'Os grupos já seguem a demanda',
    moves, bench: { [`${shiftId}>${shiftId}`]: benchList }, excluded: [],
    patterns: input.patterns.map(p => ({ id: p.id, name: p.name, groupOptions: groupOptions(p, input.today) })),
  }
}

// ── lines: enable, or make it a priority line ───────────────────────────────

// lines: the shift's crew who can't operate the line yet (access) — those who already prefer it
// first; priority: those who can, without it as a priority or preferred line
export function suggestLine(input: ConsoleInput, rules: RebalanceRules, kind: 'lines' | 'priority', shiftId: string, lineId: string): ConsoleSuggestion {
  const shift = input.shifts.find(s => s.id === shiftId)
  const code = input.lines.find(l => l.id === lineId)?.code ?? '?'
  const title = kind === 'lines' ? `Habilitar linha ${code}` : `Linha ${code} prioritária`
  if (!shift) return empty(kind, title, 'Turno não encontrado')
  const row = lineRows(input).find(l => l.shiftId === shiftId && l.lineId === lineId)
  // lines: up to the margin (need + lineMarginPct); priority: up to the need
  const need = row ? (kind === 'lines' ? row.ideal - row.enabled : row.need - row.bonded) : 0
  const team = input.crew.filter(m => inSupply(m) && m.shiftId === shiftId)
  const lineTypes = new Set(input.duties.filter(d => d.shiftId === shiftId && d.lineMinutes.some(l => l.lineId === lineId)).flatMap(d => d.vehicleTypes))
  const excluded: ConsoleSuggestion['excluded'] = []
  const pool = team.filter(m => {
    if (kind === 'lines' && canOperate(m, lineId, input.lineAccessMode)) return false
    if (kind === 'priority' && (!canOperate(m, lineId, input.lineAccessMode) || m.priorityLines.includes(lineId) || m.prefLines.includes(lineId))) return false
    const blocked = [...lineTypes].filter(t => m.blockedVehicleTypes.includes(t))
    if (blocked.length && blocked.length === lineTypes.size) {
      excluded.push({ crewMemberId: m.id, code: m.code, name: m.name, reason: `Tipo de veículo bloqueado (${blocked.join(', ')})` })
      return false
    }
    return true
  })
  const prefers = (m: ConsoleCrew) => (m.prefLines.includes(lineId) ? 0 : 1)
  const ranked = rank(pool, rules).sort((a, b) => prefers(a) - prefers(b))
  const toMove = (m: ConsoleCrew): ConsoleMove => ({
    crewMemberId: m.id, code: m.code, name: m.name, from: shiftId, to: shiftId, offset: null, lineId,
    groupLabel: null, patternName: null, groupOptions: [], change: kind === 'lines' ? `habilitar ${code}` : `${code} prioritária`,
    reasons: [...(m.prefLines.includes(lineId) ? [`Prefere ${code}`] : []), ...reasons(m, rules)],
  })
  const n = Math.max(0, Math.min(need, ranked.length))
  return {
    kind, title,
    summary: need > 0 ? `${n} de ${need} ${kind === 'lines' ? 'para a margem' : 'necessário(s)'} no turno ${shift.name}` : `A linha ${code} já tem ${kind === 'lines' ? 'a margem' : 'o necessário'} no turno ${shift.name}`,
    moves: ranked.slice(0, n).map(toMove), bench: { [`${shiftId}>${shiftId}`]: ranked.slice(n).map(toMove) }, excluded,
  }
}

// ── profiles ────────────────────────────────────────────────────────────────

// Each employee without a crew profile goes to the shift with the largest shortage, in the group
// that helps it most
// Each employee, one at a time, goes where he lowers the shortage the most (ties: the worst day);
// with no shortage left, where the crew is thinnest for the duties (crew ÷ duties over the window) —
// a shift without duties gets no one. No duties at all (no effective plan): no shift is suggested,
// the list picks it.
export function suggestProfiles(input: ConsoleInput, rules: RebalanceRules): ConsoleSuggestion {
  if (!input.noProfile.length || !input.shifts.length) return empty('profiles', 'Criar perfis de operador', 'Nenhum funcionário sem perfil')
  let crew = input.crew
  const moves: ConsoleMove[] = []
  const people = rank(input.noProfile.map(e => ({ ...e, shiftSince: null as Day | null })), rules)
  const dutiesOf = new Map(input.shifts.map(sh => [sh.id, input.days.reduce((n, d) => n + input.duties.filter(x => x.shiftId === sh.id && x.dayTypeId === d.dayTypeId).length, 0)]))
  for (const e of people) {
    const options = input.shifts.map(sh => {
      const team = crew.filter(x => inSupply(x) && x.shiftId === sh.id)
      const after = placement(input, team, sh, sh.pattern)
      const shortNow = input.days.reduce((n, d) => n + Math.max(0, input.duties.filter(x => x.shiftId === sh.id && x.dayTypeId === d.dayTypeId).length - team.filter(m => works(m, d.day)).length), 0)
      const worked = input.days.reduce((n, d) => n + team.filter(m => works(m, d.day)).length, 0)
      return { sh, offset: after.offset, gain: shortNow - after.short, worst: after.worst, ratio: dutiesOf.get(sh.id)! ? worked / dutiesOf.get(sh.id)! : Infinity }
    })
    const short = options.filter(o => o.gain > 0).sort((a, b) => b.gain - a.gain || a.worst - b.worst)[0]
    const thin = options.filter(o => o.ratio < Infinity).sort((a, b) => a.ratio - b.ratio)[0]
    const pick = short ?? thin
    const to = pick?.sh ?? null
    const offset = pick?.offset ?? null
    if (to) {
      const n = newcomer(input, e.employeeId, to, offset)
      if (n) crew = [...crew, n]
    }
    moves.push({
      crewMemberId: e.employeeId, code: e.code, name: e.name, from: to?.id ?? '', to: to?.id ?? '', offset,
      groupLabel: to?.pattern && offset != null ? groupLabel(to.pattern, offset, input.today) : null, patternName: to?.pattern?.name ?? null,
      groupOptions: groupOptions(to?.pattern ?? null, input.today), patternId: null,
      // the group each shift would give him — what the list falls back to when the shift is changed
      shiftOptions: options.map(o => ({ shiftId: o.sh.id, patternId: o.sh.pattern?.id ?? null, offset: o.offset })),
      change: `criar perfil · ${e.jobTitle}`, reasons: [`Admissão ${monthYear(e.hireDate)}`],
    })
  }
  const manual = moves.some(m => !m.to)
  return {
    kind: 'profiles', title: 'Criar perfis de operador',
    summary: `${moves.length} funcionário(s) com cargo da função${manual ? ' — sem tabelas para sugerir o turno: escolha na lista' : ''}`,
    moves, bench: {}, excluded: [],
    patterns: input.patterns.map(p => ({ id: p.id, name: p.name, groupOptions: groupOptions(p, input.today) })),
  }
}

// ── change requests ─────────────────────────────────────────────────────────

const away = (m: ConsoleCrew) => (m.away ? `Afastado até ${fmtDay(m.away.until)}` : !m.shiftId ? 'Sem turno vigente' : 'Fora do gerador')

// The queued requests that mirror each other, paired oldest first: SHIFT — he is in the shift the
// other asks for and asks for the other's, each fitting the other's shift; REST_GROUP — same shift and
// pattern, each asking for the other's group. A swap needs no place: each takes the other's.
export function pairSwaps(input: ConsoleInput): Map<string, string> {
  const crewById = new Map(input.crew.map(m => [m.id, m]))
  const shiftById = new Map(input.shifts.map(s => [s.id, s]))
  const queued = input.requests.filter(r => r.status === 'QUEUED' && crewById.get(r.crewMemberId) && inSupply(crewById.get(r.crewMemberId)!))
  const group = (m: ConsoleCrew, offset: number) => (m.pattern ? restGroupIndex({ pattern: m.pattern.cycle.pattern, staggered: m.pattern.staggered }, offset) : null)
  const mirrors = (r: ConsoleInput['requests'][number], q: ConsoleInput['requests'][number]): boolean => {
    const a = crewById.get(r.crewMemberId)!, b = crewById.get(q.crewMemberId)!
    if (r.kind !== q.kind || a.id === b.id) return false
    if (r.kind === 'SHIFT') {
      const toA = r.shiftId ? shiftById.get(r.shiftId) : undefined, toB = q.shiftId ? shiftById.get(q.shiftId) : undefined
      return !!toA && !!toB && r.shiftId === b.shiftId && q.shiftId === a.shiftId && !blockedFrom(input, a, toA) && !blockedFrom(input, b, toB)
    }
    return a.shiftId === b.shiftId && !!a.pattern && a.pattern.id === b.pattern?.id && r.restPatternId === a.pattern.id && q.restPatternId === a.pattern.id
      && r.restOffset != null && q.restOffset != null
      && group(a, r.restOffset) === group(b, b.offset) && group(b, q.restOffset) === group(a, a.offset)
  }
  const out = new Map<string, string>()
  for (const r of queued) {
    if (out.has(r.id)) continue
    const q = queued.find(x => !out.has(x.id) && mirrors(r, x))
    if (q) { out.set(r.id, q.id); out.set(q.id, r.id) }
  }
  return out
}

// Each open request, oldest first, with whether the Painel could grant it now — by the suggestions'
// own rule: SHIFT — the shift asked short and his own with a surplus, and he fits it; REST_GROUP —
// the group asked below the demand's count and his own above it. Position: among the queued asking
// the same. `input`: planned() — no day left, no effective plan to rate against.
export function changeRequestRows(input: ConsoleInput): ConsoleChangeRequest[] {
  const crewById = new Map(input.crew.map(m => [m.id, m]))
  const shiftById = new Map(input.shifts.map(s => [s.id, s]))
  const balance = input.days.length ? shiftBalances(input, input.crew) : null
  const queued = new Map<string, number>()

  const rate = (r: ConsoleInput['requests'][number], m: ConsoleCrew): { ready: boolean; reason: string } => {
    if (!balance) return { ready: false, reason: 'Sem planejamento efetivo' }
    if (!inSupply(m)) return { ready: false, reason: away(m) }
    const from = shiftById.get(m.shiftId!)
    if (r.kind === 'SHIFT') {
      const to = r.shiftId ? shiftById.get(r.shiftId) : undefined
      if (!to) return { ready: false, reason: 'Turno pedido fora da empresa' }
      const why = blockedFrom(input, m, to)
      if (why) return { ready: false, reason: why }
      if (worstOf(balance, to.id) >= 0) return { ready: false, reason: `${to.name} sem vaga` }
      if (worstOf(balance, m.shiftId!) <= 0) return { ready: false, reason: `${to.name} com vaga · ${from?.name ?? 'turno atual'} sem sobra` }
      return { ready: true, reason: `${to.name} com vaga` }
    }
    const p = m.pattern
    if (!p || p.id !== r.restPatternId || r.restOffset == null) return { ready: false, reason: 'Regime de folga mudou desde o pedido' }
    const shape = { pattern: p.cycle.pattern, staggered: p.staggered }
    const team = input.crew.filter(x => inSupply(x) && x.shiftId === m.shiftId)
    const ideal = idealGroupCounts(input, team, p.id)
    const count = (g: number) => team.filter(x => x.pattern?.id === p.id && restGroupIndex(shape, x.offset) === g).length
    const want = restGroupIndex(shape, r.restOffset), have = restGroupIndex(shape, m.offset)
    if (want == null) return { ready: false, reason: 'Grupo pedido inválido' }
    const name = (g: number) => `Grupo ${restGroupLabel(g)}`
    if (count(want) >= ideal[want]) return { ready: false, reason: `${name(want)} completo` }
    if (have != null && count(have) <= ideal[have]) return { ready: false, reason: `${name(want)} com vaga · ${name(have)} sem sobra` }
    return { ready: true, reason: `${name(want)} com vaga` }
  }

  const swaps = pairSwaps(input)
  return input.requests.flatMap(r => {
    const m = crewById.get(r.crewMemberId)
    if (!m) return []
    const pair = swaps.get(r.id)
    const other = pair ? crewById.get(input.requests.find(x => x.id === pair)!.crewMemberId)! : null
    const rated = rate(r, m)
    let position: number | null = null
    if (r.status === 'QUEUED') {
      const key = r.kind === 'SHIFT' ? `S|${r.shiftId}` : `G|${r.restPatternId}|${r.restOffset}`
      position = (queued.get(key) ?? 0) + 1
      queued.set(key, position)
    }
    return [{
      id: r.id, kind: r.kind, status: r.status, crewMemberId: m.id, code: m.code, name: m.name, change: r.change, notes: r.notes,
      createdAt: r.createdAt, position, shiftId: r.kind === 'SHIFT' ? r.shiftId : m.shiftId,
      // a swap is ready whatever the places; one ready on its own keeps its reason
      ...(other && !rated.ready ? { ready: true, reason: `Troca casada com ${other.code} ${other.name}` } : rated),
      swapWith: other && pair ? { requestId: pair, code: other.code, name: other.name } : null,
    }]
  })
}

// Granting one request now: his move alone, as a shifts / groups suggestion (the list, the date and
// the impact as usual). A new shift: the group he asked for when he has one open in the destination's
// pattern, else the group the destination needs most — he is moving anyway.
export function suggestRequest(input: ConsoleInput, rules: RebalanceRules, requestId: string, pairId?: string | null): ConsoleSuggestion {
  if (pairId) return suggestSwap(input, rules, requestId, pairId)
  const r = input.requests.find(x => x.id === requestId)
  const m = r && input.crew.find(x => x.id === r.crewMemberId)
  const from = m?.shiftId ? input.shifts.find(s => s.id === m.shiftId) : undefined
  const kind = r?.kind === 'REST_GROUP' ? 'groups' : 'shifts'
  if (!r || !m) return empty(kind, 'Atender pedido', 'Pedido não encontrado ou já encerrado')
  if (!from) return empty(kind, 'Atender pedido', `${m.code} ${m.name} sem turno vigente`)
  const title = `Atender pedido · ${m.code} ${m.name}`
  const asked = [`Pedido de ${fmtDay(r.createdAt.slice(0, 10))}`]
  const patterns = input.patterns.map(p => ({ id: p.id, name: p.name, groupOptions: groupOptions(p, input.today) }))

  if (r.kind === 'REST_GROUP') {
    const p = m.pattern
    if (!p || p.id !== r.restPatternId || r.restOffset == null) return empty('groups', title, 'Regime de folga mudou desde o pedido')
    return {
      kind: 'groups', title, summary: r.change, bench: {}, excluded: [], patterns,
      moves: [{
        crewMemberId: m.id, code: m.code, name: m.name, from: from.id, to: from.id, offset: r.restOffset, patternId: null,
        groupLabel: groupLabel(p, r.restOffset, input.today), patternName: p.name, groupOptions: groupOptions(p, input.today),
        change: `${groupLabel(p, m.offset, input.today)} → ${groupLabel(p, r.restOffset, input.today)}`, reasons: [...asked, ...reasons(m, rules)],
      }],
    }
  }

  const to = r.shiftId ? input.shifts.find(s => s.id === r.shiftId) : undefined
  if (!to) return empty('shifts', title, 'Turno pedido fora da empresa')
  const p = m.ownPattern ? m.pattern : to.pattern
  const group = p && input.requests.find(x => x.crewMemberId === m.id && x.kind === 'REST_GROUP' && x.restPatternId === p.id && x.restOffset != null)
  const team = input.crew.filter(x => inSupply(x) && x.shiftId === to.id)
  const offset = group ? group.restOffset : bestOffset(input, team, to, p)
  const why = blockedFrom(input, m, to)
  return {
    kind: 'shifts', title, summary: why ? `${r.change} — atenção: ${why}` : r.change, bench: {}, excluded: [],
    moves: [{
      crewMemberId: m.id, code: m.code, name: m.name, from: from.id, to: to.id, offset,
      groupLabel: p && offset != null ? groupLabel(p, offset, input.today) : null, patternName: p?.name ?? null,
      groupOptions: groupOptions(p, input.today), change: `${from.name} → ${to.name}`,
      reasons: [...asked, ...(group ? ['Grupo de folga pedido por ele'] : []), ...reasons(m, rules)],
    }],
  }
}

// Two mirrored requests granted together (pairSwaps): shifts — each to the other's shift and, in the
// same pattern, the other's group, so neither shift's groups change; groups — each to the other's.
function suggestSwap(input: ConsoleInput, rules: RebalanceRules, requestId: string, pairId: string): ConsoleSuggestion {
  const r = input.requests.find(x => x.id === requestId)
  const kind = r?.kind === 'REST_GROUP' ? 'groups' : 'shifts'
  if (!r || pairSwaps(input).get(requestId) !== pairId) return empty(kind, 'Troca casada', 'Os pedidos não formam mais uma troca — atualize o Painel')
  const q = input.requests.find(x => x.id === pairId)!
  const a = input.crew.find(x => x.id === r.crewMemberId)!, b = input.crew.find(x => x.id === q.crewMemberId)!
  const shiftOf = (m: ConsoleCrew) => input.shifts.find(s => s.id === m.shiftId)!
  const why = (x: typeof r, other: ConsoleCrew) => [`Troca casada com ${other.code} ${other.name}`, `Pedido na fila desde ${fmtDay(x.createdAt.slice(0, 10))}`, ...reasons(other === b ? a : b, rules)]
  const title = `Troca casada · ${a.code} ${a.name} ⇄ ${b.code} ${b.name}`

  if (kind === 'groups') {
    const p = a.pattern!
    const move = (m: ConsoleCrew, x: typeof r, other: ConsoleCrew): ConsoleMove => ({
      crewMemberId: m.id, code: m.code, name: m.name, from: m.shiftId!, to: m.shiftId!, offset: x.restOffset, patternId: null,
      groupLabel: groupLabel(p, x.restOffset!, input.today), patternName: p.name, groupOptions: groupOptions(p, input.today),
      change: `${groupLabel(p, m.offset, input.today)} → ${groupLabel(p, x.restOffset!, input.today)}`, reasons: why(x, other),
    })
    return { kind, title, summary: `${r.change} · ${q.change}`, moves: [move(a, r, b), move(b, q, a)], bench: {}, excluded: [], patterns: input.patterns.map(x => ({ id: x.id, name: x.name, groupOptions: groupOptions(x, input.today) })) }
  }

  const move = (m: ConsoleCrew, other: ConsoleCrew, x: typeof r): ConsoleMove => {
    const from = shiftOf(m), to = shiftOf(other)
    const p = m.ownPattern ? m.pattern : to.pattern
    // the other's group when it is the same pattern — the destination's groups stay as they were
    const offset = queuedGroup(input, m.id, p) ?? (p && other.pattern?.id === p.id ? other.offset : bestOffset(input, input.crew.filter(y => inSupply(y) && y.shiftId === to.id && y.id !== other.id), to, p))
    return {
      crewMemberId: m.id, code: m.code, name: m.name, from: from.id, to: to.id, offset,
      groupLabel: p && offset != null ? groupLabel(p, offset, input.today) : null, patternName: p?.name ?? null,
      groupOptions: groupOptions(p, input.today), change: `${from.name} → ${to.name}`, reasons: why(x, other),
    }
  }
  return { kind, title, summary: `${shiftOf(a).name} ⇄ ${shiftOf(b).name}`, moves: [move(a, b, r), move(b, a, q)], bench: {}, excluded: [] }
}

// ── impact ──────────────────────────────────────────────────────────────────

// longest run of days worked across the change, from 2 weeks before to 2 weeks after `effective`
function transitionRun(before: ConsoleCrew, after: ConsoleCrew, effective: Day): number {
  let best = 0, run = 0
  for (let i = -14; i < 14; i++) {
    const day = addDays(effective, i)
    run = works(i < 0 ? before : after, day) ? run + 1 : 0
    if (i >= 0) best = Math.max(best, run)
  }
  return best
}

// what the moves do to the planning — `generated`: generated days on/after the effective date
export function impact(input: ConsoleInput, kind: ConsoleActionKind, items: MoveItem[], effective: Day, generated: number): ConsoleImpact {
  const before = staffing(input)
  const next = applyMoves(input, kind, items)
  const after = staffing(next)
  const typeName = new Map(input.dayTypes.map(t => [t.id, t.name]))
  const shiftName = new Map(input.shifts.map(s => [s.id, s.name]))
  const warnings: string[] = [], notes: string[] = []

  if (kind === 'shifts' || kind === 'groups') {
    for (const i of items) {
      const was = input.crew.find(m => m.id === i.crewMemberId)!
      const now = next.crew.find(m => m.id === i.crewMemberId)!
      if (kind === 'shifts' && i.to !== was.shiftId) {
        for (const d of input.duties.filter(x => x.preferred.includes(was.id) && x.shiftId === was.shiftId && x.label)) {
          warnings.push(`${d.label} (${typeName.get(d.dayTypeId)}) perde ${was.code} ${was.name} como operador preferido`)
        }
      }
      if (was.pattern?.id !== now.pattern?.id || was.offset !== now.offset) {
        const run = transitionRun(was, now, kind === 'groups' ? input.today : effective)
        if (run > 6) warnings.push(`${was.code} ${was.name}: ${run} dias seguidos de trabalho na troca de grupo`)
      }
    }
  }
  if (kind === 'lines' || kind === 'priority') {
    const rows = lineRows(next)
    for (const id of new Set(items.flatMap(i => (i.lineId ? [`${i.to}|${i.lineId}`] : [])))) {
      const [shiftId, lineId] = id.split('|')
      const b = lineRows(input).find(l => l.shiftId === shiftId && l.lineId === lineId)
      const a = rows.find(l => l.shiftId === shiftId && l.lineId === lineId)
      if (!b || !a) continue
      notes.push(kind === 'lines'
        ? `Linha ${a.lineCode} · ${shiftName.get(shiftId)}: habilitados ${b.enabled} → ${a.enabled} (necessário ${a.need})`
        : `Linha ${a.lineCode} · ${shiftName.get(shiftId)}: com vínculo ${b.bonded} → ${a.bonded} (necessário ${a.need})`)
    }
    notes.push(kind === 'lines' ? 'Vale já para a próxima geração de escala' : 'A linha prioritária pesa antes das preferências do operador na próxima geração')
  }
  if (kind === 'groups') notes.push('O grupo de folga novo vale para a próxima geração de escala — os dias já gerados ficam como estão')
  if (kind === 'shifts' && items.some(i => { const m = input.crew.find(x => x.id === i.crewMemberId)!; return i.offset != null && i.offset !== m.offset }) && effective > input.today) {
    notes.push(`O grupo de folga novo vale para a próxima geração de escala, mesmo antes de ${fmtDay(effective)}`)
  }
  if (kind === 'profiles') notes.push(`Os perfis começam no turno em ${fmtDay(effective)}; linhas e demais dados ficam para o cadastro do operador`)
  if (generated > 0 && (kind === 'shifts' || kind === 'groups')) {
    notes.push(`${generated} dia(s) já gerado(s)${kind === 'shifts' ? ` a partir de ${fmtDay(effective)}` : ''} seguem com o quadro antigo — gere de novo na Escala para aplicar`)
  }

  return {
    rows: after.rows.map(r => {
      const b = before.rows.find(x => x.shiftId === r.shiftId)!
      return { shiftId: r.shiftId, cells: Object.fromEntries(Object.entries(r.cells).map(([t, c]) => [t, { before: b.cells[t]?.balance ?? 0, after: c.balance }])) }
    }),
    totals: Object.fromEntries(Object.entries(after.totals).map(([t, x]) => [t, { before: before.totals[t]?.coverable ?? 0, after: x.coverable, demand: x.demand }])),
    warnings, notes,
  }
}
