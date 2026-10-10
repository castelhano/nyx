import { Controller, UseGuards } from '@nestjs/common'
import { RestPattern, CreateRestPatternDto, UpdateRestPatternDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { RestPatternService } from './rest-pattern.service'

@Controller('transit/rest-pattern')
@UseGuards(JwtAuthGuard)
export class RestPatternController extends BaseController<RestPattern, CreateRestPatternDto, UpdateRestPatternDto> {
  constructor(
    service: RestPatternService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
