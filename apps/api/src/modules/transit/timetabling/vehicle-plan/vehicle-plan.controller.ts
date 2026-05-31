import { Controller, Post, Get, Delete, Param, Body, Query, Sse, UseGuards, HttpCode } from '@nestjs/common'
import { Observable } from 'rxjs'
import { VehiclePlanService } from './vehicle-plan.service'
import { JwtAuthGuard, JwtOrQueryGuard } from '../../../../auth/policies.guard'

@Controller('transit/vehicle-plan')
export class VehiclePlanController {
  constructor(private readonly service: VehiclePlanService) {}

  @Post(':id/generate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  generate(@Param('id') id: string, @Body('jobId') jobId: string) {
    return this.service.generate(id, jobId)
  }

  @Sse(':id/stream')
  @UseGuards(JwtOrQueryGuard)
  stream(
    @Param('id') _id: string,
    @Query('jobId') jobId: string,
  ): Observable<{ data: string }> {
    return this.service.streamProgress(jobId)
  }

  @Post(':id/assume')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  assume(@Param('id') id: string, @Body('jobId') jobId: string) {
    return this.service.assumeBest(id, jobId)
  }

  @Post(':id/stop')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  stop(@Param('id') _id: string, @Body('jobId') jobId: string) {
    return this.service.stop(jobId)
  }

  @Post(':id/activate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  activate(@Param('id') id: string) {
    return this.service.activate(id)
  }

  @Post(':id/lines')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  addLine(@Param('id') id: string, @Body('lineId') lineId: string) {
    return this.service.addLine(id, lineId)
  }

  @Delete(':id/lines/:lineId')
  @UseGuards(JwtAuthGuard)
  removeLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.service.removeLine(id, lineId)
  }

  @Get(':id/gantt-data')
  @UseGuards(JwtAuthGuard)
  getGanttData(@Param('id') id: string) {
    return this.service.getGanttData(id)
  }
}
