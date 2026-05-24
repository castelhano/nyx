import { Controller, UseGuards } from '@nestjs/common'
import { Vehicle, CreateVehicleDto, UpdateVehicleDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { VehicleService } from './vehicle.service'

@Controller('fleet/vehicle')
@UseGuards(JwtAuthGuard)
export class VehicleController extends BaseController<Vehicle, CreateVehicleDto, UpdateVehicleDto> {
  constructor(
    private readonly vehicleService: VehicleService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(vehicleService, caslFactory)
  }
}
