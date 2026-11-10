import { Injectable } from '@nestjs/common'
import { travelTimeSchema, TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto, type ExternalCodeSystem, type IdleMatrixExport } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { inForceOn, localToday } from '../../timetabling/plan-validity'
import { buildIdleMatrix } from './idle-matrix'

@Injectable()
export class TravelTimeService extends BaseService<TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'travelTimeMatrix', travelTimeSchema, 'transit')
  }

  protected buildSearchWhere(_search: string) {
    return {}
  }

  async setSourceAll(lock: boolean): Promise<{ updated: number }> {
    const result = await this.prisma.travelTimeMatrix.updateMany({
      where: { source: lock ? 'OSRM' : 'MANUAL' },
      data:  { source: lock ? 'MANUAL' : 'OSRM' },
    })
    return { updated: result.count }
  }

  // Idle matrix: trip endpoints are those of the plans in force today, of any operator, so one
  // file covers every GTFS load of the tenant. `depotCodes` names the system whose codes depots take.
  async idleMatrix(depotCodes?: ExternalCodeSystem): Promise<IdleMatrixExport> {
    const today = localToday()
    const plans = (await this.prisma.vehiclePlan.findMany({
      where:  { status: { not: 'DRAFT' } },
      select: { id: true, validFrom: true, validTo: true },
    })).filter(p => inForceOn(p, today))

    const [entries, localities, routes] = await Promise.all([
      this.prisma.travelTimeMatrix.findMany({ select: { originId: true, destinationId: true, baseMinutes: true, distanceKm: true, speedRatio: true } }),
      this.prisma.transitLocality.findMany({ select: { id: true, code: true, name: true, isDepot: true, externalCodes: true } }),
      this.prisma.transitTrip.findMany({
        where:    { vehiclePlanId: { in: plans.map(p => p.id) } },
        distinct: ['routeId'],
        select:   { route: { select: { originLocalityId: true, destinationLocalityId: true } } },
      }),
    ])

    return buildIdleMatrix(
      entries,
      new Map(localities.map(l => [l.id, l])),
      new Set(routes.flatMap(t => [t.route.originLocalityId, t.route.destinationLocalityId])),
      depotCodes,
    )
  }
}
