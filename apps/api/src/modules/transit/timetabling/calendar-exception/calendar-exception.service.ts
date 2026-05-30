import { Injectable } from '@nestjs/common'
import { calendarExceptionSchema, CalendarException, CreateCalendarExceptionDto, UpdateCalendarExceptionDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class CalendarExceptionService extends BaseService<CalendarException, CreateCalendarExceptionDto, UpdateCalendarExceptionDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineCalendarException', calendarExceptionSchema, 'transit')
  }
}
