import { Controller, UseGuards } from '@nestjs/common'
import { VehicleUnavailability, CreateVehicleUnavailabilityDto, UpdateVehicleUnavailabilityDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { VehicleUnavailabilityService } from './vehicle-unavailability.service'

@Controller('fleet/vehicle-unavailability')
@UseGuards(JwtAuthGuard)
export class VehicleUnavailabilityController extends BaseController<VehicleUnavailability, CreateVehicleUnavailabilityDto, UpdateVehicleUnavailabilityDto> {
  constructor(
    service: VehicleUnavailabilityService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
