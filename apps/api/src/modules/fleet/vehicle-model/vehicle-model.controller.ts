import { Controller, UseGuards } from '@nestjs/common'
import { VehicleModel, CreateVehicleModelDto, UpdateVehicleModelDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { VehicleModelService } from './vehicle-model.service'

@Controller('fleet/vehicle-model')
@UseGuards(JwtAuthGuard)
export class VehicleModelController extends BaseController<VehicleModel, CreateVehicleModelDto, UpdateVehicleModelDto> {
  constructor(
    private readonly vehicleModelService: VehicleModelService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(vehicleModelService, caslFactory)
  }
}
