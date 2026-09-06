import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { lineDepartureSchema, LineDeparture, CreateLineDepartureDto, UpdateLineDepartureDto } from '@nyx/schemas'

@Injectable()
export class LineDepartureService extends BaseService<LineDeparture, CreateLineDepartureDto, UpdateLineDepartureDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineDeparture', lineDepartureSchema, 'transit')
  }
}
