import { Controller, UseGuards } from '@nestjs/common'
import { CrewShift, CreateCrewShiftDto, UpdateCrewShiftDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewShiftService } from './crew-shift.service'

@Controller('transit/crew-shift')
@UseGuards(JwtAuthGuard)
export class CrewShiftController extends BaseController<CrewShift, CreateCrewShiftDto, UpdateCrewShiftDto> {
  constructor(
    private readonly crewShiftService: CrewShiftService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(crewShiftService, caslFactory)
  }
}
