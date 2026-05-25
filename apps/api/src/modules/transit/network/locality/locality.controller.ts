import { Controller, UseGuards } from '@nestjs/common'
import { Locality, CreateLocalityDto, UpdateLocalityDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LocalityService } from './locality.service'

@Controller('transit/locality')
@UseGuards(JwtAuthGuard)
export class LocalityController extends BaseController<Locality, CreateLocalityDto, UpdateLocalityDto> {
  constructor(
    private readonly localityService: LocalityService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(localityService, caslFactory)
  }
}
