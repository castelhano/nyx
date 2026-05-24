import { Injectable } from '@nestjs/common'
import { vehicleSchema, Vehicle, CreateVehicleDto, UpdateVehicleDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

@Injectable()
export class VehicleService extends BaseService<Vehicle, CreateVehicleDto, UpdateVehicleDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'vehicle', vehicleSchema, 'fleet', 'branchId')
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { plate:   stringContains(search) },
        { renavam: stringContains(search) },
        { chassis: stringContains(search) },
      ],
    }
  }
}
