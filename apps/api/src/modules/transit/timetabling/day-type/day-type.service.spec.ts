import { describe, expect, it } from 'vitest'
import { DayTypeService } from './day-type.service'

const U = { id: 'U', code: 'U', pattern: { type: 'weekdays', days: [1, 2, 3, 4, 5] }, priority: 1 }
const S = { id: 'S', code: 'S', pattern: { type: 'weekdays', days: [6] }, priority: 1 }
const D = { id: 'D', code: 'D', pattern: { type: 'weekdays', days: [7] }, priority: 1 }
const F = { id: 'F', code: 'F', pattern: null, priority: 3 }

const LINES = [{ id: 'L1', scopeId: 'SC1' }, { id: 'L2', scopeId: 'SC1' }, { id: 'L3', scopeId: 'SC2' }]

function service(exceptions: any[]) {
  const prisma = {
    dayType:               { findMany: async () => [U, S, D] },
    transitLine:           { findMany: async ({ where }: any) => LINES.filter(l => where.id.in.includes(l.id)) },
    lineCalendarException: { findMany: async () => exceptions },
  }
  return new DayTypeService(prisma as any)
}

// 2027-01-13 is a Wednesday, 2027-01-16 a Saturday
const WED = new Date(2027, 0, 13)
const SAT = new Date(2027, 0, 16)
const ferias = (over: Record<string, unknown>) => ({
  validFrom: new Date(2027, 0, 4), validTo: new Date(2027, 0, 29),
  sourceDayTypeId: 'U', overrideDayType: F, scopeId: null, lines: [], ...over,
})

describe('DayTypeService.buildDayTypeResolver', () => {
  it('applies a scope exception to every line of the scope only', async () => {
    const resolve = await service([ferias({ scopeId: 'SC1' })]).buildDayTypeResolver(WED, SAT, ['L1', 'L2', 'L3'])
    expect(resolve(WED, 'L1').id).toBe('F')
    expect(resolve(WED, 'L2').id).toBe('F')
    expect(resolve(WED, 'L3').id).toBe('U')
  })

  it('keeps Saturdays when the exception is conditional on weekdays', async () => {
    const resolve = await service([ferias({ scopeId: 'SC1' })]).buildDayTypeResolver(WED, SAT, ['L1'])
    expect(resolve(SAT, 'L1').id).toBe('S')
  })

  it('still applies an exception listing the line', async () => {
    const resolve = await service([ferias({ lines: [{ lineId: 'L3' }] })]).buildDayTypeResolver(WED, SAT, ['L1', 'L3'])
    expect(resolve(WED, 'L3').id).toBe('F')
    expect(resolve(WED, 'L1').id).toBe('U')
  })
})
