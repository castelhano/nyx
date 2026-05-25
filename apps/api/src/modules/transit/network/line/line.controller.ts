import { Controller, UseGuards } from '@nestjs/common'
import { Line, CreateLineDto, UpdateLineDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LineService } from './line.service'

@Controller('transit/line')
@UseGuards(JwtAuthGuard)
export class LineController extends BaseController<Line, CreateLineDto, UpdateLineDto> {
  constructor(
    private readonly lineService: LineService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(lineService, caslFactory)
  }
}
