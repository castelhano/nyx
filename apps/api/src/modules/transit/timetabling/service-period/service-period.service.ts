import { Injectable } from '@nestjs/common'
import { servicePeriodSchema, ServicePeriod, CreateServicePeriodDto, UpdateServicePeriodDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class ServicePeriodService extends BaseService<ServicePeriod, CreateServicePeriodDto, UpdateServicePeriodDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'servicePeriod', servicePeriodSchema, 'transit', 'branchId')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }
}
