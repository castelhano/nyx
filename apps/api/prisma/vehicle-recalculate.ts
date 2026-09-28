import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { TransitGeneralConfigService } from '../src/modules/transit/settings/transit-general-config.service'
import { TransitPlanningConfigService } from '../src/modules/transit/settings/transit-planning-config.service'
import { TransitCrewConfigService } from '../src/modules/transit/settings/transit-crew-config.service'
import { JobService } from '../src/modules/core/job/job.service'
import { CrewPlanService } from '../src/modules/transit/timetabling/crew-plan/crew-plan.service'
import { VehiclePlanService } from '../src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service'

// Recalculates every vehicle plan (block summaries/issues, plan and line summaries) and, through
// it, the crew plans built on them — for when the calculation itself changes.
// Usage: pnpm vehicle:recalculate

async function main() {
  const prisma = new PrismaService()
  const vehiclePlans = new VehiclePlanService(
    prisma, new TransitGeneralConfigService(prisma), new TransitPlanningConfigService(prisma), new JobService(prisma),
    new CrewPlanService(prisma, new TransitCrewConfigService(prisma)),
  )
  const plans = await prisma.vehiclePlan.findMany({ select: { id: true, description: true }, orderBy: { createdAt: 'asc' } })
  for (const p of plans) {
    await vehiclePlans.recalculate(p.id)
    const flagged = await prisma.vehicleBlock.count({ where: { vehiclePlanId: p.id, hasIssues: true } })
    console.log(`${p.description ?? p.id}: ${flagged} carro(s) com pendências`)
  }
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
