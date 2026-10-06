import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../../../../auth/policies.guard'
import { PlanExportService } from './plan-export.service'

@Controller('transit/vehicle-plan/:id/plan-export')
@UseGuards(JwtAuthGuard)
export class PlanExportController {
  constructor(private readonly service: PlanExportService) {}

  // lineIds = the lines selected in the plan's "Linhas" panel, comma-separated
  @Get('options')
  options(@Param('id') id: string, @Query('lineIds') lineIds = '') {
    return this.service.options(id, lineIds.split(',').filter(Boolean))
  }

  @Post('preview')
  preview(@Param('id') id: string, @Body() body: unknown) {
    return this.service.preview(id, body)
  }
}
