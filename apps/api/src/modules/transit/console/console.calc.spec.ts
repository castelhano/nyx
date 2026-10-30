import { describe, expect, it } from 'vitest'
import { rosterSettingsSchema } from '@nyx/schemas'
import { computeConsole, idealGroupCounts, maxRun, type ConsoleCrew, type ConsoleDuty, type ConsoleInput } from './console.calc'

const settings = rosterSettingsSchema.parse({})
// 2026-10-05 is a Monday
const START = '2026-10-05'
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const typeOf = (w: number) => (w < 5 ? 'UTIL' : w === 5 ? 'SAB' : 'DOM')

const window = (n = 14): ConsoleInput['days'] =>
  Array.from({ length: n }, (_, i) => ({ day: addDays(START, i), weekday: i % 7, dayTypeId: typeOf(i % 7) }))

// a weekly 6x1 with the day off on `off` (0 = Monday): anchor on a Monday, offset moves the day off
const sixOne = { id: 'p6', name: '6x1', cycle: { pattern: 'TTTTTTF', anchorDate: START, offOnHolidays: false }, staggered: true }

const shift = (id: string, startFloor: number, startCeiling: number, endFloor: number, endCeiling: number) => ({
  id, code: id, name: id, priority: 0, allowSplit: false,
  startFloor, startIdealMin: startFloor, startIdealMax: startCeiling, startCeiling,
  endFloor, endIdealMin: endFloor, endIdealMax: endCeiling, endCeiling, pattern: sixOne,
})
const MAN = shift('MAN', 240, 480, 600, 960)
const TAR = shift('TAR', 720, 900, 1260, 1500)

const crewOf = (n: number, shiftId: string, over: Partial<ConsoleCrew> = {}, off = (i: number) => i % 7): ConsoleCrew[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${shiftId}${i}`, code: `${shiftId}${i}`, name: `${shiftId} ${i}`, hireDate: '2020-01-01', shiftId, shiftSince: '2025-01-01',
    window: shiftId === 'MAN' ? MAN : TAR, notBefore: null, notAfter: null, journey: 420, pattern: sixOne, ownPattern: false, offset: ((6 - off(i)) % 7 + 7) % 7,
    lineAccess: {}, prefLines: [], priorityLines: [], blockedVehicleTypes: [], standbyBlocked: false, rosterable: true,
    away: null, vacation: null, ...over,
  }))

const dutiesOf = (shiftId: string, counts: Record<string, number>, lineId = 'L1'): ConsoleDuty[] =>
  Object.entries(counts).flatMap(([dayTypeId, n]) => Array.from({ length: n }, (_, i) => ({
    id: `${shiftId}-${dayTypeId}-${i}`, dayTypeId, shiftId, kind: 'STRAIGHT',
    start: shiftId === 'MAN' ? 300 : 800, end: shiftId === 'MAN' ? 780 : 1300, paid: 420, overtime: 0,
    lineMinutes: [{ lineId, minutes: 300 }], vehicleTypes: ['STANDARD'], standby: false, label: `D${i + 1}`, preferred: [],
  })))

const base = (over: Partial<ConsoleInput> = {}): ConsoleInput => ({
  scopeId: 's', branchId: 'b', role: 'DRIVER', today: START, scopes: [{ id: 's', name: 'Escopo' }],
  days: window(),
  dayTypes: [{ id: 'UTIL', code: 'U', name: 'Útil' }, { id: 'SAB', code: 'S', name: 'Sábado' }, { id: 'DOM', code: 'D', name: 'Domingo' }],
  shifts: [MAN, TAR],
  plans: [], duties: [], crew: [], patterns: [sixOne], lines: [{ id: 'L1', code: '101' }, { id: 'L2', code: '102' }],
  lineAccessMode: 'BLACKLIST', lineMarginPct: 20, ruleModes: settings.ruleModes, restFloor: 660, bankCompPct: 100,
  noProfile: [], fixedCar: [], dailyErrors: [], requests: [],
  ...over,
})

describe('rest cycle helpers', () => {
  it('maxRun goes round the cycle', () => {
    expect(maxRun('TTTTTTF')).toBe(6)
    expect(maxRun('TTFTTTTTT')).toBe(8)
    expect(maxRun('TTTT')).toBe(4)
  })
})

describe('demand × crew', () => {
  it('takes the worst day of each day type, not the average', () => {
    // 7 crew, one day off per weekday each: 6 work every day; all off on Monday: Monday has 0
    const even = crewOf(7, 'MAN')
    const st = computeConsole(base({ crew: even, duties: dutiesOf('MAN', { UTIL: 6, SAB: 6, DOM: 6 }) })).staffing
    expect(st.rows[0].cells.UTIL).toMatchObject({ demand: 6, worst: 6, balance: 0 })

    const monday = crewOf(7, 'MAN', {}, () => 0)
    const st2 = computeConsole(base({ crew: monday, duties: dutiesOf('MAN', { UTIL: 6, SAB: 6, DOM: 6 }) })).staffing
    expect(st2.rows[0].cells.UTIL.worst).toBe(0)
    expect(st2.rows[0].cells.UTIL.avg).toBeCloseTo(5.6, 1)
    expect(st2.rows[0].cells.UTIL.balance).toBe(-6)
  })

  it('leaves a long absence out of the supply, never férias', () => {
    const crew = crewOf(7, 'MAN')
    crew[0].away = { reason: 'INSS', until: '2026-12-31' }
    crew[1].vacation = { until: '2026-10-20', cover: null }
    const snap = computeConsole(base({ crew, duties: dutiesOf('MAN', { UTIL: 5 }) }))
    expect(snap.staffing.rows[0].current).toBe(6)
    expect(snap.crew).toMatchObject({ active: 6, away: 1, vacation: 1 })
  })

  it('counts what the crew can cover by fitting the windows (spare morning crew cover nothing in the afternoon)', () => {
    const snap = computeConsole(base({ crew: crewOf(14, 'MAN'), duties: [...dutiesOf('MAN', { UTIL: 4 }), ...dutiesOf('TAR', { UTIL: 4 })] }))
    expect(snap.staffing.totals.UTIL).toEqual({ demand: 8, coverable: 4 })
    // enough people, in the wrong shift: the afternoon gets crew, the morning gives some up
    const add = (id: string) => snap.sizing.groups.filter(g => g.shiftId === id).reduce((n, g) => n + g.add - g.remove, 0)
    expect(add('TAR')).toBeGreaterThan(0)
    expect(add('MAN')).toBeLessThan(0)
  })
})

describe('crew sizing', () => {
  const every = (n: number) => ({ UTIL: n, SAB: n, DOM: n })

  it('7 crew of a 6x1 shift cover 6 duties a day — plus the vacation reserve', () => {
    const z = computeConsole(base({ crew: crewOf(7, 'MAN'), duties: dutiesOf('MAN', every(6)) })).sizing
    expect(z).toMatchObject({ current: 7, operational: 7, vacation: 1, bank: 0, required: 8, balance: -1 })
    expect(z.groups).toEqual([])
  })

  it('adds virtual crew in the groups that are short', () => {
    const z = computeConsole(base({ crew: crewOf(7, 'MAN'), duties: dutiesOf('MAN', every(12)) })).sizing
    expect(z.operational).toBe(14)
    expect(z.groups.reduce((n, g) => n + g.add, 0)).toBe(7)
  })

  it('takes out the crew nothing needs', () => {
    const z = computeConsole(base({ crew: crewOf(14, 'MAN'), duties: dutiesOf('MAN', every(6)) })).sizing
    expect(z.operational).toBe(7)
    expect(z.groups.reduce((n, g) => n + g.remove, 0)).toBe(7)
  })

  it('reports the duties no shift takes apart, without sizing crew for them', () => {
    const odd = { ...dutiesOf('MAN', { UTIL: 1 })[0], id: 'odd', start: 60, end: 400 }
    const z = computeConsole(base({ crew: crewOf(7, 'MAN'), duties: [...dutiesOf('MAN', every(6)), odd] })).sizing
    expect(z.unfit).toEqual({ UTIL: 1 })
    expect(z.operational).toBe(7)
  })

  it('crosses shifts only under shiftWindow WARN, keeping the interjornada', () => {
    // the morning needs one more on Sunday; the afternoon has spare crew then — but only who is off
    // on Saturday may start at 05:00 on Sunday (the afternoon ends at 25:00)
    const duties = [...dutiesOf('MAN', { UTIL: 6, SAB: 6, DOM: 7 }), ...dutiesOf('TAR', { UTIL: 6, SAB: 6, DOM: 2 })]
    const crew = [...crewOf(7, 'MAN'), ...crewOf(14, 'TAR')]
    const warn = { ...settings.ruleModes, shiftWindow: 'WARN' as const }
    const block = computeConsole(base({ crew, duties })).sizing
    expect(block.operational).toBe(15)
    expect(computeConsole(base({ crew, duties, ruleModes: warn })).sizing.operational).toBe(14)
    // a rest floor the Monday afternoon can't keep after a Sunday morning: no crossing
    expect(computeConsole(base({ crew, duties, ruleModes: warn, restFloor: 1500 })).sizing.operational).toBe(15)
  })

  it('sizes the hour bank beyond the idle crew, by the share taken as days off', () => {
    const duties = dutiesOf('MAN', every(6)).map(d => ({ ...d, overtime: 60 }))
    // 60 min × 6 duties × (21 + 4 + 5) days = 10800 min/month; half banked = 5400 ÷ 420 ≈ 12.9 days
    // off, nobody idle → 12.9 ÷ 25.7 days worked a month → 1 crew member
    const z = computeConsole(base({ crew: crewOf(7, 'MAN'), duties })).sizing
    expect(z).toMatchObject({ bank: 1, bankPct: 100, required: 8 })
    expect(computeConsole(base({ crew: crewOf(7, 'MAN'), duties, bankCompPct: 0 })).sizing.bank).toBe(0)
  })

  it('takes the bank\'s days off on the crew working idle first', () => {
    // Sunday needs 6, weekdays 5: one idle a weekday (21 days a month) takes the 12.9 days off
    const duties = dutiesOf('MAN', { UTIL: 5, SAB: 6, DOM: 6 }).map(d => ({ ...d, overtime: 60 }))
    expect(computeConsole(base({ crew: crewOf(7, 'MAN'), duties })).sizing.bank).toBe(0)
  })
})

describe('lines per shift', () => {
  it('flags a line short in one shift even when the other shift has crew to spare', () => {
    const man = crewOf(7, 'MAN', { lineAccess: { L1: 'ENABLED' } })
    const tar = crewOf(14, 'TAR', { lineAccess: { L1: 'ENABLED' } })
    man.slice(0, 5).forEach(m => { m.lineAccess = {} })
    const snap = computeConsole(base({
      lineAccessMode: 'WHITELIST', crew: [...man, ...tar], duties: [...dutiesOf('MAN', { UTIL: 4 }), ...dutiesOf('TAR', { UTIL: 4 })],
    }))
    const row = snap.crewData.lines.find(l => l.shiftId === 'MAN')!
    expect(row).toMatchObject({ lineCode: '101', duties: 4, need: 5, enabled: 2, gap: -3 })
    expect(snap.crewData.lines.find(l => l.shiftId === 'TAR')!.gap).toBeGreaterThan(0)
    expect(snap.alerts.filter(a => a.code === 'LINE_SHORT')).toHaveLength(1)
  })

  it('counts who has the line as priority or preferred, without alerting', () => {
    const man = crewOf(7, 'MAN')
    man[0].priorityLines = ['L1']
    man[1].prefLines = ['L1']
    const snap = computeConsole(base({ crew: man, duties: dutiesOf('MAN', { UTIL: 4 }) }))
    expect(snap.crewData.lines[0]).toMatchObject({ bonded: 2, need: 5, ideal: 6, enabled: 7 })
    expect(snap.alerts.some(a => a.section === 'crew')).toBe(false)
  })

  it('warns when the enabled crew is above the need but below the margin', () => {
    const enabled = { L1: 'ENABLED' as const }
    // need 5, ideal 6 (+20%): 5 enabled → margin
    const man = crewOf(7, 'MAN').map((m, i) => ({ ...m, lineAccess: i < 5 ? enabled : {} }))
    const snap = computeConsole(base({ lineAccessMode: 'WHITELIST', crew: man, duties: dutiesOf('MAN', { UTIL: 4 }) }))
    expect(snap.alerts.filter(a => a.code === 'LINE_MARGIN')).toHaveLength(1)
    expect(snap.alerts.some(a => a.code === 'LINE_SHORT')).toBe(false)
  })
})

describe('rest groups by demand', () => {
  it('sends the days off to the weekday with the least duties', () => {
    // 7 crew all off on Monday; Sunday needs few duties — the ideal puts the days off on Sunday
    const crew = crewOf(7, 'MAN', {}, () => 0)
    const inp = base({ crew, duties: dutiesOf('MAN', { UTIL: 6, SAB: 6, DOM: 1 }) })
    const counts = idealGroupCounts(inp, crew, 'p6')
    const offsets = [0, 1, 2, 3, 4, 5, 6]
    // the group whose day off is Sunday (offset 0 with the anchor on a Monday) gets everyone it can
    const sundayGroup = offsets.findIndex(o => o === 0)
    expect(counts[sundayGroup]).toBeGreaterThanOrEqual(5)
    const snap = computeConsole(inp)
    expect(snap.groups[0].worstIdeal).toBeGreaterThan(snap.groups[0].worstNow)
    expect(snap.alerts.some(a => a.code === 'GROUPS_OFF_DEMAND')).toBe(true)
  })
})

describe('plans', () => {
  it('flags an effective plan without crew plan and duties without empresa', () => {
    const snap = computeConsole(base({
      plans: [
        { dayTypeId: 'SAB', vehiclePlan: { id: 'v', label: 'Sáb', validFrom: START, fleet: 10, reserve: 0, trips: 100 }, crewPlan: null, future: false, linesWithoutPlan: [] },
        {
          dayTypeId: 'UTIL', vehiclePlan: { id: 'u', label: 'Útil', validFrom: addDays(START, 20), fleet: 10, reserve: 0, trips: 100 },
          crewPlan: { id: 'c', label: 'Escala', duties: 4, byKind: {}, avgWorkMinutes: 420, overtimePct: 0, uncoveredMinutes: 0, stale: 0, issues: 0, noBranch: 3, score: 9000 },
          future: false, linesWithoutPlan: ['205'],
        },
      ],
    }))
    const codes = snap.alerts.map(a => a.code)
    expect(codes).toEqual(expect.arrayContaining(['PLAN_NO_CREW', 'DUTY_NO_BRANCH', 'LINE_NO_PLAN', 'PLAN_FUTURE']))
    expect(snap.plans.find(p => p.dayTypeId === 'UTIL')!.future).toBe(true)
    expect(snap.status.plans).toEqual({ severity: 'error', count: 3 })
  })
})

describe('idle shifts', () => {
  it('a shift off on a day type (Domingo Fixo) is not idle on it', () => {
    const sundayOff = { ...sixOne, id: 'df', cycle: { ...sixOne.cycle, pattern: 'TTTTTTF' } }
    // anchored on a Monday with offset 0: off every Sunday
    const crew = crewOf(7, 'MAN', { pattern: sundayOff, offset: 0 })
    const snap = computeConsole(base({ crew, duties: dutiesOf('MAN', { UTIL: 6, SAB: 6 }) }))
    expect(snap.shiftsAnalysis.idle).toEqual([])
    const working = computeConsole(base({ crew: crewOf(7, 'MAN'), duties: dutiesOf('MAN', { UTIL: 6, SAB: 6 }) }))
    expect(working.shiftsAnalysis.idle).toEqual([{ shiftId: 'MAN', dayTypeId: 'DOM', crew: 6 }])
  })
})
