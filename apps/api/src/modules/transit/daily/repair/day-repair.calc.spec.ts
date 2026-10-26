import { describe, expect, it } from 'vitest'
import { rosterSettingsSchema, type ShiftWindow } from '@nyx/schemas'
import type { RgDuty, RgInput, RgMember } from '../roster/roster-generator.calc'
import type { CarFacts, CarVehicle } from '../roster/roster-vehicles'
import { repairCrew, type CrewRepairInput, type CrewRepairTarget } from './crew-repair.calc'
import { repairVehicles, type VehicleRepairBlock } from './vehicle-repair.calc'

const settings = rosterSettingsSchema.parse({})
const DAY = '2026-10-05'
const wide: ShiftWindow = {
  id: 's', priority: 0, allowSplit: true,
  startFloor: 0, startIdealMin: 0, startIdealMax: 1440, startCeiling: 1440, endFloor: 0, endIdealMin: 0, endIdealMax: 2880, endCeiling: 2880,
}
const duty = (id: string, line: string, over: Partial<RgDuty> = {}): RgDuty => ({
  id, day: 0, start: 360, end: 780, paid: 420, kind: 'NORMAL', signature: `P#${id}`, shift: 'MAN',
  lineMinutes: [{ lineId: line, minutes: 300 }], vehicleTypes: [], operated: true, standby: false, preferred: [], ...over,
})
const plantao = (id: string, start: number) => duty(id, '__STANDBY__', { start, end: start + 420, standby: true, kind: 'STANDBY' })
const member = (id: string, over: Partial<RgMember> = {}): RgMember => ({
  id, code: id, name: id.toUpperCase(), lineAccess: {}, prefGrade: {}, priorityGrade: {}, blockedVehicleTypes: [], overtimePreference: 'NEUTRAL',
  status: ['free'], windows: [wide], fixed: [null], licenseExpired: [false], courseExpired: [false],
  targetMinutes: 0, dayLoad: 420, workedBefore: 0, changesBefore: 0, lastSignatures: {}, prevEnd: null, nextStart: null,
  published: [-2], current: [-1], ...over,
})
// members hold the duties their `current` says; the targets are given
const crewInput = (duties: RgDuty[], members: RgMember[], targets: CrewRepairTarget[], over: Partial<CrewRepairInput> = {}): CrewRepairInput => {
  const rg: RgInput = {
    days: [DAY], duties, members, loadDaysBefore: 0, ensureMonthlyLoad: false, maxChanges: 99,
    lineAccessMode: 'BLACKLIST', ruleModes: settings.ruleModes, range: settings.range,
    rest: { active: false, modifier: 1, floor: 600, idealMin: 660, idealMax: 960, ceiling: 960 }, compensate: false, noComp: [false],
  }
  const holder = duties.map((_, di) => members.findIndex(m => m.current[0] === di))
  return {
    rg, holder, holderId: holder.map(h => (h >= 0 ? members[h].id : null)), holderLabel: holder.map(h => (h >= 0 ? members[h].id : null)),
    dutyLabel: duties.map(d => d.id), targets, compOff: members.map(() => [false]), balance: members.map(() => null), published: [false], ...over,
  }
}
const blockedOn = (line: string) => ({ lineAccess: { [line]: 'BLOCKED' as const } })

describe('cobrir tabelas', () => {
  it('takes someone free on the day', () => {
    const items = repairCrew(crewInput([duty('T', 'L1')], [member('f')], [{ di: 0, reason: 'sem operador', warnOnly: false }]))
    expect(items[0].options[0]).toMatchObject({ kind: 'FREE', steps: [{ type: 'crew', dutyId: 'T', from: null, to: 'f' }] })
    expect(items[0].proposed).toBe(0)
  })

  it('swaps when the free one can not take the line: one move', () => {
    const items = repairCrew(crewInput(
      [duty('T', 'L1'), duty('D', 'L2')],
      [member('f', blockedOn('L1')), member('h', { current: [1] })],
      [{ di: 0, reason: 'sem operador', warnOnly: false }],
    ))
    expect(items[0].options[0].kind).toBe('SWAP')
    // f takes D first (freeing h), then h takes the target
    expect(items[0].options[0].steps).toEqual([
      { type: 'crew', dutyId: 'D', from: 'h', to: 'f' },
      { type: 'crew', dutyId: 'T', from: null, to: 'h' },
    ])
  })

  it('two levels only when no single move does', () => {
    // f can only do L3; h1 (on L3) can only do L2; h2 (on L2) takes the target
    const items = repairCrew(crewInput(
      [duty('T', 'L1'), duty('D2', 'L2'), duty('D1', 'L3')],
      [
        member('f',  { lineAccess: { L1: 'BLOCKED', L2: 'BLOCKED' } }),
        member('h1', { current: [2], lineAccess: { L1: 'BLOCKED' } }),
        member('h2', { current: [1] }),
      ],
      [{ di: 0, reason: 'sem operador', warnOnly: false }],
    ))
    expect(items[0].options[0].kind).toBe('SWAP2')
    expect(items[0].options[0].steps.map(s => (s.type === 'crew' ? `${s.dutyId}:${s.to}` : ''))).toEqual(['D1:f', 'D2:h1', 'T:h2'])
  })

  it('without free crew: offers the folgas compensadas (lowest bank first) and the plantões of the busiest time', () => {
    const inp = crewInput(
      [duty('T', 'L1'), plantao('P4', 240), plantao('P5a', 300), plantao('P5b', 300)],
      [member('c1'), member('c2'), member('p4', { current: [1] }), member('p5a', { current: [2] }), member('p5b', { current: [3] })],
      [{ di: 0, reason: 'sem operador', warnOnly: false }],
    )
    inp.compOff = [[true], [true], [false], [false], [false]]
    inp.balance = [600, 120, null, null, null]
    const items = repairCrew(inp)
    expect(items[0].proposed).toBeNull()
    const comp = items[0].options.filter(o => o.kind === 'COMP_OFF')
    expect(comp.map(o => o.text)).toEqual(['c2 C2', 'c1 C1'])
    expect(comp[0].steps[0]).toEqual({ type: 'compOff', date: DAY, crewMemberId: 'c2' })
    const standby = items[0].options.filter(o => o.kind === 'STANDBY')
    // the 05:00 ones (two there) before the 04:00 one
    expect(standby.map(o => o.text.split(' ')[0])).toEqual(['p5a', 'p5b', 'p4'])
    expect(standby[0].steps[0]).toEqual({ type: 'crew', dutyId: 'P5a', from: 'p5a', to: null })
  })

  it('a WARN-only target is solved only by someone without pendências', () => {
    const warnRules = { ...settings.ruleModes, lineAccess: 'WARN' as const }
    const inp = crewInput([duty('T', 'L1')], [member('h', { current: [0] }), member('w', blockedOn('L1'))], [{ di: 0, reason: 'linha', warnOnly: true }])
    inp.rg.ruleModes = warnRules
    expect(repairCrew(inp)[0].options).toHaveLength(0)
    inp.rg.members.push(member('ok'))
    inp.compOff.push([false]); inp.balance.push(null)
    expect(repairCrew(inp)[0].options[0]).toMatchObject({ kind: 'FREE', steps: [{ dutyId: 'T', from: 'h', to: 'ok' }] })
  })
})

describe('encaixar veículos', () => {
  const car = (id: string, vehicleType: CarVehicle['vehicleType'] = 'STANDARD'): CarVehicle => ({ id, code: id.toUpperCase(), vehicleType, unavailabilities: [] })
  const block = (id: string, n: number, line: string, vehicleId: string | null, issues: VehicleRepairBlock['issues'] = []): VehicleRepairBlock => ({
    id, blockNumber: n, vehicleId, issues, published: false, operation: { date: new Date(`${DAY}T00:00:00Z`) },
    events: [{ lineId: line, requiredVehicleType: null }], pieces: [],
  })
  const facts = (vehicles: CarVehicle[]): CarFacts => ({
    vehicles, preferred: new Map(), habitual: new Map(),
    allowedByLine: new Map([['STD', ['STANDARD']], ['ART', ['ARTICULATED']], ['ANY', ['STANDARD', 'ARTICULATED']]]),
  })

  it('takes a free car of a type the block accepts', () => {
    const items = repairVehicles({ facts: facts([car('a', 'ARTICULATED'), car('s')]), blocks: [block('b1', 1, 'STD', null, ['BLOCK_NO_VEHICLE'])], busy: new Map(), code: new Map() })
    expect(items[0].options[0]).toMatchObject({ kind: 'SPARE', steps: [{ type: 'vehicle', blockId: 'b1', from: null, to: 's' }] })
  })

  it('swaps types: only a standard car is free, the target needs an articulated one', () => {
    const items = repairVehicles({
      facts: facts([car('s'), car('a', 'ARTICULATED')]),
      blocks: [block('b1', 1, 'ART', null, ['BLOCK_NO_VEHICLE']), block('x', 2, 'ANY', 'a')],
      busy: new Map(), code: new Map(),
    })
    expect(items[0].options[0].kind).toBe('TYPE_SWAP')
    expect(items[0].options[0].steps).toEqual([
      { type: 'vehicle', blockId: 'x', from: 'a', to: 's' },
      { type: 'vehicle', blockId: 'b1', from: null, to: 'a' },
    ])
  })

  it('a car on two blocks stays on one; the other gets a free car', () => {
    const items = repairVehicles({
      facts: facts([car('d'), car('s')]),
      blocks: [block('b1', 1, 'STD', 'd', ['VEHICLE_DOUBLE']), block('b2', 2, 'STD', 'd', ['VEHICLE_DOUBLE'])],
      busy: new Map(), code: new Map(),
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'b2', options: [{ steps: [{ blockId: 'b2', from: 'd', to: 's' }] }] })
  })
})
