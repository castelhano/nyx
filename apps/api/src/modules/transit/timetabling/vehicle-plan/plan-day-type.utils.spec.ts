import { describe, expect, it } from 'vitest'
import { assertPlanDayTypes, pinnableDayTypeIds } from './plan-day-type.utils'

const DAY_TYPES = [
  { id: 'U', name: 'UTIL',   pattern: { type: 'weekdays', days: [1, 2, 3, 4, 5] } },
  { id: 'S', name: 'SABADO', pattern: { type: 'weekdays', days: [6] } },
  { id: 'F', name: 'FERIAS', pattern: null },
  { id: 'E', name: 'ESPECIAL', pattern: null },
]
const db = {
  dayType: { findMany: async ({ where }: any) => DAY_TYPES.filter(d => where.id.in.includes(d.id)) },
} as any

describe('assertPlanDayTypes', () => {
  it('accepts a conventional plan without base', async () => {
    await expect(assertPlanDayTypes(db, 'U', null)).resolves.toBeUndefined()
  })

  it('refuses a conventional plan with a base', async () => {
    await expect(assertPlanDayTypes(db, 'S', 'U')).rejects.toThrow(/tem padrão/)
  })

  it('accepts a special plan based on a conventional day type', async () => {
    await expect(assertPlanDayTypes(db, 'F', 'U')).resolves.toBeUndefined()
  })

  it('refuses a special plan without base', async () => {
    await expect(assertPlanDayTypes(db, 'F', null)).rejects.toThrow(/informe o tipo de dia base/)
  })

  it('refuses a special plan based on another special one', async () => {
    await expect(assertPlanDayTypes(db, 'E', 'F')).rejects.toThrow(/precisa ter padrão/)
  })
})

describe('pinnableDayTypeIds', () => {
  it('is the plan day type alone on conventional plans, plus the base on special ones', () => {
    expect(pinnableDayTypeIds({ dayTypeId: 'U', baseDayTypeId: null })).toEqual(['U'])
    expect(pinnableDayTypeIds({ dayTypeId: 'F', baseDayTypeId: 'U' })).toEqual(['F', 'U'])
  })
})
