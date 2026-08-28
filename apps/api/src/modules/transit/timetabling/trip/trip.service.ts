import { Injectable } from '@nestjs/common'
import { tripSchema, Trip, CreateTripDto, UpdateTripDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { VehiclePlanService } from '../vehicle-plan/vehicle-plan.service'
import { beforeTripUpdate, afterTripUpdate, applyTripRemoval } from './trip-mutation.utils'

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
    const existing = await beforeTripUpdate(this.prisma, id)
    const result   = await super.update(id, dto)
    await afterTripUpdate(this.prisma, id, existing, dto, result)
    return result
  }

  override async remove(id: string): Promise<void> {
    const { affectedPlanIds } = await applyTripRemoval(this.prisma, id)
    for (const planId of affectedPlanIds) {
      await this.vehiclePlanService.recalculate(planId)
    }
  }
}
