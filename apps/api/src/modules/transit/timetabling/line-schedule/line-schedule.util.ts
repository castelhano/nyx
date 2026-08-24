import { PrismaService } from '../../../../prisma/prisma.service'

// Placeholder approvalRef for schedules created before the orgao gestor has issued
// a real processo number — user renames it later, at/before approval. Not gapless
// (renaming/deleting a DRAFT-000N frees the number). Shared by LineScheduleService
// ("Duplicar") and VehiclePlanService (auto-activated versions from reconcile).
export async function generateDraftRef(prisma: PrismaService, lineId: string, dayTypeId: string): Promise<string> {
  const existing = await prisma.lineSchedule.findMany({
    where:  { lineId, dayTypeId, approvalRef: { startsWith: 'DRAFT-' } },
    select: { approvalRef: true },
  })
  const maxSuffix = existing.reduce((max, s) => {
    const n = parseInt(s.approvalRef.slice('DRAFT-'.length), 10)
    return isNaN(n) ? max : Math.max(max, n)
  }, 0)
  return `DRAFT-${String(maxSuffix + 1).padStart(4, '0')}`
}
