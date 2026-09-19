import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common'
import { dopSchema, type DopPeriodSummary } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { buildMetadata } from '../../../../core/metadata.builder'
import { DopService } from './dop.service'

// No BaseController here — DOP is a single computed GET, not CRUD (docs/proposal/
// plan_dop_v1.md, decisão 3). The metadata endpoint is still needed even though
// there's no CRUD: it's what usePageGuard()/useMetadata() on the frontend read to
// gate the page on the 'Dop' CASL subject, same as every other resource's page.
@Controller('transit/dop')
@UseGuards(JwtAuthGuard)
export class DopController {
  constructor(
    private readonly dopService:  DopService,
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
  ): Promise<DopPeriodSummary> {
    const ability = await this.caslFactory.createForUser(req.user)
    if (!ability.can('read', 'Dop')) throw new ForbiddenException()

    if (!scopeId || !from || !to) throw new BadRequestException('scopeId, from e to são obrigatórios')
    const fromDate = new Date(from)
    const toDate   = new Date(to)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
      throw new BadRequestException('Período inválido')
    }

    return this.dopService.getPeriodSummary(scopeId, fromDate, toDate)
  }
}
