import { Controller, Post, Param, HttpCode, UseGuards } from '@nestjs/common'
import { VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { VehicleBlockService } from './vehicle-block.service'

@Controller('transit/vehicle-block')
@UseGuards(JwtAuthGuard)
export class VehicleBlockController extends BaseController<VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto> {
  constructor(
    private readonly vehicleBlockService: VehicleBlockService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(vehicleBlockService, caslFactory)
  }

  @Post(':id/lock')
  @HttpCode(200)
  lock(@Param('id') id: string) {
    return this.vehicleBlockService.lock(id)
  }

  @Post(':id/unlock')
  @HttpCode(200)
  unlock(@Param('id') id: string) {
    return this.vehicleBlockService.unlock(id)
  }
}
