import { Controller, UseGuards } from '@nestjs/common'
import { TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { TravelTimeService } from './travel-time.service'

@Controller('transit/travel-time')
@UseGuards(JwtAuthGuard)
export class TravelTimeController extends BaseController<TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto> {
  constructor(
    private readonly travelTimeService: TravelTimeService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(travelTimeService, caslFactory)
  }
}
