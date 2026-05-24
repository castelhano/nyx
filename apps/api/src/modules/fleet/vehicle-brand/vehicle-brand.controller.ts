import { Controller, UseGuards } from '@nestjs/common'
import { VehicleBrand, CreateVehicleBrandDto, UpdateVehicleBrandDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { VehicleBrandService } from './vehicle-brand.service'

@Controller('fleet/vehicle-brand')
@UseGuards(JwtAuthGuard)
export class VehicleBrandController extends BaseController<VehicleBrand, CreateVehicleBrandDto, UpdateVehicleBrandDto> {
  constructor(
    private readonly vehicleBrandService: VehicleBrandService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(vehicleBrandService, caslFactory)
  }
}
