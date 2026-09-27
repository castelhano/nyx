import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { TransitCrewConfigService } from '../src/modules/transit/settings/transit-crew-config.service'
import { CrewPlanService } from '../src/modules/transit/timetabling/crew-plan/crew-plan.service'

// Recalculates every crew plan (duty summaries/issues and the plan summary/score) — for when the
// calculation itself changes and the stored summaries (read by lists and DOP) must follow.
// Usage: pnpm crew:recalculate

async function main() {
  const prisma = new PrismaService()
  const crewPlans = new CrewPlanService(prisma, new TransitCrewConfigService(prisma))
  const plans = await prisma.crewPlan.findMany({ select: { id: true, description: true }, orderBy: { createdAt: 'asc' } })
  for (const p of plans) {
    await crewPlans.recalculate(p.id)
    const { summary } = await prisma.crewPlan.findUniqueOrThrow({ where: { id: p.id }, select: { summary: true } })
    console.log(`${p.description ?? p.id}: ${(summary as { score?: number } | null)?.score ?? '—'}`)
  }
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
