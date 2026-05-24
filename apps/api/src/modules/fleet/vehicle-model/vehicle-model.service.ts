import { Injectable } from '@nestjs/common'
import { vehicleModelSchema, VehicleModel, CreateVehicleModelDto, UpdateVehicleModelDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

@Injectable()
export class VehicleModelService extends BaseService<VehicleModel, CreateVehicleModelDto, UpdateVehicleModelDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'vehicleModel', vehicleModelSchema, 'fleet')
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ name: stringContains(search) }] }
  }
}
