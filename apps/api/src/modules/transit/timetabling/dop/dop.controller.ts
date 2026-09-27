import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common'
import { dopSchema, type DopPeriodSummary, type DopCrewPeriodSummary } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { buildMetadata } from '../../../../core/metadata.builder'
import { DopService } from './dop.service'
import { DopCrewService } from './dop-crew.service'
import { parseDay } from './dop-resolution'

// No BaseController here — DOP is a single computed GET, not CRUD (docs/proposal/
// plan_dop_v1.md, decisão 3). The metadata endpoint is still needed even though
// there's no CRUD: it's what usePageGuard()/useMetadata() on the frontend read to
// gate the page on the 'Dop' CASL subject, same as every other resource's page.
@Controller('transit/dop')
@UseGuards(JwtAuthGuard)
export class DopController {
  constructor(
    private readonly dopService:  DopService,
    private readonly dopCrew:     DopCrewService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get('metadata')
  async getMetadata(@Req() req: { user?: AuthUser }) {
    const meta = buildMetadata('dop', dopSchema)
    if (!req.user) return meta

    const ability = await this.caslFactory.createForUser(req.user)
    return {
      ...meta,
      permissions: {
        create: ability.can('create', 'Dop'),
        read:   ability.can('read',   'Dop'),
        update: ability.can('update', 'Dop'),
        delete: ability.can('delete', 'Dop'),
      },
    }
  }

  @Get()
  async get(
    @Req() req: { user: AuthUser },
    @Query('scopeId') scopeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ): Promise<DopPeriodSummary> {
    const { fromDate, toDate } = await this.checkRequest(req.user, scopeId, from, to)
    return this.dopService.getPeriodSummary(scopeId, fromDate, toDate, branchId || undefined)
  }

  // visão Escala — same params as the vehicle view (docs/proposal/plan_dop_crew_v1.md)
  @Get('crew')
  async getCrew(
    @Req() req: { user: AuthUser },
    @Query('scopeId') scopeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ): Promise<DopCrewPeriodSummary> {
    const { fromDate, toDate } = await this.checkRequest(req.user, scopeId, from, to)
    return this.dopCrew.getPeriodSummary(scopeId, fromDate, toDate, branchId || undefined)
  }

  private async checkRequest(user: AuthUser, scopeId: string, from: string, to: string) {
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can('read', 'Dop')) throw new ForbiddenException()
    if (!scopeId || !from || !to) throw new BadRequestException('scopeId, from e to são obrigatórios')
    const fromDate = parseDay(from)
    const toDate   = parseDay(to)
    if (!fromDate || !toDate || fromDate > toDate) throw new BadRequestException('Período inválido')
    return { fromDate, toDate }
  }
}
