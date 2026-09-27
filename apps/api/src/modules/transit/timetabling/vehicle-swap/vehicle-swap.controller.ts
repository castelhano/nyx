import { Controller, Get, Post, Param, Body, Req, HttpCode, UseGuards, ForbiddenException } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { VehicleSwapService } from './vehicle-swap.service'

// Crew plan sub-routes — applying edits both the crew plans and the VehiclePlan, so it
// needs update on both.
@Controller('transit/crew-plan')
@UseGuards(JwtAuthGuard)
export class VehicleSwapController {
  constructor(
    private readonly swaps:       VehicleSwapService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get(':id/vehicle-swaps')
  async analyze(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assert(req.user, [['read', 'CrewPlan']])
    return this.swaps.analyze(id)
  }

  @Post(':id/vehicle-swaps/apply')
  @HttpCode(200)
  async apply(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() body: { keys?: string[] }) {
    await this.assert(req.user, [['update', 'CrewPlan'], ['update', 'VehiclePlan']])
    return this.swaps.apply(id, body?.keys ?? [])
  }

  private async assert(user: AuthUser | undefined, rules: [string, string][]): Promise<void> {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (rules.some(([action, subject]) => !ability.can(action, subject))) throw new ForbiddenException()
  }
}
