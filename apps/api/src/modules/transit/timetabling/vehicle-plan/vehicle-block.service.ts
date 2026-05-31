import { Injectable } from '@nestjs/common'
import { vehicleBlockSchema, VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class VehicleBlockService extends BaseService<VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'vehicleBlock', vehicleBlockSchema, 'transit')
  }

  protected buildSearchWhere(_search: string) {
    return {}
  }
}
