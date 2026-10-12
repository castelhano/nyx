import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { CrewMemberLine, CreateCrewMemberLineDto, UpdateCrewMemberLineDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewMemberLineService } from './crew-member-line.service'

@Controller('transit/crew-member-line')
@UseGuards(JwtAuthGuard)
export class CrewMemberLineController extends BaseController<CrewMemberLine, CreateCrewMemberLineDto, UpdateCrewMemberLineDto> {
  constructor(
    private readonly lines: CrewMemberLineService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(lines, caslFactory)
  }

  // the operator's lines screen (every line his empresa operates + his rows)
  @Get('board/:crewMemberId')
  async board(@Req() req: { user?: AuthUser }, @Param('crewMemberId') crewMemberId: string) {
    await this.assertAbility(req.user, 'read')
    return this.lines.board(crewMemberId)
  }

  @Put('board/:crewMemberId')
  async replaceAll(@Req() req: { user?: AuthUser }, @Param('crewMemberId') crewMemberId: string, @Body('entries') entries: unknown, @Body('standby') standby: unknown) {
    await this.assertAbility(req.user, 'update')
    return this.lines.replaceAll(crewMemberId, entries, standby)
  }
}
