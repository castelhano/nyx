import { PrismaService } from '../../../../prisma/prisma.service'
import type { GtfsRoute, GtfsService } from './gtfs-feed.builder'

// Only file of the export that touches the database

export async function loadOperatorTrips(
  prisma: PrismaService,
  vehiclePlanId: string,
  branchId: string,
): Promise<Pick<GtfsService, 'blocks' | 'otherOperatorTrips'>> {
  const blocks = await prisma.vehicleBlock.findMany({
    where:  { vehiclePlanId },
    select: {
      blockNumber: true,
      branchId:    true,
      blockTrips:  { select: { trip: { select: { routeId: true, departureMinutes: true, arrivalMinutes: true, bundleId: true, route: { select: { line: { select: { code: true } } } } } } } },
    },
  })

  const otherOperatorTrips: Record<string, number> = {}
  for (const block of blocks) {
    if (block.branchId === branchId) continue
    for (const { trip } of block.blockTrips) {
      otherOperatorTrips[trip.route.line.code] = (otherOperatorTrips[trip.route.line.code] ?? 0) + 1
    }
  }

  return {
    otherOperatorTrips,
    blocks: blocks.filter(b => b.branchId === branchId).map(b => ({
      blockNumber: b.blockNumber,
      trips: b.blockTrips.map(({ trip }) => ({ routeId: trip.routeId, departureMinutes: trip.departureMinutes, arrivalMinutes: trip.arrivalMinutes, bundleId: trip.bundleId })),
    })),
  }
}

export async function loadRoutes(prisma: PrismaService, routeIds: string[]): Promise<Map<string, GtfsRoute>> {
  const routes = await prisma.transitRoute.findMany({
    where:  { id: { in: routeIds } },
    select: {
      id: true, name: true, direction: true,
      line:       { select: { code: true, name: true, externalCodes: true } },
      localities: {
        select: {
          sequence: true, deltaMinutes: true, geometry: true,
          locality: { select: { code: true, name: true, lat: true, lng: true } },
        },
      },
    },
  })

  return new Map(routes.map(r => [r.id, {
    id: r.id, name: r.name, direction: r.direction, line: r.line,
    stops: r.localities.map(l => ({ ...l, geometry: l.geometry as GtfsRoute['stops'][number]['geometry'] })),
  }]))
}

export interface PlanWindowRow { id: string; dayTypeId: string; validFrom: Date | null; validTo: Date | null }

export function loadPublishedPlans(prisma: PrismaService, scopeId: string, dayTypeIds: string[]): Promise<PlanWindowRow[]> {
  return prisma.vehiclePlan.findMany({
    where:  { scopeId, dayTypeId: { in: dayTypeIds }, status: { not: 'DRAFT' } },
    select: { id: true, dayTypeId: true, validFrom: true, validTo: true },
  })
}
