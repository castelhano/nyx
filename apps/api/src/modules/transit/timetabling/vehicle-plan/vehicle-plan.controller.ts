import { Controller, Post, Get, Delete, Patch, Param, Body, Query, Req, Sse, UseGuards, HttpCode } from '@nestjs/common'
import { Observable } from 'rxjs'
import { VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto, vehiclePlanDiffSchema } from '@nyx/schemas'
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

  @Post(':id/optimize')
  @HttpCode(200)
  optimize(
    @Param('id') id: string,
    @Body('jobId') jobId: string,
    @Body('params') params: SolverParams,
    @Req() req: any,
  ) {
    const user: { role: string; branchIds: string[] } = req.user ?? { role: 'USER', branchIds: [] }
    return this.vehiclePlanService.optimize(id, jobId, params, user.branchIds, user.role)
  }

  @Post(':id/lines/:lineId/log-generation')
  @HttpCode(201)
  logGeneration(
    @Param('id')     id:          string,
    @Param('lineId') lineId:      string,
    @Body('dayTypeCode') dayTypeCode: string,
    @Body('output')      output:      unknown,
    @Req() req: any,
  ) {
    const user: { id: string } = req.user ?? {}
    return this.vehiclePlanService.logGeneration(id, lineId, dayTypeCode, output, user.id)
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

  // Single transactional entry point for the Gantt "Salvar" flow — replaces the old
  // add-trip/add-deadrun/add-interval/move-trip/deadruns/intervals/rescore endpoints.
  // See docs/proposal/vehicle-plan-summary-score-consolidation.md §2.4.
  @Patch(':id/apply-diff')
  @HttpCode(200)
  applyDiff(@Param('id') id: string, @Body() body: unknown) {
    const diff = vehiclePlanDiffSchema.parse(body)
    return this.vehiclePlanService.applyDiff(id, diff)
  }

  @Delete(':id/lines/:lineId')
  clearLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.vehiclePlanService.clearLine(id, lineId)
  }

  @Post(':id/lines/:lineId/sync-schedule')
  @HttpCode(200)
  syncLineSchedule(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.vehiclePlanService.syncLineSchedule(id, lineId)
  }

  @Post(':id/lines/:lineId/activate-new-schedule')
  @HttpCode(201)
  activateNewLineSchedule(
    @Param('id')     id:     string,
    @Param('lineId') lineId: string,
    @Body('approvalRef') approvalRef: string | undefined,
  ) {
    return this.vehiclePlanService.activateNewLineSchedule(id, lineId, approvalRef)
  }

  @Post(':id/lines/:lineId/schedules')
  @HttpCode(201)
  createLineSchedule(
    @Param('id')     id:     string,
    @Param('lineId') lineId: string,
    @Body() body: { approvalRef: string; notes?: string },
  ) {
    return this.vehiclePlanService.createLineSchedule(id, lineId, body)
  }

  @Post(':id/lines/:lineId/switch-schedule')
  @HttpCode(200)
  switchSchedule(
    @Param('id')     id:             string,
    @Param('lineId') lineId:         string,
    @Body('lineScheduleId') lineScheduleId: string,
  ) {
    return this.vehiclePlanService.switchLineSchedule(id, lineId, lineScheduleId)
  }

  @Get(':id/gantt-data')
  getGanttData(@Param('id') id: string) {
    return this.vehiclePlanService.getGanttData(id)
  }

  @Get(':id/lines/:lineId/comparison')
  getLineComparison(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.vehiclePlanService.getLineComparison(id, lineId)
  }

  @Get(':id/lines/:lineId/hourly')
  getLineHourlySeries(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.vehiclePlanService.getLineHourlySeries(id, lineId)
  }
}
