import { Controller, UseGuards } from '@nestjs/common'
import { CrewMemberShift, CreateCrewMemberShiftDto, UpdateCrewMemberShiftDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewMemberShiftService } from './crew-member-shift.service'

@Controller('transit/crew-member-shift')
@UseGuards(JwtAuthGuard)
export class CrewMemberShiftController extends BaseController<CrewMemberShift, CreateCrewMemberShiftDto, UpdateCrewMemberShiftDto> {
  constructor(
    service: CrewMemberShiftService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
