import { Injectable } from '@nestjs/common'
import { dayTypeSchema, DayType, CreateDayTypeDto, UpdateDayTypeDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class DayTypeService extends BaseService<DayType, CreateDayTypeDto, UpdateDayTypeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'dayType', dayTypeSchema, 'transit', 'branchId')
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { name: stringContains(search) },
        { code: stringContains(search) },
      ],
    }
  }
}
