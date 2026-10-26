import { Controller, UseGuards } from '@nestjs/common'
import { CrewRoleJobTitle, CreateCrewRoleJobTitleDto, UpdateCrewRoleJobTitleDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewRoleJobTitleService } from './crew-role-job-title.service'

@Controller('transit/crew-role-job-title')
@UseGuards(JwtAuthGuard)
export class CrewRoleJobTitleController extends BaseController<CrewRoleJobTitle, CreateCrewRoleJobTitleDto, UpdateCrewRoleJobTitleDto> {
  constructor(
    service: CrewRoleJobTitleService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
