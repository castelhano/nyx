import { Injectable } from '@nestjs/common'
import { intervalTypeSchema, IntervalType, CreateIntervalTypeDto, UpdateIntervalTypeDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class IntervalTypeService extends BaseService<IntervalType, CreateIntervalTypeDto, UpdateIntervalTypeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'intervalType', intervalTypeSchema, 'transit')
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
