import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { DailyOperation, CreateDailyOperationDto, UpdateDailyOperationDto } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { DailyOperationService } from './daily-operation.service'

type Req = { user?: AuthUser }

@Controller('transit/daily-operation')
@UseGuards(JwtAuthGuard)
export class DailyOperationController extends BaseController<DailyOperation, CreateDailyOperationDto, UpdateDailyOperationDto> {
  constructor(
    private readonly daily: DailyOperationService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(daily, caslFactory)
  }

  @Get(':id/board')
  async board(@Req() req: Req, @Param('id') id: string) {
    await this.assertAbility(req.user, 'read')
    return this.daily.getBoard(id)
  }

  @Post(':id/recalculate')
  @HttpCode(204)
  async recalc(@Req() req: Req, @Param('id') id: string) {
    await this.assertAbility(req.user, 'update')
    await this.daily.recalculate(id)
  }

  @Post(':id/rematerialize')
  async rematerialize(@Req() req: Req, @Param('id') id: string) {
    await this.assertAbility(req.user, 'update')
    return this.daily.rematerialize(id)
  }

  @Post(':id/publish')
  @HttpCode(204)
  async publish(@Req() req: Req, @Param('id') id: string) {
    await this.assertAbility(req.user, 'update')
    await this.daily.setStatus(id, 'PUBLISHED')
  }

  @Post(':id/close')
  @HttpCode(204)
  async close(@Req() req: Req, @Param('id') id: string) {
    await this.assertAbility(req.user, 'update')
    await this.daily.setStatus(id, 'CLOSED')
  }

  // unpublish / reopen — admins only, with a reason
  @Post(':id/revert')
  @HttpCode(204)
  async revert(@Req() req: Req, @Param('id') id: string, @Body('reason') reason: string) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('Somente administradores podem voltar o status do dia')
    await this.daily.revertStatus(id, reason, req.user?.id)
  }

  @Put(':id/duty/:dutyId/crew')
  @HttpCode(204)
  async assignCrew(@Req() req: Req, @Param('id') id: string, @Param('dutyId') dutyId: string, @Body('crewMemberId') crewMemberId: string | null) {
    await this.assertAbility(req.user, 'update')
    await this.daily.assignCrew(id, dutyId, crewMemberId || null, req.user?.id)
  }

  @Put(':id/duty/:dutyId/lock')
  @HttpCode(204)
  async lock(@Req() req: Req, @Param('id') id: string, @Param('dutyId') dutyId: string, @Body('locked') locked: boolean) {
    await this.assertAbility(req.user, 'update')
    await this.daily.setLocked(id, dutyId, !!locked)
  }

  @Put(':id/block/:blockId/vehicle')
  @HttpCode(204)
  async assignVehicle(@Req() req: Req, @Param('id') id: string, @Param('blockId') blockId: string, @Body('vehicleId') vehicleId: string | null) {
    await this.assertAbility(req.user, 'update')
    await this.daily.assignVehicle(id, blockId, vehicleId || null, req.user?.id)
  }

  @Put(':id/trip/:eventId/cancelled')
  @HttpCode(204)
  async cancelTrip(@Req() req: Req, @Param('id') id: string, @Param('eventId') eventId: string, @Body('cancelled') cancelled: boolean) {
    await this.assertAbility(req.user, 'update')
    await this.daily.setTripCancelled(id, eventId, !!cancelled, req.user?.id)
  }

  @Put(':id/crew/:crewMemberId/day-off')
  @HttpCode(204)
  async dayOff(@Req() req: Req, @Param('id') id: string, @Param('crewMemberId') crewMemberId: string, @Body('kind') kind: 'DAY_OFF' | 'COMP_OFF' | null) {
    await this.assertAbility(req.user, 'update')
    await this.daily.setDayOff(id, crewMemberId, kind === 'DAY_OFF' || kind === 'COMP_OFF' ? kind : null, req.user?.id)
  }
}
