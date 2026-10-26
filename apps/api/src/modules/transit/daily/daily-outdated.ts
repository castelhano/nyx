import type { DailySource } from '@nyx/schemas'
import type { PrismaService } from '../../../prisma/prisma.service'
import { dayOf, inForceOn } from '../timetabling/plan-validity'

// Days whose copy is no longer what's in force on their date: a source vehicle plan out of its
// validity (superseded), or a crew plan other than the one now in force for it — a plan
// activated after the day was created. Recreating the day (rematerialize) picks the new one.
export async function outdatedOperations(prisma: PrismaService, operations: { id: string; date: Date; sources: unknown }[]): Promise<Map<string, string>> {
  const sourcesOf = (o: { sources: unknown }) => (o.sources ?? []) as DailySource[]
  const plans = await prisma.vehiclePlan.findMany({
    where:  { id: { in: [...new Set(operations.flatMap(o => sourcesOf(o).map(s => s.vehiclePlanId)))] } },
    select: {
      id: true, description: true, validFrom: true, validTo: true,
      crewPlans: { where: { status: { in: ['ACTIVE', 'SUPERSEDED'] } }, select: { id: true, description: true, validFrom: true, validTo: true } },
    },
  })
  const crewNames = new Map((await prisma.crewPlan.findMany({
    where:  { id: { in: [...new Set(operations.flatMap(o => sourcesOf(o).flatMap(s => s.crewPlanId ?? [])))] } },
    select: { id: true, description: true },
  })).map(c => [c.id, c.description || 'Escala']))
  const byId = new Map(plans.map(p => [p.id, p]))
  const out = new Map<string, string>()
  for (const o of operations) {
    const day = dayOf(o.date)
    for (const s of sourcesOf(o)) {
      const vp = byId.get(s.vehiclePlanId)
      if (!vp || !inForceOn(vp, day)) {
        out.set(o.id, `Copiado do planejamento de veículos "${vp?.description || 'sem descrição'}", que não está mais em vigor`)
        break
      }
      const now = vp.crewPlans.find(c => inForceOn(c, day)) ?? null
      if ((now?.id ?? null) !== s.crewPlanId) {
        const was = s.crewPlanId ? `"${crewNames.get(s.crewPlanId) ?? 'Escala'}"` : 'sem escala'
        out.set(o.id, `Copiado de ${was} — em vigor agora: ${now ? `"${now.description || 'Escala'}"` : 'nenhuma escala'}`)
        break
      }
    }
  }
  return out
}
