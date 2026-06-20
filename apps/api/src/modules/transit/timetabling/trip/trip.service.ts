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

  override async update(id: string, dto: UpdateTripDto): Promise<Trip> {
    const result = await super.update(id, dto)
    await this.prisma.vehicleBlock.updateMany({
      where: { blockTrips: { some: { tripId: id } } },
      data:  { isStale: true },
    })
    return result
  }

  override async remove(id: string): Promise<void> {
    const db = this.prisma as any

    // Capture which blocks held this trip before cascade-deletes it
    const rows: { vehicleBlockId: string }[] = await db.blockTrip.findMany({
      where:  { tripId: id },
      select: { vehicleBlockId: true },
    })
    const blockIds = rows.map(r => r.vehicleBlockId)

    await super.remove(id)  // deletes TransitTrip → cascades BlockTrip

    // Delete every block that is now completely empty (no trips left)
    if (blockIds.length > 0) {
      await db.vehicleBlock.deleteMany({
        where: { id: { in: blockIds }, blockTrips: { none: {} } },
      })
    }
  }
}
