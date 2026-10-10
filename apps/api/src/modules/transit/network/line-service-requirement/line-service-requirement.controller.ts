import { Controller, UseGuards } from '@nestjs/common'
import { LineServiceRequirement, CreateLineServiceRequirementDto, UpdateLineServiceRequirementDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LineServiceRequirementService } from './line-service-requirement.service'

@Controller('transit/line-service-requirement')
@UseGuards(JwtAuthGuard)
export class LineServiceRequirementController extends BaseController<LineServiceRequirement, CreateLineServiceRequirementDto, UpdateLineServiceRequirementDto> {
  constructor(
    private readonly lineServiceRequirementService: LineServiceRequirementService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(lineServiceRequirementService, caslFactory)
  }
}
