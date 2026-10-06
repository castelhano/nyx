import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { PlanCsvService } from './plan-csv.service'

// CSV export (M1 Detalhado / M2 Resumo) — returns the rows, the client writes the file
@Controller('transit')
@UseGuards(JwtAuthGuard)
export class PlanCsvController {
  constructor(private readonly service: PlanCsvService) {}

  @Get('vehicle-plan/:id/csv')
  vehiclePlan(@Param('id') id: string, @Query('model') model: string) {
    return this.service.vehiclePlan(id, model)
  }

  // view = the crew plan screen's view: duties (default) or vehicles
  @Get('crew-plan/:id/csv')
  crewPlan(@Param('id') id: string, @Query('model') model: string, @Query('view') view?: string) {
    return this.service.crewPlan(id, model, view)
  }
}
