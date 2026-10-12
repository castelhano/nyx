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
    // users only look vehicles up by their code (prefixo)
    return { code: stringContains(search) }
  }
}
