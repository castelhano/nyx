import { Body, Controller, ForbiddenException, Get, HttpCode, Ip, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { PortalAuthService } from './portal-auth.service'
import { PortalGuard, PortalOpenFor, type PortalRequest } from './portal.guard'
import { PortalService } from './portal.service'

// The crew portal (/api/portal/*) — its own login and guard, never the staff JWT
@Controller('portal')
export class PortalController {
  constructor(
    private readonly auth:   PortalAuthService,
    private readonly portal: PortalService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  login(@Body() body: unknown, @Ip() ip: string) {
    return this.auth.login(body, ip)
  }

  @Post('auth/change-pin')
  @HttpCode(204)
  @UseGuards(PortalGuard)
  @PortalOpenFor('pin')
  async changePin(@Req() req: PortalRequest, @Body() body: unknown) {
    await this.auth.changePin(req.crew!.id, body)
  }

  @Get('me')
  @UseGuards(PortalGuard)
  @PortalOpenFor('always')
  me(@Req() req: PortalRequest) {
    return this.portal.me(req.crew!)
  }

  @Get('notifications')
  @UseGuards(PortalGuard)
  @PortalOpenFor('notifications')
  notifications(@Req() req: PortalRequest) {
    return this.portal.notifications(req.crew!)
  }

  // "Li e confirmo" — ids: the ones read; none: every unread one
  @Post('notifications/ack')
  @HttpCode(200)
  @UseGuards(PortalGuard)
  @PortalOpenFor('notifications')
  ack(@Req() req: PortalRequest, @Body() body: { ids?: string[] } | undefined) {
    return this.portal.ack(req.crew!, Array.isArray(body?.ids) ? body.ids : undefined)
  }

  @Get('roster')
  @UseGuards(PortalGuard)
  roster(@Req() req: PortalRequest, @Query('from') from: string, @Query('to') to: string) {
    return this.portal.roster(req.crew!, from, to)
  }

  @Get('occurrences')
  @UseGuards(PortalGuard)
  requests(@Req() req: PortalRequest) {
    return this.portal.requests(req.crew!)
  }

  @Post('occurrences')
  @UseGuards(PortalGuard)
  request(@Req() req: PortalRequest, @Body() body: unknown) {
    return this.portal.request(req.crew!, body)
  }

  // his quotas and how much is used in the period holding `date`
  @Get('quotas')
  @UseGuards(PortalGuard)
  quotas(@Req() req: PortalRequest, @Query('date') date?: string) {
    return this.portal.quotas(req.crew!, date)
  }

  @Get('preferred-lines')
  @UseGuards(PortalGuard)
  @PortalOpenFor('lines')
  preferredLines(@Req() req: PortalRequest) {
    return this.portal.preferredLines(req.crew!)
  }

  @Put('preferred-lines')
  @UseGuards(PortalGuard)
  @PortalOpenFor('lines')
  setPreferredLines(@Req() req: PortalRequest, @Body() body: unknown) {
    return this.portal.setPreferredLines(req.crew!, body)
  }
}

// Staff side: a crew member's portal PIN back to the first one (the CPF's first 6 digits)
@Controller('transit/crew-member')
@UseGuards(JwtAuthGuard)
export class PortalAccessController {
  constructor(
    private readonly auth:        PortalAuthService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Post(':id/portal-pin/reset')
  @HttpCode(204)
  async resetPin(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    if (req.user) {
      const ability = await this.caslFactory.createForUser(req.user)
      if (!ability.can('update', 'CrewMember')) throw new ForbiddenException()
    }
    await this.auth.resetPin(id)
  }
}
