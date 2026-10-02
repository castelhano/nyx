import { Controller, Get, Put, Body, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { TransitGeneralConfigService }   from './transit-general-config.service'
import { TransitPlanningConfigService }  from './transit-planning-config.service'
import { TransitCrewConfigService }      from './transit-crew-config.service'
import { TransitRosterConfigService }    from './transit-roster-config.service'
import { TransitCrewCostConfigService }  from './transit-crew-cost-config.service'

@Controller('transit/settings')
@UseGuards(JwtAuthGuard)
export class TransitSettingsController {
  constructor(
    private readonly general:  TransitGeneralConfigService,
    private readonly planning: TransitPlanningConfigService,
    private readonly crew:     TransitCrewConfigService,
    private readonly roster:   TransitRosterConfigService,
    private readonly crewCost: TransitCrewCostConfigService,
  ) {}

  @Get('general')
  getGeneral() {
    return this.general.get()
  }

  @Put('general')
  putGeneral(@Body() dto: unknown) {
    return this.general.put(dto)
  }

  // ?scope=<transit Scope.id> | global
  @Get('planning')
  getPlanning(@Query('scope') scope?: string) {
    const scopeId = scope && scope !== 'global' ? scope : undefined
    return this.planning.get(scopeId)
  }

  @Put('planning')
  putPlanning(@Body() dto: unknown, @Query('scope') scope?: string) {
    const scopeId = scope && scope !== 'global' ? scope : undefined
    return this.planning.put(dto, scopeId)
  }

  // ?scope=<transit Scope.id> | global
  @Get('crew')
  getCrew(@Query('scope') scope?: string) {
    const scopeId = scope && scope !== 'global' ? scope : undefined
    return this.crew.get(scopeId)
  }

  @Put('crew')
  putCrew(@Body() dto: unknown, @Query('scope') scope?: string) {
    const scopeId = scope && scope !== 'global' ? scope : undefined
    return this.crew.put(dto, scopeId)
  }

  // ?scope=<transit Scope.id> | global
  @Get('crew-cost')
  getCrewCost(@Query('scope') scope?: string) {
    const scopeId = scope && scope !== 'global' ? scope : undefined
    return this.crewCost.get(scopeId)
  }

  @Put('crew-cost')
  putCrewCost(@Body() dto: unknown, @Query('scope') scope?: string) {
    const scopeId = scope && scope !== 'global' ? scope : undefined
    return this.crewCost.put(dto, scopeId)
  }

  @Get('roster')
  getRoster() {
    return this.roster.get()
  }

  @Put('roster')
  putRoster(@Body() dto: unknown) {
    return this.roster.put(dto)
  }
}
