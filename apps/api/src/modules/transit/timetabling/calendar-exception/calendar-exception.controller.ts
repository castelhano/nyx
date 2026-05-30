import { Controller, UseGuards } from '@nestjs/common'
import { CalendarException, CreateCalendarExceptionDto, UpdateCalendarExceptionDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CalendarExceptionService } from './calendar-exception.service'

@Controller('transit/calendar-exception')
@UseGuards(JwtAuthGuard)
export class CalendarExceptionController extends BaseController<CalendarException, CreateCalendarExceptionDto, UpdateCalendarExceptionDto> {
  constructor(
    private readonly calendarExceptionService: CalendarExceptionService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(calendarExceptionService, caslFactory)
  }
}
