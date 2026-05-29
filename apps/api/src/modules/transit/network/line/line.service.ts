import { Injectable } from '@nestjs/common'
import { lineSchema, Line, CreateLineDto, UpdateLineDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class LineService extends BaseService<Line, CreateLineDto, UpdateLineDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transitLine', lineSchema, 'transit')
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
