import {
  checkServiceRequirements,
  routeStopFractions,
  serviceRequirementWindowText,
  ROUTE_DIRECTION_LABEL,
  type ServiceRequirementTrip,
} from '@nyx/schemas'
import type { PrismaService } from '../../../../prisma/prisma.service'

// Warnings for the LineServiceRequirements of `lineIds` on `dayTypeId` that none of `trips`
// covers — shown in the activation/approval preview, never blocking
// (docs/proposal/plan_line_service_requirement_v1.md).
export async function uncoveredRequirementWarnings(
  prisma:    PrismaService,
  dayTypeId: string,
  lineIds:   string[],
  trips:     ServiceRequirementTrip[],
): Promise<string[]> {
  if (lineIds.length === 0) return []
  const requirements = await prisma.lineServiceRequirement.findMany({
    where:   { dayTypeId, lineId: { in: lineIds } },
    include: { line: { select: { code: true } }, locality: { select: { name: true } } },
    orderBy: { earliestMinutes: 'asc' },
  })
  if (requirements.length === 0) return []

  const routeIds = [...new Set(trips.map(t => t.routeId))]
  const stops = routeIds.length
    ? await prisma.routeLocality.findMany({
        where:  { routeId: { in: routeIds } },
        select: { routeId: true, localityId: true, sequence: true, deltaMinutes: true, deltaKm: true },
      })
    : []
  const stopsByRoute = new Map(routeIds.map(id => [id, routeStopFractions(stops.filter(s => s.routeId === id))]))

  const { coveredBy } = checkServiceRequirements(requirements, trips, stopsByRoute)
  return requirements
    .filter(r => (coveredBy.get(r.id) ?? []).length === 0)
    .map(r => `Linha ${r.line.code}: atendimento "${r.label}" (${ROUTE_DIRECTION_LABEL[r.direction] ?? r.direction} `
      + `${serviceRequirementWindowText(r)}${r.locality ? ` em ${r.locality.name}` : ''}) sem viagem na janela`)
}
