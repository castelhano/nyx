import { Controller, Post, Param, Body, HttpCode, UseGuards } from '@nestjs/common'
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

  @Post(':id/access')
  @HttpCode(200)
  addAccess(
    @Param('id') blockId: string,
    @Body('blockTripId') blockTripId: string,
    @Body('depotLocalityId') depotLocalityId: string,
  ) {
    return this.vehicleBlockService.addAccess(blockId, blockTripId, depotLocalityId)
  }

  @Post(':id/return')
  @HttpCode(200)
  addReturn(
    @Param('id') blockId: string,
    @Body('blockTripId') blockTripId: string,
    @Body('depotLocalityId') depotLocalityId: string,
  ) {
    return this.vehicleBlockService.addReturn(blockId, blockTripId, depotLocalityId)
  }
}
