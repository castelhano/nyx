import { Controller, UseGuards } from '@nestjs/common'
import { LineDeparture, CreateLineDepartureDto, UpdateLineDepartureDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LineDepartureService } from './line-departure.service'

@Controller('transit/line-departure')
@UseGuards(JwtAuthGuard)
export class LineDepartureController extends BaseController<LineDeparture, CreateLineDepartureDto, UpdateLineDepartureDto> {
  constructor(
    private readonly lineDepartureService: LineDepartureService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(lineDepartureService, caslFactory)
  }
}
