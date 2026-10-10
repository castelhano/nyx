import { Controller, UseGuards } from '@nestjs/common'
import { CrewMember, CreateCrewMemberDto, UpdateCrewMemberDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewMemberService } from './crew-member.service'

@Controller('transit/crew-member')
@UseGuards(JwtAuthGuard)
export class CrewMemberController extends BaseController<CrewMember, CreateCrewMemberDto, UpdateCrewMemberDto> {
  constructor(
    service: CrewMemberService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
