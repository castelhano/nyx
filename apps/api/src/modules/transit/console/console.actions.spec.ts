import { describe, expect, it } from 'vitest'
import { rosterSettingsSchema, type RebalanceRules } from '@nyx/schemas'
import { impact, suggestGroups, suggestLine, suggestProfiles, suggestShifts } from './console.actions'
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
    window: s, notBefore: null, notAfter: null, pattern: sixOne, ownPattern: false, offset: ((6 - (i % 7)) % 7 + 7) % 7,
    lineAccess: {}, prefLines: [], priorityLines: [], blockedVehicleTypes: [], standbyBlocked: false, rosterable: true, away: null, vacation: null,
    ...over(i),
  }))
const dutiesOf = (s: typeof MAN, n: number): ConsoleDuty[] => ['UTIL', 'SAB', 'DOM'].flatMap(t => Array.from({ length: n }, (_, i) => ({
  id: `${s.id}-${t}-${i}`, dayTypeId: t, shiftId: s.id, kind: 'STRAIGHT', start: s.id === 'MAN' ? 300 : 800, end: s.id === 'MAN' ? 780 : 1300, paid: 420,
  lineMinutes: [{ lineId: 'L1', minutes: 300 }], vehicleTypes: ['STANDARD'], standby: false, label: `D${i + 1}`, preferred: [],
})))

const input = (crew: ConsoleCrew[], duties: ConsoleDuty[]): ConsoleInput => ({
  scopeId: 's', branchId: 'b', role: 'DRIVER', today: START, scopes: [{ id: 's', name: 'Escopo' }],
  days: Array.from({ length: 14 }, (_, i) => ({ day: addDays(START, i), weekday: i % 7, dayTypeId: typeOf(i % 7) })),
  dayTypes: [{ id: 'UTIL', code: 'U', name: 'Útil' }, { id: 'SAB', code: 'S', name: 'Sábado' }, { id: 'DOM', code: 'D', name: 'Domingo' }],
  shifts: [MAN, TAR], plans: [], duties, crew, patterns: [sixOne], lines: [{ id: 'L1', code: '101' }],
  lineAccessMode: 'BLACKLIST', ruleModes: settings.ruleModes, noProfile: [], fixedCar: [], dailyErrors: [],
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

describe('linhas', () => {
  it('enables the line for the crew of the short shift, those who prefer it first', () => {
    const enabled: ConsoleCrew['lineAccess'] = { L1: 'ENABLED' }
    const crew = crewOf(7, MAN, i => ({ lineAccess: i < 2 ? enabled : {}, prefLines: i === 5 ? ['L1'] : [] }))
    const inp: ConsoleInput = { ...input(crew, dutiesOf(MAN, 4)), lineAccessMode: 'WHITELIST' }
    const s = suggestLine(inp, rules, 'lines', 'MAN', 'L1')
    // need 5 (4 × 7/6), 2 enabled → 3
    expect(s.moves).toHaveLength(3)
    expect(s.moves[0].crewMemberId).toBe('MAN5')
    const imp = impact(inp, 'lines', s.moves.map(m => ({ crewMemberId: m.crewMemberId, to: m.to, offset: null, lineId: 'L1' })), START, 0)
    expect(imp.notes[0]).toMatch(/habilitados 2 → 5/)
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
})
