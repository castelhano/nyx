import { Controller, UseGuards } from '@nestjs/common'
import { CrewAbsenceType, CreateCrewAbsenceTypeDto, UpdateCrewAbsenceTypeDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewAbsenceTypeService } from './crew-absence-type.service'

@Controller('transit/crew-absence-type')
@UseGuards(JwtAuthGuard)
export class CrewAbsenceTypeController extends BaseController<CrewAbsenceType, CreateCrewAbsenceTypeDto, UpdateCrewAbsenceTypeDto> {
  constructor(
    service: CrewAbsenceTypeService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
