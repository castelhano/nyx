import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, HttpCode, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { CrewPlan, CreateCrewPlanDto, UpdateCrewPlanDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewPlanService } from './crew-plan.service'

@Controller('transit/crew-plan')
@UseGuards(JwtAuthGuard)
export class CrewPlanController extends BaseController<CrewPlan, CreateCrewPlanDto, UpdateCrewPlanDto> {
  constructor(
    private readonly crewPlanService: CrewPlanService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(crewPlanService, caslFactory)
  }

  // two path segments — doesn't clash with the inherited GET ':id'
  @Get('for-vehicle-plan/:vehiclePlanId')
  async forVehiclePlan(@Req() req: { user?: AuthUser }, @Param('vehiclePlanId') vehiclePlanId: string) {
    await this.assertAbility(req.user, 'read')
    return this.crewPlanService.resolveForVehiclePlan(vehiclePlanId)
  }

  // ?recalculate=1 — on opening the plan (see CrewPlanService.getBoard)
  @Get(':id/board')
  async board(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Query('recalculate') recalculate?: string) {
    await this.assertAbility(req.user, 'read')
    return this.crewPlanService.getBoard(id, recalculate === '1')
  }

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body('startDate') startDate: unknown, @Body('confirm') confirm?: boolean) {
    await this.assertAbility(req.user, 'update')
    return this.crewPlanService.activate(id, startDate, confirm === true)
  }

  @Post(':id/duplicate')
  async duplicate(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assertAbility(req.user, 'create')
    return this.crewPlanService.duplicate(id)
  }

  // the plan's effective settings: { settings, isCustom, inherited }
  @Get(':id/settings')
  async getSettings(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assertAbility(req.user, 'read')
    return this.crewPlanService.getSettingsView(id)
  }

  // "Customize" — copies the effective settings (Scope/global) into the plan
  @Post(':id/settings/customize')
  @HttpCode(200)
  async customizeSettings(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assertAbility(req.user, 'update')
    return this.crewPlanService.customizeSettings(id)
  }

  @Put(':id/settings')
  async putSettings(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() dto: unknown) {
    await this.assertAbility(req.user, 'update')
    return this.crewPlanService.putSettings(id, dto)
  }

  // "Restore default" — goes back to inheriting Scope/global
  @Delete(':id/settings')
  async resetSettings(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assertAbility(req.user, 'update')
    return this.crewPlanService.resetSettings(id)
  }
}
