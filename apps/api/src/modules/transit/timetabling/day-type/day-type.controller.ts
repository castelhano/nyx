import { Controller, UseGuards } from '@nestjs/common'
import { DayType, CreateDayTypeDto, UpdateDayTypeDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { DayTypeService } from './day-type.service'

@Controller('transit/day-type')
@UseGuards(JwtAuthGuard)
export class DayTypeController extends BaseController<DayType, CreateDayTypeDto, UpdateDayTypeDto> {
  constructor(
    private readonly dayTypeService: DayTypeService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(dayTypeService, caslFactory)
  }
}
