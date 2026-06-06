import { Controller, Get, Put, Body, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { TransitGeneralConfigService }   from './transit-general-config.service'
import { TransitPlanningConfigService }  from './transit-planning-config.service'
import { TransitScheduleConfigService }  from './transit-schedule-config.service'

@Controller('transit/settings')
@UseGuards(JwtAuthGuard)
export class TransitSettingsController {
  constructor(
    private readonly general:  TransitGeneralConfigService,
    private readonly planning: TransitPlanningConfigService,
    private readonly schedule: TransitScheduleConfigService,
  ) {}

  @Get('general')
  getGeneral() {
    return this.general.get()
  }

  @Put('general')
  putGeneral(@Body() dto: unknown) {
    return this.general.put(dto)
  }

  @Get('planning')
  getPlanning(@Query('scope') scope?: string) {
    const branchId = scope && scope !== 'global' ? scope : undefined
    return this.planning.get(branchId)
  }

  @Put('planning')
  putPlanning(@Body() dto: unknown, @Query('scope') scope?: string) {
    const branchId = scope && scope !== 'global' ? scope : undefined
    return this.planning.put(dto, branchId)
  }

  @Get('schedule')
  getSchedule(@Query('scope') scope?: string) {
    const branchId = scope && scope !== 'global' ? scope : undefined
    return this.schedule.get(branchId)
  }

  @Put('schedule')
  putSchedule(@Body() dto: unknown, @Query('scope') scope?: string) {
    const branchId = scope && scope !== 'global' ? scope : undefined
    return this.schedule.put(dto, branchId)
  }
}
