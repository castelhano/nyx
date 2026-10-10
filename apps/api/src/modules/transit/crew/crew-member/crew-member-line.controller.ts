import { Controller, UseGuards } from '@nestjs/common'
import { CrewMemberLine, CreateCrewMemberLineDto, UpdateCrewMemberLineDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewMemberLineService } from './crew-member-line.service'

@Controller('transit/crew-member-line')
@UseGuards(JwtAuthGuard)
export class CrewMemberLineController extends BaseController<CrewMemberLine, CreateCrewMemberLineDto, UpdateCrewMemberLineDto> {
  constructor(
    service: CrewMemberLineService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
