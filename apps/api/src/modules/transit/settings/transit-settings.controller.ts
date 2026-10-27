import { Controller, Get, Put, Delete, Body, Query, UseGuards } from '@nestjs/common'
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

  // the scope/branch ids with their own row, per settings key
  @Get('overrides')
  async getOverrides() {
    const [planning, crew, crewCost, roster] = await Promise.all([
      this.planning.overrides(), this.crew.overrides(), this.crewCost.overrides(), this.roster.overrides(),
    ])
    return { planning, crew, crewCost, roster }
  }

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

  @Delete('planning')
  deletePlanning(@Query('scope') scope?: string) {
    return this.planning.removeOverride(scope)
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

  @Delete('crew')
  deleteCrew(@Query('scope') scope?: string) {
    return this.crew.removeOverride(scope)
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

  @Delete('crew-cost')
  deleteCrewCost(@Query('scope') scope?: string) {
    return this.crewCost.removeOverride(scope)
  }

  // ?branch=<Branch.id> | global
  @Get('roster')
  getRoster(@Query('branch') branch?: string) {
    const branchId = branch && branch !== 'global' ? branch : undefined
    return this.roster.get(branchId)
  }

  @Put('roster')
  putRoster(@Body() dto: unknown, @Query('branch') branch?: string) {
    const branchId = branch && branch !== 'global' ? branch : undefined
    return this.roster.put(dto, branchId)
  }

  @Delete('roster')
  deleteRoster(@Query('branch') branch?: string) {
    return this.roster.removeOverride(branch)
  }
}
