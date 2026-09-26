import { Controller, UseGuards } from '@nestjs/common'
import { DutyActivity, CreateDutyActivityDto, UpdateDutyActivityDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { DutyActivityService } from './duty-activity.service'

@Controller('transit/duty-activity')
@UseGuards(JwtAuthGuard)
export class DutyActivityController extends BaseController<DutyActivity, CreateDutyActivityDto, UpdateDutyActivityDto> {
  constructor(
    private readonly dutyActivityService: DutyActivityService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(dutyActivityService, caslFactory)
  }
}
