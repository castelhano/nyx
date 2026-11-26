import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

// Special day plans (docs/proposal/plan_special_day_plans_v1.md): a plan of a day type without
// pattern (Férias, Especial) derives from a conventional one (with pattern) — baseDayTypeId — and
// its lines may pin that day type's OSOs as well as their own. Conventional plans have no base.

type Db = Pick<Prisma.TransactionClient, 'dayType'>

export async function assertPlanDayTypes(db: Db, dayTypeId: string, baseDayTypeId: string | null | undefined): Promise<void> {
  const ids = baseDayTypeId ? [dayTypeId, baseDayTypeId] : [dayTypeId]
  const dayTypes = await db.dayType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, pattern: true } })
  const dayType = dayTypes.find(d => d.id === dayTypeId)
  if (!dayType) throw new BadRequestException('Tipo de dia não encontrado')

  if (dayType.pattern) {
    if (baseDayTypeId) throw new BadRequestException(`${dayType.name} tem padrão de dias: o planejamento não tem tipo de dia base`)
    return
  }
  if (!baseDayTypeId) throw new BadRequestException(`${dayType.name} não tem padrão de dias: informe o tipo de dia base do planejamento`)
  const base = dayTypes.find(d => d.id === baseDayTypeId)
  if (!base) throw new BadRequestException('Tipo de dia base não encontrado')
  if (!base.pattern) throw new BadRequestException(`O tipo de dia base precisa ter padrão de dias (${base.name} não tem)`)
}

// the day types whose OSOs the plan's lines may pin
export function pinnableDayTypeIds(plan: { dayTypeId: string; baseDayTypeId: string | null }): string[] {
  return plan.baseDayTypeId ? [plan.dayTypeId, plan.baseDayTypeId] : [plan.dayTypeId]
}
