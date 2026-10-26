import { describe, expect, it } from 'vitest'
import { rosterSettingsSchema } from '@nyx/schemas'
import { RosterModel, type RgDuty, type RgInput, type RgMember } from './roster-generator.calc'

const settings = rosterSettingsSchema.parse({})
const duty = (id: string, day: number, signature: string): RgDuty => ({
  id, day, start: 360, end: 780, paid: 420, kind: 'NORMAL', signature, shift: null,
  lineMinutes: [], vehicleTypes: [], operated: true, standby: false, preferred: [],
})
const member = (over: Partial<RgMember> = {}): RgMember => ({
  id: 'm', code: '1', name: 'M', lineAccess: {}, prefGrade: {}, priorityGrade: {}, blockedVehicleTypes: [], overtimePreference: 'NEUTRAL',
  status: ['free', 'free'], windows: [null, null], fixed: [null, null], licenseExpired: [false, false], courseExpired: [false, false],
  targetMinutes: 0, dayLoad: 420, workedBefore: 0, changesBefore: 0, lastSignatures: { P: 'P#A' }, prevEnd: null, nextStart: null,
  published: [-2, -2], current: [-1, -1], ...over,
})
const input = (m: RgMember): RgInput => ({
  days: ['2026-10-01', '2026-10-02'], duties: [duty('a', 0, 'P#A'), duty('b', 1, 'P#B')], members: [m],
  loadDaysBefore: 0, ensureMonthlyLoad: false, maxChanges: 0, lineAccessMode: 'BLACKLIST', ruleModes: settings.ruleModes, range: settings.range,
  rest: { active: false, modifier: 1, floor: 600, idealMin: 660, idealMax: 960, ceiling: 960 },
  compensate: false, noComp: [false, false],
})

describe('ferista last duties (lastSwaps)', () => {
  it('a table change past maxChanges is hard', () => {
    const e = new RosterModel(input(member())).evaluate(0, Int32Array.from([0, 1]))
    expect(e.changes).toBe(1)
    expect(e.hard).toBe(true)
  })
  it("taking the titular's last duties on the swap day doesn't count as a change", () => {
    const e = new RosterModel(input(member({ lastSwaps: { 1: { P: 'P#B' } } }))).evaluate(0, Int32Array.from([0, 1]))
    expect(e.changes).toBe(0)
    expect(e.hard).toBe(false)
  })
})

describe('compensate — the hour bank decides who is left free', () => {
  const bank = (expiring: number, lot = 0) => ({ expiring, lot, negative: 0, journey: 420 })
  const one = (preferred: number[], a = member({ id: 'a', bank: bank(600) }), b = member({ id: 'b', bank: bank(0) })): RgInput => ({
    ...input(a), members: [a, b], days: ['2026-10-01'], duties: [{ ...duty('d', 0, 'P#A'), preferred }],
    compensate: true, noComp: [false],
  })
  // the objective of a whole allocation (row per member)
  const value = (inp: RgInput, rows: number[][]) => {
    const model = new RosterModel(inp)
    const e = rows.map((r, mi) => model.evaluate(mi, Int32Array.from(r)))
    return model.objective(e.reduce((n, x) => n + x.score, 0), e.reduce((n, x) => n + x.warns, 0), 0, e.reduce((n, x) => n + x.pin, 0), e.reduce((n, x) => n + x.bank, 0))
  }
  const withStatus = (m: RgMember) => ({ ...m, status: ['free'] as RgMember['status'], windows: [null], fixed: [null], licenseExpired: [false], courseExpired: [false], published: [-2], current: [-1] })

  it('leaves the one with the most hours free', () => {
    const inp = one([])
    inp.members = inp.members.map(withStatus)
    expect(value(inp, [[-1], [0]])).toBeGreaterThan(value(inp, [[0], [-1]]))
  })
  it('keeps a lone preferred crew member, even with more hours', () => {
    const inp = one([0])
    inp.members = inp.members.map(withStatus)
    expect(value(inp, [[0], [-1]])).toBeGreaterThan(value(inp, [[-1], [0]]))
  })
  it('lets the first preferred go when the next one listed takes it', () => {
    const inp = one([0, 1])
    inp.members = inp.members.map(withStatus)
    expect(value(inp, [[-1], [0]])).toBeGreaterThan(value(inp, [[0], [-1]]))
  })
  it("doesn't count a one-off substitution against maxChanges", () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03']
    const m = member({ status: ['free', 'free', 'free'], windows: [null, null, null], fixed: [null, null, null], licenseExpired: [false, false, false], courseExpired: [false, false, false], published: [-2, -2, -2], current: [-1, -1, -1] })
    const base = { ...input(m), days, duties: [duty('a', 0, 'P#A'), duty('b', 1, 'P#B'), duty('c', 2, 'P#A')], noComp: [false, false, false] }
    expect(new RosterModel(base).evaluate(0, Int32Array.from([0, 1, 2])).hard).toBe(true)
    expect(new RosterModel({ ...base, compensate: true }).evaluate(0, Int32Array.from([0, 1, 2])).hard).toBe(false)
  })
})

describe('priority lines — the empresa\'s, before the crew member\'s preferences', () => {
  const onLine = (id: string, lineId: string): RgDuty => ({ ...duty(id, 0, `P#${id}`), lineMinutes: [{ lineId, minutes: 300 }] })
  const one = (m: RgMember): RgInput => ({
    ...input(m), days: ['2026-10-01'], duties: [onLine('x', 'L1'), onLine('y', 'L2')], noComp: [false],
    members: [{ ...m, status: ['free'], windows: [null], fixed: [null], licenseExpired: [false], courseExpired: [false], published: [-2], current: [-1], lastSignatures: {} }],
  })
  it('scores the duty on his priority line above the one on his preferred line', () => {
    const model = new RosterModel(one(member({ priorityGrade: { L1: 1 }, prefGrade: { L2: 1 } })))
    expect(model.evaluate(0, Int32Array.from([0])).score).toBeGreaterThan(model.evaluate(0, Int32Array.from([1])).score)
  })
  it('without priority lines, his preference decides', () => {
    const model = new RosterModel(one(member({ prefGrade: { L2: 1 } })))
    expect(model.evaluate(0, Int32Array.from([1])).score).toBeGreaterThan(model.evaluate(0, Int32Array.from([0])).score)
  })
})
