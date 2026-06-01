import { Controller, Post, HttpCode, UseGuards } from '@nestjs/common'
import { TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { TravelTimeService } from './travel-time.service'
import { OsrmService } from './osrm.service'

@Controller('transit/travel-time-matrix')
@UseGuards(JwtAuthGuard)
export class TravelTimeController extends BaseController<TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto> {
  constructor(
    private readonly travelTimeService: TravelTimeService,
    private readonly osrm: OsrmService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(travelTimeService, caslFactory)
  }

  @Post('generate')
  @HttpCode(200)
  generate() {
    return this.osrm.generateMatrix()
  }
}
