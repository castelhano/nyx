import { describe, expect, it } from 'vitest'
import { rosterSettingsSchema, type RebalanceRules } from '@nyx/schemas'
import { changeRequestRows, impact, suggestGroups, suggestLine, suggestProfiles, suggestRequest, suggestShifts } from './console.actions'
import type { ConsoleCrew, ConsoleDuty, ConsoleInput } from './console.calc'

const settings = rosterSettingsSchema.parse({})
const START = '2026-10-05' // a Monday
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const typeOf = (w: number) => (w < 5 ? 'UTIL' : w === 5 ? 'SAB' : 'DOM')
const sixOne = { id: 'p6', name: '6x1', cycle: { pattern: 'TTTTTTF', anchorDate: START, offOnHolidays: false }, staggered: true }
const shift = (id: string, startFloor: number, startCeiling: number, endFloor: number, endCeiling: number) => ({
  id, code: id, name: id, priority: 0, allowSplit: false, pattern: sixOne,
  startFloor, startIdealMin: startFloor, startIdealMax: startCeiling, startCeiling,
  endFloor, endIdealMin: endFloor, endIdealMax: endCeiling, endCeiling,
})
const MAN = shift('MAN', 240, 480, 600, 960)
const TAR = shift('TAR', 720, 900, 1260, 1500)

const crewOf = (n: number, s: typeof MAN, over: (i: number) => Partial<ConsoleCrew> = () => ({})): ConsoleCrew[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${s.id}${i}`, code: `${s.id}${String(i).padStart(2, '0')}`, name: `${s.id} ${i}`, hireDate: '2020-01-01', shiftId: s.id, shiftSince: '2025-01-01',
    window: s, notBefore: null, notAfter: null, journey: 420, pattern: sixOne, ownPattern: false, offset: ((6 - (i % 7)) % 7 + 7) % 7,
    lineAccess: {}, prefLines: [], priorityLines: [], blockedVehicleTypes: [], standbyBlocked: false, rosterable: true, away: null, vacation: null,
    ...over(i),
  }))
const dutiesOf = (s: typeof MAN, n: number): ConsoleDuty[] => ['UTIL', 'SAB', 'DOM'].flatMap(t => Array.from({ length: n }, (_, i) => ({
  id: `${s.id}-${t}-${i}`, dayTypeId: t, shiftId: s.id, kind: 'STRAIGHT', start: s.id === 'MAN' ? 300 : 800, end: s.id === 'MAN' ? 780 : 1300, paid: 420, overtime: 0,
  lineMinutes: [{ lineId: 'L1', minutes: 300 }], vehicleTypes: ['STANDARD'], standby: false, label: `D${i + 1}`, preferred: [],
})))

const input = (crew: ConsoleCrew[], duties: ConsoleDuty[]): ConsoleInput => ({
  scopeId: 's', branchId: 'b', role: 'DRIVER', today: START, scopes: [{ id: 's', name: 'Escopo' }],
  days: Array.from({ length: 14 }, (_, i) => ({ day: addDays(START, i), weekday: i % 7, dayTypeId: typeOf(i % 7) })),
  dayTypes: [{ id: 'UTIL', code: 'U', name: 'Útil' }, { id: 'SAB', code: 'S', name: 'Sábado' }, { id: 'DOM', code: 'D', name: 'Domingo' }],
  shifts: [MAN, TAR], plans: [], duties, crew, patterns: [sixOne], lines: [{ id: 'L1', code: '101' }],
  lineAccessMode: 'BLACKLIST', lineMarginPct: 20, ruleModes: settings.ruleModes, restFloor: 660, bankCompPct: 100, noProfile: [], fixedCar: [], dailyErrors: [], requests: [],
})
const rules: RebalanceRules = { criteria: [{ key: 'shiftTenure', active: true }, { key: 'hireDate', active: true }] }

describe('balancear turnos', () => {
  // MAN: 7 crew for 8 duties a day (short); TAR: 14 crew for 6 (spare)
  const base = () => input([...crewOf(7, MAN), ...crewOf(14, TAR, i => ({ shiftSince: `2025-${String(i + 1).padStart(2, '0')}-01`.replace('2025-13', '2026-01').replace('2025-14', '2026-02') }))], [...dutiesOf(MAN, 8), ...dutiesOf(TAR, 6)])

  it('moves crew from the shift with spare people to the short one, the latest to arrive first', () => {
    const s = suggestShifts(base(), rules)
    expect(s.moves.length).toBeGreaterThan(0)
    expect(s.moves.every(m => m.from === 'TAR' && m.to === 'MAN')).toBe(true)
    // the most recent in TAR (shiftSince 2026-02, 2026-01…) go first
    expect(s.moves[0].code).toBe('TAR13')
    expect(s.moves[0].reasons[0]).toMatch(/No turno desde 02\/2026/)
  })

  it('leaves out who does not fit the destination window', () => {
    const inp = base()
    inp.crew = inp.crew.map(m => (m.id === 'TAR13' ? { ...m, notBefore: 600 } : m))
    const s = suggestShifts(inp, rules)
    expect(s.moves.some(m => m.crewMemberId === 'TAR13')).toBe(false)
    expect(s.excluded.find(e => e.crewMemberId === 'TAR13')?.reason).toMatch(/Não inicia antes de 10:00/)
  })

  it('the impact shows the short shift improving', () => {
    const inp = base()
    const s = suggestShifts(inp, rules)
    const imp = impact(inp, 'shifts', s.moves.map(m => ({ crewMemberId: m.crewMemberId, to: m.to, offset: m.offset })), addDays(START, 7), 3)
    const man = imp.rows.find(r => r.shiftId === 'MAN')!
    expect(man.cells.UTIL.after).toBeGreaterThan(man.cells.UTIL.before)
    expect(imp.notes.some(n => n.includes('3 dia(s) já gerado(s)'))).toBe(true)
  })

  it('warns about a long run of days worked when the group changes', () => {
    const inp = base()
    // MAN6 is off on Sunday (offset 0); off on Monday from Tuesday the 13th: works Mon 12 … Sun 18 = 7
    const m = inp.crew.find(x => x.id === 'MAN6')!
    const imp = impact(inp, 'shifts', [{ crewMemberId: m.id, to: 'MAN', offset: 6 }], addDays(START, 8), 0)
    expect(imp.warnings.some(w => /dias seguidos/.test(w))).toBe(true)
  })
})

describe('grupos de folga por demanda', () => {
  it('moves crew out of the overfull group toward the weekday with fewer duties', () => {
    // 7 crew all off on Monday; few duties on Sunday — some days off should move to Sunday
    const inp = input(crewOf(7, MAN, () => ({ offset: 6 })), dutiesOf(MAN, 6).filter(d => d.dayTypeId !== 'DOM' || d.id.endsWith('-0')))
    const s = suggestGroups(inp, rules, 'MAN')
    expect(s.moves.length).toBeGreaterThan(0)
    // one stays on Monday (the fewest move), most go to Sunday
    expect(s.moves).toHaveLength(6)
    expect(s.moves.every(m => m.from === 'MAN' && m.to === 'MAN')).toBe(true)
    expect(s.moves.filter(m => m.offset === 0).length).toBeGreaterThanOrEqual(5)
    expect(s.patterns?.map(p => p.id)).toEqual(['p6'])
    const imp = impact(inp, 'groups', s.moves.map(m => ({ crewMemberId: m.crewMemberId, to: m.to, offset: m.offset })), START, 0)
    expect(imp.rows.find(r => r.shiftId === 'MAN')!.cells.UTIL.after).toBeGreaterThan(imp.rows.find(r => r.shiftId === 'MAN')!.cells.UTIL.before)
  })
})

describe('grupos de folga × linhas vinculadas', () => {
  // all off on Monday; one stays there (see above) — the two bonded to L1 are the oldest in the shift
  const inp = () => input(
    crewOf(7, MAN, i => ({ offset: 6, prefLines: i < 2 ? ['L1'] : [], shiftSince: i < 2 ? '2020-01-01' : `2025-0${i}-01` })),
    dutiesOf(MAN, 6).filter(d => d.dayTypeId !== 'DOM' || d.id.endsWith('-0')),
  )
  const stays = (s: ReturnType<typeof suggestGroups>) => ['MAN0', 'MAN1', 'MAN2', 'MAN3', 'MAN4', 'MAN5', 'MAN6'].filter(id => !s.moves.some(m => m.crewMemberId === id))

  it('moves first who has his lines concentrated in the group', () => {
    const s = suggestGroups(inp(), { criteria: [{ key: 'lineSpread', active: true }, ...rules.criteria] }, 'MAN')
    expect(stays(s)).toHaveLength(1)
    expect(['MAN0', 'MAN1']).not.toContain(stays(s)[0])
    expect(s.moves.find(m => m.crewMemberId === 'MAN0')!.reasons[0]).toMatch(/Linha 101: 2 no grupo/)
  })
  it('without it, the selection rule alone: the oldest in the shift stay', () => {
    const s = suggestGroups(inp(), { criteria: [{ key: 'lineSpread', active: false }, ...rules.criteria] }, 'MAN')
    expect(['MAN0', 'MAN1']).toContain(stays(s)[0])
  })
})

describe('linhas', () => {
  it('enables the line for the crew of the short shift, those who prefer it first', () => {
    const enabled: ConsoleCrew['lineAccess'] = { L1: 'ENABLED' }
    const crew = crewOf(7, MAN, i => ({ lineAccess: i < 2 ? enabled : {}, prefLines: i === 5 ? ['L1'] : [] }))
    const inp: ConsoleInput = { ...input(crew, dutiesOf(MAN, 4)), lineAccessMode: 'WHITELIST' }
    const s = suggestLine(inp, rules, 'lines', 'MAN', 'L1')
    // need 5 (4 × 7/6), margin 6 (+20%), 2 enabled → 4
    expect(s.moves).toHaveLength(4)
    expect(s.moves[0].crewMemberId).toBe('MAN5')
    const imp = impact(inp, 'lines', s.moves.map(m => ({ crewMemberId: m.crewMemberId, to: m.to, offset: null, lineId: 'L1' })), START, 0)
    expect(imp.notes[0]).toMatch(/habilitados 2 → 6/)
  })
  it('suggests priority lines up to the need, among who already operates it', () => {
    const inp = input(crewOf(7, MAN), dutiesOf(MAN, 4))
    const s = suggestLine(inp, rules, 'priority', 'MAN', 'L1')
    expect(s.moves).toHaveLength(5)
  })
})

describe('perfis', () => {
  it('puts each employee without a profile in the shortest shift', () => {
    const inp = { ...input([...crewOf(7, MAN), ...crewOf(14, TAR)], [...dutiesOf(MAN, 8), ...dutiesOf(TAR, 6)]),
      noProfile: [{ employeeId: 'e1', code: '9001', name: 'Novo', jobTitle: 'Motorista', role: 'DRIVER', hireDate: '2026-09-01' }] }
    const s = suggestProfiles(inp, rules)
    expect(s.moves).toHaveLength(1)
    expect(s.moves[0].to).toBe('MAN')
    const imp = impact(inp, 'profiles', [{ crewMemberId: 'e1', to: 'MAN', offset: s.moves[0].offset }], addDays(START, 3), 0)
    expect(imp.totals.UTIL.after).toBeGreaterThanOrEqual(imp.totals.UTIL.before)
  })

  const newcomers = (n: number) => Array.from({ length: n }, (_, i) => ({ employeeId: `e${i}`, code: `9${String(i).padStart(3, '0')}`, name: `Novo ${i}`, jobTitle: 'Motorista', role: 'DRIVER', hireDate: '2026-09-01' }))

  it('covers the shortage first, then spreads the rest by the duties — never to a shift without duties', () => {
    const NOD = shift('NOD', 600, 700, 1200, 1300)
    const inp = { ...input([...crewOf(7, MAN), ...crewOf(14, TAR)], [...dutiesOf(MAN, 8), ...dutiesOf(TAR, 6)]), noProfile: newcomers(30) }
    inp.shifts = [...inp.shifts, NOD]
    const s = suggestProfiles(inp, rules)
    const to = (id: string) => s.moves.filter(m => m.to === id).length
    expect(to('NOD')).toBe(0)
    // MAN short (7 crew for 8 duties a day): fills first, and keeps more of the rest (more duties)
    expect(s.moves.slice(0, 3).every(m => m.to === 'MAN')).toBe(true)
    expect(to('MAN')).toBeGreaterThan(to('TAR'))
    expect(to('TAR')).toBeGreaterThan(0)
  })

  it('spreads the newcomers over the groups instead of stacking them in one', () => {
    const inp = { ...input(crewOf(7, MAN), dutiesOf(MAN, 6)), noProfile: newcomers(14) }
    const s = suggestProfiles(inp, rules)
    const perGroup = new Map<number, number>()
    for (const m of s.moves) perGroup.set(m.offset!, (perGroup.get(m.offset!) ?? 0) + 1)
    expect(Math.max(...perGroup.values()) - Math.min(...perGroup.values())).toBeLessThanOrEqual(1)
    expect(perGroup.size).toBe(7)
  })

  it('without duties suggests no shift — the list picks it', () => {
    const inp = { ...input(crewOf(7, MAN), []), noProfile: newcomers(3) }
    const s = suggestProfiles(inp, rules)
    expect(s.moves.every(m => m.to === '' && m.shiftOptions?.length === 2)).toBe(true)
    expect(s.summary).toMatch(/escolha na lista/)
  })

  it('offers each shift with its suggested group, and takes a pattern of his own', () => {
    const fiveTwo = { id: 'p5', name: '5x2', cycle: { pattern: 'TTTTTFF', anchorDate: START, offOnHolidays: false }, staggered: true }
    const inp = { ...input([...crewOf(7, MAN), ...crewOf(14, TAR)], [...dutiesOf(MAN, 8), ...dutiesOf(TAR, 6)]),
      patterns: [sixOne, fiveTwo],
      noProfile: [{ employeeId: 'e1', code: '9001', name: 'Novo', jobTitle: 'Motorista', role: 'DRIVER', hireDate: '2026-09-01' }] }
    const s = suggestProfiles(inp, rules)
    expect(s.moves[0].shiftOptions?.map(o => o.shiftId)).toEqual(['MAN', 'TAR'])
    expect(s.moves[0].shiftOptions?.every(o => o.patternId === 'p6' && o.offset != null)).toBe(true)
    expect(s.patterns?.map(p => p.id)).toEqual(['p6', 'p5'])
    // in TAR with 5x2: works 5 of 7 days — the impact counts him with his own pattern
    const imp = impact(inp, 'profiles', [{ crewMemberId: 'e1', to: 'TAR', offset: 0, patternId: 'p5' }], START, 0)
    const tar = imp.rows.find(r => r.shiftId === 'TAR')!
    expect(tar.cells.SAB.after).toBe(tar.cells.SAB.before)
    expect(tar.cells.UTIL.after).toBe(tar.cells.UTIL.before + 1)
  })
})

describe('pedidos de troca', () => {
  const ask = (crewMemberId: string, over: Partial<ConsoleInput['requests'][number]>): ConsoleInput['requests'][number] => ({
    id: `r-${crewMemberId}-${over.kind ?? 'SHIFT'}`, kind: 'SHIFT', status: 'QUEUED', crewMemberId, change: '', notes: null,
    createdAt: '2026-09-01T12:00:00.000Z', shiftId: null, restPatternId: null, restOffset: null, ...over,
  })
  // MAN short (7 for 8), TAR spare (14 for 6)
  const short = () => input([...crewOf(7, MAN), ...crewOf(14, TAR)], [...dutiesOf(MAN, 8), ...dutiesOf(TAR, 6)])

  it('a shift asked with a place and his own with a surplus is ready; the queue goes oldest first', () => {
    const inp = short()
    inp.requests = [
      ask('TAR3', { shiftId: 'MAN', createdAt: '2026-08-01T12:00:00.000Z' }),
      ask('TAR5', { shiftId: 'MAN' }),
    ]
    const rows = changeRequestRows(inp)
    expect(rows.map(r => [r.code, r.position, r.ready])).toEqual([['TAR03', 1, true], ['TAR05', 2, true]])
    expect(rows[0].reason).toBe('MAN com vaga')
  })

  it('waits while the shift asked has no place, or his own has no surplus', () => {
    const inp = short()
    inp.requests = [ask('MAN2', { shiftId: 'TAR' })]
    expect(changeRequestRows(inp)[0]).toMatchObject({ ready: false, reason: 'TAR sem vaga' })
    // both short: MAN has a place, TAR none to give
    const tight = input([...crewOf(7, MAN), ...crewOf(7, TAR)], [...dutiesOf(MAN, 8), ...dutiesOf(TAR, 8)])
    tight.requests = [ask('TAR1', { shiftId: 'MAN' })]
    expect(changeRequestRows(tight)[0]).toMatchObject({ ready: false, reason: 'MAN com vaga · TAR sem sobra' })
  })

  it('granting a shift request moves him alone, into the group he asked for when he has one open', () => {
    const inp = short()
    inp.requests = [ask('TAR3', { shiftId: 'MAN' }), ask('TAR3', { kind: 'REST_GROUP', restPatternId: 'p6', restOffset: 2 })]
    const s = suggestRequest(inp, rules, 'r-TAR3-SHIFT')
    expect(s.kind).toBe('shifts')
    expect(s.moves).toHaveLength(1)
    expect(s.moves[0]).toMatchObject({ crewMemberId: 'TAR3', from: 'TAR', to: 'MAN', offset: 2 })
    expect(s.moves[0].reasons).toContain('Grupo de folga pedido por ele')
  })

  it('granting a rest group request keeps his shift', () => {
    const inp = short()
    inp.requests = [ask('MAN1', { kind: 'REST_GROUP', restPatternId: 'p6', restOffset: 3 })]
    const s = suggestRequest(inp, rules, 'r-MAN1-REST_GROUP')
    expect(s.kind).toBe('groups')
    expect(s.moves[0]).toMatchObject({ from: 'MAN', to: 'MAN', offset: 3 })
  })

  // TAR: 14 crew, 6 of them off on Sunday (A), for fewer duties on Sunday
  const mix = (sh: typeof MAN, n: Record<string, number>) => Object.entries(n).flatMap(([t, k]) => dutiesOf(sh, k).filter(d => d.dayTypeId === t))
  const uneven = (tar: Record<string, number>) => input(
    [...crewOf(7, MAN), ...crewOf(14, TAR, i => ({ offset: [0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 1, 2][i], shiftSince: `2025-${String(i % 12 + 1).padStart(2, '0')}-01` }))],
    [...dutiesOf(MAN, 7), ...mix(TAR, tar)],
  )

  it('balancing takes the queued first, even when the selection rule would pick someone else', () => {
    const inp = uneven({ UTIL: 11, SAB: 11, DOM: 5 })
    expect(suggestShifts(inp, rules).moves[0].crewMemberId).not.toBe('TAR0')
    inp.requests = [ask('TAR0', { shiftId: 'MAN' })]
    const s = suggestShifts(inp, rules)
    expect(s.moves[0]).toMatchObject({ crewMemberId: 'TAR0', from: 'TAR', to: 'MAN' })
    expect(s.moves[0].reasons[0]).toMatch(/Pedido na fila desde 01\/09/)
  })

  it('a request only REQUESTED (not reviewed) has no priority', () => {
    const inp = uneven({ UTIL: 11, SAB: 11, DOM: 5 })
    inp.requests = [ask('TAR0', { shiftId: 'MAN', status: 'REQUESTED' })]
    expect(suggestShifts(inp, rules).moves[0].crewMemberId).not.toBe('TAR0')
  })

  it('the group he leaves short is refilled in the same suggestion, without touching him', () => {
    const inp = uneven({ UTIL: 11, SAB: 11, DOM: 5 })
    inp.requests = [ask('TAR0', { shiftId: 'MAN' })]
    const s = suggestShifts(inp, rules)
    const fix = s.moves.filter(m => m.from === m.to)
    expect(fix).toHaveLength(1)
    expect(fix[0]).toMatchObject({ from: 'TAR', offset: 0 })
    expect(fix[0].crewMemberId).not.toBe('TAR0')
    expect(fix[0].reasons[0]).toBe('Acerto de grupo da troca de turno')
    expect(s.summary).toMatch(/1 acerto\(s\) de grupo/)
  })

  it('the refill takes whoever queued for that group first', () => {
    const inp = uneven({ UTIL: 11, SAB: 11, DOM: 5 })
    const plain = suggestShifts({ ...inp, requests: [ask('TAR0', { shiftId: 'MAN' })] }, rules).moves.find(m => m.from === m.to)!
    // TAR7 and TAR13 share the overfull group C
    const other = plain.crewMemberId === 'TAR7' ? 'TAR13' : 'TAR7'
    inp.requests = [ask('TAR0', { shiftId: 'MAN' }), ask(other, { kind: 'REST_GROUP', restPatternId: 'p6', restOffset: 0 })]
    const fix = suggestShifts(inp, rules).moves.filter(m => m.from === m.to)
    expect(fix[0]).toMatchObject({ crewMemberId: other, offset: 0 })
  })

  it('the rest groups suggestion takes the queued for an open group first', () => {
    const inp = uneven({ UTIL: 11, SAB: 11, DOM: 5 })
    const plain = suggestGroups(inp, rules, 'TAR').moves
    expect(plain).toHaveLength(1)
    const other = plain[0].crewMemberId === 'TAR7' ? 'TAR13' : 'TAR7'
    inp.requests = [ask(other, { kind: 'REST_GROUP', restPatternId: 'p6', restOffset: 0 })]
    const s = suggestGroups(inp, rules, 'TAR')
    expect(s.moves[0]).toMatchObject({ crewMemberId: other, offset: 0 })
    expect(s.moves[0].reasons[0]).toMatch(/Pedido na fila/)
  })

  it('two mirrored shift requests pair up with no place needed, and swap shifts and groups', () => {
    // both shifts short: no place either way
    const tight = input([...crewOf(7, MAN), ...crewOf(7, TAR)], [...dutiesOf(MAN, 8), ...dutiesOf(TAR, 8)])
    tight.requests = [ask('MAN2', { shiftId: 'TAR', createdAt: '2026-08-01T00:00:00.000Z' }), ask('TAR5', { shiftId: 'MAN' })]
    const rows = changeRequestRows(tight)
    expect(rows.map(r => [r.code, r.ready, r.swapWith?.code])).toEqual([['MAN02', true, 'TAR05'], ['TAR05', true, 'MAN02']])
    expect(rows[0].reason).toBe('Troca casada com TAR05 TAR 5')
    const s = suggestRequest(tight, rules, rows[0].id, rows[0].swapWith!.requestId)
    const man2 = tight.crew.find(m => m.id === 'MAN2')!, tar5 = tight.crew.find(m => m.id === 'TAR5')!
    expect(s.moves).toEqual([
      expect.objectContaining({ crewMemberId: 'MAN2', from: 'MAN', to: 'TAR', offset: tar5.offset }),
      expect.objectContaining({ crewMemberId: 'TAR5', from: 'TAR', to: 'MAN', offset: man2.offset }),
    ])
  })

  it('no pair when one of them does not fit the other shift, or only one is queued', () => {
    const tight = input([...crewOf(7, MAN), ...crewOf(7, TAR, i => (i === 5 ? { notBefore: 600 } : {}))], [...dutiesOf(MAN, 8), ...dutiesOf(TAR, 8)])
    tight.requests = [ask('MAN2', { shiftId: 'TAR' }), ask('TAR5', { shiftId: 'MAN' })]
    expect(changeRequestRows(tight).every(r => !r.swapWith)).toBe(true)
    tight.crew = tight.crew.map(m => ({ ...m, notBefore: null }))
    tight.requests = [ask('MAN2', { shiftId: 'TAR' }), ask('TAR5', { shiftId: 'MAN', status: 'REQUESTED' })]
    expect(changeRequestRows(tight).every(r => !r.swapWith)).toBe(true)
  })

  it('two in the same shift asking for each other\'s group swap groups', () => {
    const inp = short()
    const a = inp.crew.find(m => m.id === 'MAN1')!, b = inp.crew.find(m => m.id === 'MAN4')!
    inp.requests = [ask('MAN1', { kind: 'REST_GROUP', restPatternId: 'p6', restOffset: b.offset }), ask('MAN4', { kind: 'REST_GROUP', restPatternId: 'p6', restOffset: a.offset })]
    const rows = changeRequestRows(inp)
    expect(rows[0].swapWith?.code).toBe('MAN04')
    const s = suggestRequest(inp, rules, rows[0].id, rows[0].swapWith!.requestId)
    expect(s.kind).toBe('groups')
    expect(s.moves.map(m => [m.crewMemberId, m.offset])).toEqual([['MAN1', b.offset], ['MAN4', a.offset]])
  })
})
