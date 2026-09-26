import { Controller, UseGuards } from '@nestjs/common'
import { Duty, CreateDutyDto, UpdateDutyDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { DutyService } from './duty.service'

@Controller('transit/duty')
@UseGuards(JwtAuthGuard)
export class DutyController extends BaseController<Duty, CreateDutyDto, UpdateDutyDto> {
  constructor(
    private readonly dutyService: DutyService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(dutyService, caslFactory)
  }
}
