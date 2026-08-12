import { Controller, Post, Delete, Patch, Param, Body, HttpCode, UseGuards } from '@nestjs/common'
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

  @Patch(':id/move-trip')
  @HttpCode(200)
  moveTrip(
    @Param('id') blockId: string,
    @Body('blockTripIds') blockTripIds: string[],
    @Body('targetBlockId') targetBlockId: string,
    @Body('breakIds') breakIds?: string[],
    @Body('deadrunIds') deadrunIds?: string[],
  ) {
    return this.vehicleBlockService.moveTrip(blockId, blockTripIds, targetBlockId, breakIds ?? [], deadrunIds ?? [])
  }

  @Patch(':id/deadruns')
  @HttpCode(200)
  updateDeadruns(
    @Param('id') blockId: string,
    @Body('updates') updates: { id: string; departureMinutes: number; arrivalMinutes: number }[],
  ) {
    return this.vehicleBlockService.updateDeadruns(blockId, updates)
  }

  @Delete(':id/deadruns')
  deleteDeadruns(
    @Param('id') blockId: string,
    @Body('ids') ids: string[],
  ) {
    return this.vehicleBlockService.deleteDeadruns(blockId, ids)
  }

  @Patch(':id/intervals')
  @HttpCode(200)
  updateIntervals(
    @Param('id') blockId: string,
    @Body('updates') updates: { id: string; departureMinutes: number; arrivalMinutes: number }[],
  ) {
    return this.vehicleBlockService.updateIntervals(blockId, updates)
  }

  @Delete(':id/intervals')
  deleteIntervals(
    @Param('id') blockId: string,
    @Body('ids') ids: string[],
  ) {
    return this.vehicleBlockService.deleteIntervals(blockId, ids)
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
