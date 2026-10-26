import {
  nextRestDay, restGroupIndex, restGroupLabel, restGroupOffsets, restPatternWorks,
  type ConsoleActionKind, type ConsoleImpact, type ConsoleMove, type ConsoleSuggestion, type RebalanceRules,
} from '@nyx/schemas'
import { effectiveWindow } from '../daily/daily-checks'
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

// the crew member as he'd be: in the destination shift (its window with his bounds), with his own
// pattern, the one set by the adjustment, or the shift's, and the given group
export function moved(m: ConsoleCrew, to: Shift, offset: number | null, pattern?: ConsolePattern | null): ConsoleCrew {
  const own = pattern !== undefined && pattern !== null
  return {
    ...m, shiftId: to.id,
    window: effectiveWindow(to, { notBeforeMinutes: m.notBefore, notAfterMinutes: m.notAfter }, []),
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
    window: null, notBefore: null, notAfter: null, pattern: to.pattern, ownPattern: false, offset: 0,
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
function rank<T extends Pick<ConsoleCrew, 'code' | 'hireDate' | 'shiftSince'>>(list: T[], rules: RebalanceRules): T[] {
  const keys = rules.criteria.filter(c => c.active).map(c => c.key)
  return [...list].sort((a, b) => {
    for (const k of keys) {
      // the most recent first: later dates sort first
      const x = k === 'shiftTenure' ? (b.shiftSince ?? '').localeCompare(a.shiftSince ?? '') : b.hireDate.localeCompare(a.hireDate)
      if (x) return x
    }
    return a.code.localeCompare(b.code, 'pt-BR', { numeric: true })
  })
}

function reasons(m: Pick<ConsoleCrew, 'hireDate' | 'shiftSince'>, rules: RebalanceRules): string[] {
  return rules.criteria.filter(c => c.active).map(c => (c.key === 'shiftTenure'
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
  const toMove = (m: ConsoleCrew, from: Shift, to: Shift, offset: number | null): ConsoleMove => {
    const p = m.ownPattern ? m.pattern : to.pattern
    return {
      crewMemberId: m.id, code: m.code, name: m.name, from: from.id, to: to.id, offset,
      groupLabel: p && offset != null ? groupLabel(p, offset, input.today) : null, patternName: p?.name ?? null,
      groupOptions: groupOptions(p, input.today), change: `${from.name} → ${to.name}`, reasons: reasons(m, rules),
    }
  }

  const balance = shiftBalances(input, crew)
  const short = input.shifts.filter(s => worstOf(balance, s.id) < 0).sort((a, b) => worstOf(balance, a.id) - worstOf(balance, b.id))
  for (const target of short) {
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
        const team = crew.filter(x => inSupply(x) && x.shiftId === target.id)
        const offset = bestOffset(input, team, target, m.ownPattern ? m.pattern : target.pattern)
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

  // never trade coverage: drop the last moves while the crew can cover fewer duties than before
  const before = staffing(input).totals
  while (moves.length) {
    const after = staffing(applyMoves(input, 'shifts', moves.map(m => ({ crewMemberId: m.crewMemberId, to: m.to, offset: m.offset })))).totals
    if (Object.entries(before).every(([t, x]) => (after[t]?.coverable ?? 0) >= x.coverable)) break
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
    summary: summary || (short.length ? 'Nenhum operador elegível nos turnos com sobra' : 'Turnos equilibrados'),
    moves, bench, excluded: [...excluded.values()],
  }
}

// ── rest groups by demand ───────────────────────────────────────────────────

// Within a shift, each pattern's crew spread over its groups as the demand asks (idealGroupCounts):
// the overfull groups give the ones the rule picks (and anyone between groups) to the short groups.
// Every row may also switch to another pattern.
export function suggestGroups(input: ConsoleInput, rules: RebalanceRules, shiftId: string): ConsoleSuggestion {
  const shift = input.shifts.find(s => s.id === shiftId)
  if (!shift) return empty('groups', 'Grupos de folga', 'Turno não encontrado')
  const team = input.crew.filter(m => inSupply(m) && m.shiftId === shiftId)
  const moves: ConsoleMove[] = [], benchList: ConsoleMove[] = []
  const toMove = (m: ConsoleCrew, offset: number): ConsoleMove => ({
    crewMemberId: m.id, code: m.code, name: m.name, from: shiftId, to: shiftId, offset, patternId: null,
    groupLabel: groupLabel(m.pattern!, offset, input.today), patternName: m.pattern!.name, groupOptions: groupOptions(m.pattern, input.today),
    change: `${groupLabel(m.pattern!, m.offset, input.today)} → ${groupLabel(m.pattern!, offset, input.today)}`, reasons: reasons(m, rules),
  })
  for (const pid of [...new Set(team.flatMap(m => (m.pattern ? [m.pattern.id] : [])))]) {
    const mine = team.filter(m => m.pattern?.id === pid)
    const p = mine[0].pattern!
    const shape = { pattern: p.cycle.pattern, staggered: p.staggered }
    const offsets = restGroupOffsets(shape)
    const ideal = idealGroupCounts(input, team, pid)
    const count = offsets.map((_, g) => mine.filter(m => restGroupIndex(shape, m.offset) === g).length)
    // who leaves: anyone between groups, then the overfull groups' ones by the rule
    const leaving = [
      ...mine.filter(m => restGroupIndex(shape, m.offset) == null),
      ...offsets.flatMap((_, g) => rank(mine.filter(m => restGroupIndex(shape, m.offset) === g), rules).slice(0, Math.max(0, count[g] - ideal[g]))),
    ]
    const gaps = offsets.map((_, g) => Math.max(0, ideal[g] - count[g]))
    for (const m of leaving) {
      const g = gaps.findIndex(n => n > 0)
      if (g < 0) break
      gaps[g]--
      moves.push(toMove(m, offsets[g]))
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
  const need = row ? (kind === 'lines' ? -row.gap : row.need - row.bonded) : 0
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
    summary: need > 0 ? `${n} de ${need} necessário(s) no turno ${shift.name}` : `A linha ${code} já tem o necessário no turno ${shift.name}`,
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
      if (kind === 'shifts') {
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
