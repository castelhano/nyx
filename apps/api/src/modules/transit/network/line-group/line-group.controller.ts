import { Controller, UseGuards } from '@nestjs/common'
import { LineGroup, CreateLineGroupDto, UpdateLineGroupDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LineGroupService } from './line-group.service'

@Controller('transit/line-group')
@UseGuards(JwtAuthGuard)
export class LineGroupController extends BaseController<LineGroup, CreateLineGroupDto, UpdateLineGroupDto> {
  constructor(
    private readonly lineGroupService: LineGroupService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(lineGroupService, caslFactory)
  }
}
