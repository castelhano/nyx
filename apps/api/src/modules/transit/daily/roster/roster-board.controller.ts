import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import type { CrewRole } from '@nyx/schemas'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { DailyOperationService } from '../daily-operation.service'
import { RosterBoardService } from './roster-board.service'

// The "Escala" screen: the period's board and the edits made by date (no day id needed).
// Duty/vehicle/lock edits go through transit/daily-operation/:id/…
@Controller('transit/roster-board')
@UseGuards(JwtAuthGuard)
export class RosterBoardController {
  constructor(
    private readonly boards:      RosterBoardService,
    private readonly daily:       DailyOperationService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get()
  async board(@Req() req: { user?: AuthUser }, @Query('branchId') branchId: string, @Query('role') role: CrewRole, @Query('from') from: string, @Query('to') to: string) {
    await this.assert(req.user, 'read')
    return this.boards.board(branchId, role || 'DRIVER', from, to)
  }

  // the best crew members for a duty (side panel)
  @Get('suggest')
  async suggest(@Req() req: { user?: AuthUser }, @Query('dutyId') dutyId: string) {
    await this.assert(req.user, 'read')
    return { suggestions: await this.boards.suggest(dutyId) }
  }

  // several duties at once (block edits, paste)
  @Post('assign')
  @HttpCode(204)
  async assign(@Req() req: { user?: AuthUser }, @Body() body: { items: { dutyId: string; crewMemberId: string | null }[] }) {
    await this.assert(req.user, 'update')
    await this.daily.assignMany(Array.isArray(body?.items) ? body.items : [], req.user?.id)
  }

  // two crew members swap what they have on the date
  @Post('swap')
  @HttpCode(204)
  async swap(@Req() req: { user?: AuthUser }, @Body() body: { date: string; a: string; b: string }) {
    await this.assert(req.user, 'update')
    await this.daily.swapDay(body.date, body.a, body.b, req.user?.id)
  }

  // days off for several crew members / dates
  @Put('day-off')
  @HttpCode(204)
  async dayOff(@Req() req: { user?: AuthUser }, @Body() body: { items: { date: string; crewMemberId: string }[]; kind: 'DAY_OFF' | 'COMP_OFF' | null; absenceTypeId?: string | null }) {
    await this.assert(req.user, 'update')
    await this.daily.setDayOffMany(Array.isArray(body?.items) ? body.items : [], body?.kind || null, req.user?.id, body?.absenceTypeId || null)
  }

  private async assert(user: AuthUser | undefined, action: string): Promise<void> {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, 'DailyOperation')) throw new ForbiddenException()
  }
}
