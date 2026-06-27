import { Injectable } from '@nestjs/common'
import { travelTimeSchema, TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

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
}
