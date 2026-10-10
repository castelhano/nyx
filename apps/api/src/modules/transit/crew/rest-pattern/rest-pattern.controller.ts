import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { RestPattern, CreateRestPatternDto, UpdateRestPatternDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { RestPatternService } from './rest-pattern.service'

@Controller('transit/rest-pattern')
@UseGuards(JwtAuthGuard)
export class RestPatternController extends BaseController<RestPattern, CreateRestPatternDto, UpdateRestPatternDto> {
  constructor(
    private readonly patterns: RestPatternService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(patterns, caslFactory)
  }

  // its crew members per shift and group
  @Get(':id/groups')
  async groups(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assertAbility(req.user, 'read')
    return this.patterns.groups(id)
  }

  @Post(':id/balance')
  @HttpCode(200)
  async balance(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assertAbility(req.user, 'update')
    return this.patterns.balance(id)
  }
}
