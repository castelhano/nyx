import { describe, expect, it } from 'vitest'
import { rosterSettingsSchema } from '@nyx/schemas'
import { RosterModel, type RgDuty, type RgInput, type RgMember } from './roster-generator.calc'

const settings = rosterSettingsSchema.parse({})
const duty = (id: string, day: number, signature: string): RgDuty => ({
  id, day, start: 360, end: 780, paid: 420, kind: 'NORMAL', signature, shift: null,
  lineMinutes: [], vehicleTypes: [], operated: true, standby: false, preferred: [],
})
const member = (over: Partial<RgMember> = {}): RgMember => ({
  id: 'm', code: '1', name: 'M', lineAccess: {}, prefGrade: {}, blockedVehicleTypes: [], overtimePreference: 'NEUTRAL',
  status: ['free', 'free'], windows: [null, null], fixed: [null, null], licenseExpired: [false, false], courseExpired: [false, false],
  targetMinutes: 0, workedBefore: 0, changesBefore: 0, lastSignatures: { P: 'P#A' }, prevEnd: null, nextStart: null,
  published: [-2, -2], current: [-1, -1], ...over,
})
const input = (m: RgMember): RgInput => ({
  days: ['2026-10-01', '2026-10-02'], duties: [duty('a', 0, 'P#A'), duty('b', 1, 'P#B')], members: [m],
  loadDaysBefore: 0, ensureMonthlyLoad: false, maxChanges: 0, lineAccessMode: 'BLACKLIST', ruleModes: settings.ruleModes, range: settings.range,
  rest: { active: false, modifier: 1, floor: 600, idealMin: 660, idealMax: 960, ceiling: 960 },
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
