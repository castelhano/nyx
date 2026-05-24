import { Injectable } from '@nestjs/common'
import { vehicleBrandSchema, VehicleBrand, CreateVehicleBrandDto, UpdateVehicleBrandDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

@Injectable()
export class VehicleBrandService extends BaseService<VehicleBrand, CreateVehicleBrandDto, UpdateVehicleBrandDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'vehicleBrand', vehicleBrandSchema, 'fleet')
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ name: stringContains(search) }] }
  }
}
