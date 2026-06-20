import { Controller, Post, Get, Delete, Param, Body, Query, Req, Sse, UseGuards, HttpCode } from '@nestjs/common'
import { Observable } from 'rxjs'
import { VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtOrQueryGuard } from '../../../../auth/policies.guard'
import { VehiclePlanService } from './vehicle-plan.service'
import type { SolverParams } from './solver/solver.types'

// JwtOrQueryGuard at class level covers both normal Bearer-header auth and the SSE
// stream endpoint, which passes the JWT as ?token= because EventSource cannot set headers.
@Controller('transit/vehicle-plan')
@UseGuards(JwtOrQueryGuard)
export class VehiclePlanController extends BaseController<VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto> {
  constructor(
    private readonly vehiclePlanService: VehiclePlanService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(vehiclePlanService, caslFactory)
  }

  @Post(':id/generate')
  @HttpCode(200)
  generate(
    @Param('id') id: string,
    @Body('jobId') jobId: string,
    @Body('params') params: SolverParams,
    @Req() req: any,
  ) {
    const user: { role: string; branchIds: string[] } = req.user ?? { role: 'USER', branchIds: [] }
    return this.vehiclePlanService.generate(id, jobId, params, user.branchIds, user.role)
  }

  @Sse(':id/stream')
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

  @Post(':id/duplicate')
  @HttpCode(201)
  duplicate(@Param('id') id: string) {
    return this.vehiclePlanService.duplicate(id)
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id') id: string, @Body('force') force: boolean) {
    return this.vehiclePlanService.activate(id, force ?? false)
  }

  @Post(':id/add-trip')
  @HttpCode(201)
  addTrip(
    @Param('id') id: string,
    @Body() body: { routeId: string; departureMinutes: number; arrivalMinutes: number; blockId?: string },
  ) {
    return this.vehiclePlanService.addTrip(id, body)
  }

  @Post(':id/add-deadrun')
  @HttpCode(201)
  addDeadrun(
    @Param('id') id: string,
    @Body() body: { originLocalityId: string; destinationLocalityId: string; departureMinutes: number; arrivalMinutes: number; blockId?: string },
  ) {
    return this.vehiclePlanService.addDeadrun(id, body)
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
