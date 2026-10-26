import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import {
  CONSOLE_ACTION_KINDS, consoleActionSchema, consoleSchema, consoleSuggestSchema,
  type ConsoleActionKind, type ConsoleImpact, type ConsoleSnapshot, type ConsoleSuggestion, type CrewRole, type RebalanceRules, type RosterAdjustmentRow,
} from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { buildMetadata } from '../../../core/metadata.builder'
import { ConsoleService } from './console.service'

// No BaseController — the Painel is one computed GET plus its actions. The metadata endpoint gates
// the page on the 'Console' CASL subject (usePageGuard), as for the DOP. Reading needs Console read;
// applying an adjustment changes crew members, so it needs CrewMember update too.
@Controller('transit/console')
@UseGuards(JwtAuthGuard)
export class ConsoleController {
  constructor(
    private readonly console:     ConsoleService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get('metadata')
  async getMetadata(@Req() req: { user?: AuthUser }) {
    const meta = buildMetadata('console', consoleSchema)
    if (!req.user) return meta
    const ability = await this.caslFactory.createForUser(req.user)
    return {
      ...meta,
      permissions: {
        create: ability.can('create', 'Console'),
        read:   ability.can('read',   'Console'),
        update: ability.can('update', 'Console') && ability.can('update', 'CrewMember'),
        delete: ability.can('delete', 'Console'),
      },
    }
  }

  @Get()
  async get(@Req() req: { user: AuthUser }, @Query('branchId') branchId: string, @Query('role') role: CrewRole, @Query('scopeId') scopeId?: string): Promise<ConsoleSnapshot> {
    await this.assert(req.user, branchId, 'read')
    return this.console.snapshot({ branchId, role: role || 'DRIVER', scopeId })
  }

  @Post('actions/:kind/suggest')
  async suggest(@Req() req: { user: AuthUser }, @Param('kind') kind: string, @Body() body: unknown): Promise<ConsoleSuggestion> {
    const dto = this.parse(consoleSuggestSchema, body)
    await this.assert(req.user, dto.branchId, 'read')
    return this.console.suggest(this.kind(kind), dto)
  }

  @Post('actions/:kind/preview')
  async preview(@Req() req: { user: AuthUser }, @Param('kind') kind: string, @Body() body: unknown): Promise<ConsoleImpact> {
    const dto = this.parse(consoleActionSchema, body)
    await this.assert(req.user, dto.branchId, 'read')
    return this.console.preview(this.kind(kind), dto)
  }

  @Post('actions/:kind/apply')
  async apply(@Req() req: { user: AuthUser }, @Param('kind') kind: string, @Body() body: unknown): Promise<RosterAdjustmentRow> {
    const dto = this.parse(consoleActionSchema, body)
    await this.assert(req.user, dto.branchId, 'apply')
    return this.console.apply(this.kind(kind), dto, req.user.id)
  }

  @Get('adjustments')
  async adjustments(
    @Req() req: { user: AuthUser }, @Query('branchId') branchId: string, @Query('role') role: CrewRole,
    @Query('from') from?: string, @Query('to') to?: string,
  ): Promise<RosterAdjustmentRow[]> {
    await this.assert(req.user, branchId, 'read')
    return this.console.adjustments({ branchId, role: role || 'DRIVER', from, to })
  }

  @Get('rule')
  async rule(@Req() req: { user: AuthUser }, @Query('branchId') branchId: string): Promise<RebalanceRules> {
    await this.assert(req.user, branchId, 'read')
    return this.console.rule(branchId)
  }

  @Put('rule')
  async saveRule(@Req() req: { user: AuthUser }, @Query('branchId') branchId: string, @Body() body: unknown): Promise<RebalanceRules> {
    await this.assert(req.user, branchId, 'update')
    return this.console.saveRule(branchId, body)
  }

  private parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body)
    if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Dados inválidos')
    return r.data
  }

  private kind(kind: string): ConsoleActionKind {
    if (!(CONSOLE_ACTION_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Ação desconhecida')
    return kind as ConsoleActionKind
  }

  // read: the Painel; update: its settings (the selection rule); apply: change crew members
  private async assert(user: AuthUser, branchId: string | undefined, action: 'read' | 'update' | 'apply'): Promise<void> {
    if (!branchId) throw new BadRequestException('Informe a empresa')
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can('read', 'Console')) throw new ForbiddenException()
    if (action === 'update' && !ability.can('update', 'Console')) throw new ForbiddenException()
    if (action === 'apply' && !(ability.can('update', 'Console') && ability.can('update', 'CrewMember'))) throw new ForbiddenException()
    if (user.role !== 'admin' && !user.branchIds.includes(branchId)) throw new ForbiddenException('Empresa fora do seu acesso')
  }
}
