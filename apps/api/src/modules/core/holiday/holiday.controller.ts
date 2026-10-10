import { Controller, UseGuards } from '@nestjs/common'
import { Holiday, CreateHolidayDto, UpdateHolidayDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { HolidayService } from './holiday.service'

@Controller('core/holiday')
@UseGuards(JwtAuthGuard)
export class HolidayController extends BaseController<Holiday, CreateHolidayDto, UpdateHolidayDto> {
  constructor(
    service: HolidayService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
