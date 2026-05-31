import { Controller, Post, Get, Delete, Patch, Param, Body, Query, Sse, UseGuards, HttpCode } from '@nestjs/common'
import { Observable } from 'rxjs'
import { VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard, JwtOrQueryGuard } from '../../../../auth/policies.guard'
import { VehiclePlanService } from './vehicle-plan.service'

@Controller('transit/vehicle-plan')
@UseGuards(JwtAuthGuard)
export class VehiclePlanController extends BaseController<VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto> {
  constructor(
    private readonly vehiclePlanService: VehiclePlanService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(vehiclePlanService, caslFactory)
  }

  @Post(':id/generate')
  @HttpCode(200)
  generate(@Param('id') id: string, @Body('jobId') jobId: string) {
    return this.vehiclePlanService.generate(id, jobId)
  }

  @Sse(':id/stream')
  @UseGuards(JwtOrQueryGuard)
  stream(
    @Param('id') _id: string,
    @Query('jobId') jobId: string,
  ): Observable<{ data: string }> {
    return this.vehiclePlanService.streamProgress(jobId)
  }

  @Post(':id/assume')
  @HttpCode(200)
  assume(@Param('id') id: string, @Body('jobId') jobId: string) {
    return this.vehiclePlanService.assumeBest(id, jobId)
  }

  @Post(':id/stop')
  @HttpCode(200)
  stop(@Param('id') _id: string, @Body('jobId') jobId: string) {
    return this.vehiclePlanService.stop(jobId)
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id') id: string) {
    return this.vehiclePlanService.activate(id)
  }

  @Post(':id/lines')
  @HttpCode(200)
  addLine(@Param('id') id: string, @Body('lineId') lineId: string) {
    return this.vehiclePlanService.addLine(id, lineId)
  }

  @Delete(':id/lines/:lineId')
  removeLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.vehiclePlanService.removeLine(id, lineId)
  }

  @Get(':id/gantt-data')
  getGanttData(@Param('id') id: string) {
    return this.vehiclePlanService.getGanttData(id)
  }
}
