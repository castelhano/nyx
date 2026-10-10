import { BadRequestException, Injectable } from '@nestjs/common'
import { vehicleUnavailabilitySchema, VehicleUnavailability, CreateVehicleUnavailabilityDto, UpdateVehicleUnavailabilityDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

@Injectable()
export class VehicleUnavailabilityService extends BaseService<VehicleUnavailability, CreateVehicleUnavailabilityDto, UpdateVehicleUnavailabilityDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'vehicleUnavailability', vehicleUnavailabilitySchema, 'fleet')
  }

  protected buildSearchWhere(search: string) {
    return { reason: stringContains(search) }
  }

  override async create(dto: CreateVehicleUnavailabilityDto): Promise<VehicleUnavailability> {
    VehicleUnavailabilityService.assertRange(dto.startDate, dto.endDate)
    return super.create(dto)
  }

  override async update(id: string, dto: UpdateVehicleUnavailabilityDto): Promise<VehicleUnavailability> {
    const current = await this.findOne(id)
    VehicleUnavailabilityService.assertRange(dto.startDate ?? current.startDate, dto.endDate !== undefined ? dto.endDate : current.endDate)
    return super.update(id, dto)
  }

  private static assertRange(start: Date | string, end: Date | string | null | undefined): void {
    if (end && new Date(end) < new Date(start)) throw new BadRequestException('O fim não pode ser antes do início')
  }
}
