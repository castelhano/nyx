import { Controller, UseGuards } from '@nestjs/common'
import { Trip, CreateTripDto, UpdateTripDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { TripService } from './trip.service'

@Controller('transit/transit-trip')
@UseGuards(JwtAuthGuard)
export class TripController extends BaseController<Trip, CreateTripDto, UpdateTripDto> {
  constructor(
    private readonly tripService: TripService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(tripService, caslFactory)
  }
}
