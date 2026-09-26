import { Controller, Get, Post, Put, Delete, Param, Body, Req, HttpCode, UseGuards } from '@nestjs/common'
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

  // the plan's effective settings: { settings, isCustom }
  @Get(':id/settings')
  async getSettings(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assertAbility(req.user, 'read')
    return this.crewPlanService.resolveSettings(id)
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
