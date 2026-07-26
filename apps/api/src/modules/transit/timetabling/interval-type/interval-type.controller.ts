import { Controller, UseGuards } from '@nestjs/common'
import { IntervalType, CreateIntervalTypeDto, UpdateIntervalTypeDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { IntervalTypeService } from './interval-type.service'

@Controller('transit/interval-type')
@UseGuards(JwtAuthGuard)
export class IntervalTypeController extends BaseController<IntervalType, CreateIntervalTypeDto, UpdateIntervalTypeDto> {
  constructor(
    private readonly intervalTypeService: IntervalTypeService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(intervalTypeService, caslFactory)
  }
}
