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

  override async update(id: string, dto: UpdateTripDto): Promise<Trip> {
    const result = await super.update(id, dto)
    const timeFieldsChanged = dto.departureMinutes !== undefined || dto.arrivalMinutes !== undefined
    if (timeFieldsChanged) {
      await this.prisma.vehicleBlock.updateMany({
        where: { blockTrips: { some: { tripId: id } } },
        data:  { isStale: true },
      })
    }
    return result
  }

  override async remove(id: string): Promise<void> {
    const db = this.prisma as any

    // Capture which blocks held this trip (and their plan IDs) before cascade-delete
    const rows: { vehicleBlockId: string; vehicleBlock: { vehiclePlanId: string | null } }[] =
      await db.blockTrip.findMany({
        where:  { tripId: id },
        select: { vehicleBlockId: true, vehicleBlock: { select: { vehiclePlanId: true } } },
      })
    const blockIds = rows.map(r => r.vehicleBlockId)
    const planIds  = [...new Set(rows.map(r => r.vehicleBlock.vehiclePlanId).filter(Boolean) as string[])]

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
