import { Injectable } from '@nestjs/common'
import { tripSchema, Trip, CreateTripDto, UpdateTripDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class TripService extends BaseService<Trip, CreateTripDto, UpdateTripDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transitTrip', tripSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    const asNumber = parseInt(search, 10)
    return isNaN(asNumber)
      ? {}
      : { OR: [{ departureMinutes: asNumber }, { arrivalMinutes: asNumber }] }
  }
}
