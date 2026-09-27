import { Controller, Post, Param, Body, Req, HttpCode, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { Duty, CreateDutyDto, UpdateDutyDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { DutyService } from './duty.service'

@Controller('transit/duty')
@UseGuards(JwtAuthGuard)
export class DutyController extends BaseController<Duty, CreateDutyDto, UpdateDutyDto> {
  constructor(
    private readonly dutyService: DutyService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(dutyService, caslFactory)
  }

  // body: { locked: boolean }
  @Post(':id/lock')
  @HttpCode(200)
  async lock(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() body: { locked?: unknown }) {
    await this.assertAbility(req.user, 'update')
    return this.dutyService.setLocked(id, body?.locked === true)
  }
}
