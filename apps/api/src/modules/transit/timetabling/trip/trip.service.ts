import { Injectable } from '@nestjs/common'
import { tripSchema, Trip, CreateTripDto, UpdateTripDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { VehiclePlanService } from '../vehicle-plan/vehicle-plan.service'

@Injectable()
export class TripService extends BaseService<Trip, CreateTripDto, UpdateTripDto> {
  constructor(
    prisma: PrismaService,
    private readonly vehiclePlanService: VehiclePlanService,
  ) {
    super(prisma, 'transitTrip', tripSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    const asNumber = parseInt(search, 10)
    return isNaN(asNumber)
      ? {}
      : { OR: [{ departureMinutes: asNumber }, { arrivalMinutes: asNumber }] }
  }

  // Marks isDrifted on every VehiclePlanLine (across whatever plans currently use this
  // trip's blocks — normally just one, but nothing prevents more) for the given line,
  // signalling that formalizing a new LineSchedule version may be warranted.
  private async flagDrift(tripId: string, lineId: string): Promise<void> {
    const rows = await (this.prisma as any).blockTrip.findMany({
      where:  { tripId },
      select: { vehicleBlock: { select: { vehiclePlanId: true } } },
    })
    const planIds = [...new Set(rows.map((r: any) => r.vehicleBlock.vehiclePlanId).filter(Boolean))] as string[]
    if (planIds.length === 0) return

    await this.prisma.vehiclePlanLine.updateMany({
      where: { vehiclePlanId: { in: planIds }, lineId },
      data:  { isDrifted: true },
    })
  }

  override async update(id: string, dto: UpdateTripDto): Promise<Trip> {
    const existing = await this.prisma.transitTrip.findUnique({
      where:  { id },
      select: { lineDepartureId: true, route: { select: { lineId: true } } },
    })

    const result = await super.update(id, dto)

    const timeFieldsChanged = dto.departureMinutes !== undefined || dto.arrivalMinutes !== undefined
    if (timeFieldsChanged) {
      await this.prisma.vehicleBlock.updateMany({
        where: { blockTrips: { some: { tripId: id } } },
        data:  { isStale: true },
      })
    }

    // Only the departure minute is part of what the órgão gestor approves (LineDeparture
    // has no arrival) — so drift is judged against departureMinutes only.
    if (dto.departureMinutes !== undefined && existing?.lineDepartureId) {
      const departure = await this.prisma.lineDeparture.findUnique({
        where:  { id: existing.lineDepartureId },
        select: { departureMinutes: true },
      })
      if (departure && result.departureMinutes !== departure.departureMinutes) {
        await this.flagDrift(id, existing.route.lineId)
      }
    }

    return result
  }

  override async remove(id: string): Promise<void> {
    const db = this.prisma as any

    const existing = await this.prisma.transitTrip.findUnique({
      where:  { id },
      select: { lineDepartureId: true, route: { select: { lineId: true } } },
    })

    // Capture which blocks held this trip (and their plan IDs) before cascade-delete
    const rows: { vehicleBlockId: string; vehicleBlock: { vehiclePlanId: string | null } }[] =
      await db.blockTrip.findMany({
        where:  { tripId: id },
        select: { vehicleBlockId: true, vehicleBlock: { select: { vehiclePlanId: true } } },
      })
    const blockIds = rows.map(r => r.vehicleBlockId)
    const planIds  = [...new Set(rows.map(r => r.vehicleBlock.vehiclePlanId).filter(Boolean) as string[])]

    // Removing a departure that was tracked against an approved LineDeparture is a
    // divergence too — the OS specified a trip that no longer exists in this plan.
    if (existing?.lineDepartureId && planIds.length > 0) {
      await this.prisma.vehiclePlanLine.updateMany({
        where: { vehiclePlanId: { in: planIds }, lineId: existing.route.lineId },
        data:  { isDrifted: true },
      })
    }

    await super.remove(id)  // deletes TransitTrip → cascades BlockTrip

    if (blockIds.length > 0) {
      // Delete every block that is now completely empty (no trips left)
      await db.vehicleBlock.deleteMany({
        where: { id: { in: blockIds }, blockTrips: { none: {} } },
      })
      // Mark remaining (non-empty) blocks as stale so scorePlan updates their summaries
      await db.vehicleBlock.updateMany({
        where: { id: { in: blockIds } },
        data:  { isStale: true },
      })
    }

    // Re-score each affected plan so block summaries are recalculated
    for (const planId of planIds) {
      await this.vehiclePlanService.scorePlan(planId)
    }
  }
}
