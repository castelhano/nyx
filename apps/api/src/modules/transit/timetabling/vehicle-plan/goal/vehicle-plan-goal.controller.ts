import { Controller, Get, Post, Param, Body, Req, UseGuards, HttpCode, ForbiddenException } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../../../../../auth/casl.factory'
import { JwtOrQueryGuard } from '../../../../../auth/policies.guard'
import { VehiclePlanGoalService } from './vehicle-plan-goal.service'

// Goal planning — docs/proposal/plan_goal_planning_v1.md. The analysis only reads the plan.
@Controller('transit/vehicle-plan')
@UseGuards(JwtOrQueryGuard)
export class VehiclePlanGoalController {
  constructor(
    private readonly goals:       VehiclePlanGoalService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get(':id/goal/options')
  async options(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assert(req.user, 'read')
    return this.goals.options(id)
  }

  @Post(':id/goal/analyze')
  @HttpCode(200)
  async analyze(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() body: unknown) {
    await this.assert(req.user, 'read')
    return this.goals.analyze(id, body)
  }

  private async assert(user: AuthUser | undefined, action: string): Promise<void> {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, 'VehiclePlan')) throw new ForbiddenException()
  }
}
