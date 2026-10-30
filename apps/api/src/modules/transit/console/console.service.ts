import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  CONSOLE_ACTION_DATED, CONSOLE_NO_PLAN, consoleSchema, rebalanceRulesSchema, withAllCriteria,
  type ConsoleActionDto, type ConsoleRequestReviewDto, type ConsoleActionKind, type ConsoleImpact, type ConsoleSnapshot, type ConsoleSuggestDto, type ConsoleSuggestion,
  type CrewRole, type RebalanceRules, type RosterAdjustmentItem, type RosterAdjustmentRow, type RosterAdjustmentState,
} from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { resourceRegistry } from '../../../core/resource-registry'
import { TransitCrewConfigService } from '../settings/transit-crew-config.service'
import { TransitRosterConfigService } from '../settings/transit-roster-config.service'
import { DayTypeService } from '../timetabling/day-type/day-type.service'
import { CrewMemberShiftService } from '../crew/crew-member/crew-member-shift.service'
import { dayOf, localToday, toDbDate } from '../timetabling/plan-validity'
import { computeConsole, type ConsoleCrew, type ConsoleInput } from './console.calc'
import { loadConsoleInput, type ConsoleParams } from './console.input'
import { changeRequestRows, impact, planned, suggestGroups, suggestLine, suggestProfiles, suggestRequest, suggestShifts, type MoveItem } from './console.actions'
import { changeRequestSelect, notifyChange, reviewMessage, settleChangeRequests } from '../crew/crew-member/crew-change-request'

// Painel de Escala — no model and no CRUD, like the DOP: registers itself for discovery / CASL and
// computes the snapshot on each request (docs/architecture/transit/console.md).
// The adjustments change the crew records only (shift, rest group, lines, new profiles); generated
// days keep what they were generated with — the next generation picks the new crew up.
@Injectable()
export class ConsoleService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly roster:   TransitRosterConfigService,
    private readonly crewConfig: TransitCrewConfigService,
    private readonly dayTypes: DayTypeService,
    private readonly shifts:   CrewMemberShiftService,
  ) {
    resourceRegistry.push({ domain: 'transit', resource: 'console', schema: consoleSchema })
  }

  private input(params: ConsoleParams): Promise<ConsoleInput> {
    return loadConsoleInput(this.prisma, this.roster, this.crewConfig, this.dayTypes, params)
  }

  async snapshot(params: ConsoleParams): Promise<ConsoleSnapshot> {
    const input = await this.input(params)
    return computeConsole(input, changeRequestRows(planned(input).input))
  }

  // ── actions ─────────────────────────────────────────────────────────────────

  async suggest(kind: ConsoleActionKind, dto: ConsoleSuggestDto): Promise<ConsoleSuggestion> {
    const [input, settings] = await Promise.all([this.input(dto), this.roster.get(dto.branchId)])
    const rules = withAllCriteria(settings.rebalanceRules)
    const { input: scoped, left } = planned(input)
    if (!scoped.days.length && kind !== 'profiles') throw new BadRequestException(CONSOLE_NO_PLAN)
    const suggestion = this.suggestOf(kind, scoped, rules, dto)
    return left.length && scoped.days.length
      ? { ...suggestion, notes: [`${left.join(', ')} sem planejamento efetivo com escala ativa — fora da sugestão`] }
      : suggestion
  }

  private suggestOf(kind: ConsoleActionKind, input: ConsoleInput, rules: RebalanceRules, dto: ConsoleSuggestDto): ConsoleSuggestion {
    if (dto.requestId && (kind === 'shifts' || kind === 'groups')) return suggestRequest(input, rules, dto.requestId, dto.pairId)
    if (kind === 'shifts') return suggestShifts(input, rules)
    if (kind === 'profiles') return suggestProfiles(input, rules)
    if (!dto.shiftId) throw new BadRequestException('Informe o turno')
    if (kind === 'groups') return suggestGroups(input, rules, dto.shiftId)
    if (!dto.lineId) throw new BadRequestException('Informe a linha')
    return suggestLine(input, rules, kind, dto.shiftId, dto.lineId)
  }

  async preview(kind: ConsoleActionKind, dto: ConsoleActionDto): Promise<ConsoleImpact> {
    const input = await this.input(dto)
    const effective = this.effectiveOf(kind, dto)
    const items = this.check(kind, input, dto)
    const generated = await this.prisma.dailyOperation.count({
      where: { scopeId: input.scopeId, status: { not: 'CLOSED' }, date: { gte: toDbDate(kind === 'groups' ? localToday() : effective) } },
    })
    return impact(input, kind, items, effective, generated)
  }

  // No undo: reverting is a new adjustment the other way — every one is logged (RosterAdjustment)
  async apply(kind: ConsoleActionKind, dto: ConsoleActionDto, userId?: string): Promise<RosterAdjustmentRow> {
    const [input, settings] = await Promise.all([this.input(dto), this.roster.get(dto.branchId)])
    const effective = this.effectiveOf(kind, dto)
    const items = this.check(kind, input, dto)
    const crewById = new Map(input.crew.map(m => [m.id, m]))
    const lineCode = new Map(input.lines.map(l => [l.id, l.code]))
    const state = (m: ConsoleCrew): RosterAdjustmentState => ({ shiftId: m.shiftId, restOffset: m.offset, restPatternId: m.ownPattern ? m.pattern?.id ?? null : null })

    const adjustment = await this.prisma.$transaction(async tx => {
      const log: RosterAdjustmentItem[] = []
      for (const i of items) {
        if (kind === 'profiles') {
          const e = input.noProfile.find(x => x.employeeId === i.crewMemberId)!
          // his own pattern only when it isn't the shift's — otherwise he follows the shift's
          const shiftPattern = input.shifts.find(x => x.id === i.to)?.pattern?.id ?? null
          const restPatternId = i.patternId && i.patternId !== shiftPattern ? i.patternId : null
          const created = await tx.crewMember.create({ data: { employeeId: e.employeeId, role: dto.role, restOffset: i.offset ?? 0, restPatternId } })
          await tx.crewMemberShift.create({ data: { crewMemberId: created.id, shiftId: i.to, validFrom: toDbDate(effective), validTo: null } })
          log.push({
            crewMemberId: created.id, code: e.code, name: e.name,
            before: { shiftId: null, restOffset: 0, restPatternId: null },
            after:  { shiftId: i.to, restOffset: i.offset ?? 0, restPatternId },
          })
          continue
        }
        const m = crewById.get(i.crewMemberId)!
        if (kind === 'lines' || kind === 'priority') {
          const line = await this.setLine(tx, m.id, i.lineId!, kind, settings.lineAccessMode)
          log.push({
            crewMemberId: m.id, code: m.code, name: m.name,
            before: { ...state(m), line: { lineId: i.lineId!, code: lineCode.get(i.lineId!) ?? '?', ...line.before } },
            after:  { ...state(m), line: { lineId: i.lineId!, code: lineCode.get(i.lineId!) ?? '?', ...line.after } },
          })
          continue
        }
        // a shifts adjustment may carry group-only rows (the groups its moves unbalanced) — no new link
        if (kind === 'shifts' && i.to !== m.shiftId) await this.shifts.startShift(m.id, i.to, effective, tx)
        const data = {
          ...(i.offset != null && i.offset !== m.offset ? { restOffset: i.offset } : {}),
          ...(i.patternId ? { restPatternId: i.patternId } : {}),
        }
        if (Object.keys(data).length) await tx.crewMember.update({ where: { id: m.id }, data })
        log.push({
          crewMemberId: m.id, code: m.code, name: m.name,
          before: state(m),
          after:  { shiftId: i.to, restOffset: i.offset ?? m.offset, restPatternId: i.patternId ?? state(m).restPatternId },
        })
      }
      return tx.rosterAdjustment.create({
        data: {
          scopeId: input.scopeId, branchId: dto.branchId, role: dto.role, kind, effective: toDbDate(effective),
          rule: withAllCriteria(settings.rebalanceRules), items: log as unknown as Prisma.InputJsonValue, userId: userId ?? null,
        },
      })
    })
    // the change requests the adjustment met — whether it came from one or from a balancing
    if (kind === 'shifts' || kind === 'groups') await settleChangeRequests(this.prisma, items.map(i => i.crewMemberId), adjustment.id)
    return (await this.rows([adjustment]))[0]
  }

  // a change request into the queue (from REQUESTED) or rejected (REQUESTED / QUEUED); he is told
  async review(id: string, dto: ConsoleRequestReviewDto, userId?: string): Promise<void> {
    const r = await this.prisma.crewChangeRequest.findFirst({
      where:  { id, crewMember: { employee: { branchId: dto.branchId } } },
      select: changeRequestSelect,
    })
    if (!r) throw new NotFoundException('Pedido não encontrado')
    const allowed = dto.decision === 'QUEUED' ? r.status === 'REQUESTED' : r.status === 'REQUESTED' || r.status === 'QUEUED'
    if (!allowed) throw new ConflictException('O pedido já foi analisado ou encerrado — atualize o Painel')
    const notes = dto.notes || null
    await this.prisma.$transaction(async tx => {
      await tx.crewChangeRequest.update({ where: { id }, data: { status: dto.decision, reviewNotes: notes, reviewedByUserId: userId ?? null, reviewedAt: new Date() } })
      await notifyChange(tx, [{ crewMemberId: r.crewMemberId, message: reviewMessage(r, dto.decision, notes) }])
    })
  }

  // a line for a crew member: lines — he may operate it (whitelist: ENABLED; blacklist: no longer
  // BLOCKED); priority — it's one of his priority lines (and, whitelist, enabled)
  private async setLine(tx: Prisma.TransactionClient, crewMemberId: string, lineId: string, kind: 'lines' | 'priority', mode: 'WHITELIST' | 'BLACKLIST') {
    const row = await tx.crewMemberLine.findUnique({ where: { crewMemberId_lineId: { crewMemberId, lineId } } })
    const before = { access: row?.access ?? null, priority: row?.priority ?? false }
    const after = {
      access: mode === 'WHITELIST' ? 'ENABLED' as const : kind === 'lines' ? null : before.access === 'BLOCKED' ? null : before.access,
      priority: kind === 'priority' ? true : before.priority,
    }
    if (!after.access && after.priority === false && row?.rank == null) {
      if (row) await tx.crewMemberLine.delete({ where: { id: row.id } })
    } else if (row) {
      await tx.crewMemberLine.update({ where: { id: row.id }, data: after })
    } else {
      await tx.crewMemberLine.create({ data: { crewMemberId, lineId, ...after } })
    }
    return { before, after }
  }

  // the dated actions take the date given (from today on); the others are in force at once
  private effectiveOf(kind: ConsoleActionKind, dto: ConsoleActionDto): string {
    if (!CONSOLE_ACTION_DATED[kind]) return localToday()
    if (dto.effective < localToday()) throw new BadRequestException('A data de efeito não pode ser no passado')
    return dto.effective
  }

  // the items against the crew as it is now: each one still where the suggestion found him (someone
  // may have changed him meanwhile — 409 with who), the destination one of the empresa's shifts
  private check(kind: ConsoleActionKind, input: ConsoleInput, dto: ConsoleActionDto): MoveItem[] {
    const shiftIds = new Set(input.shifts.map(s => s.id))
    const lineIds = new Set(input.lines.map(l => l.id))
    const patternIds = new Set(input.patterns.map(p => p.id))
    const changed: string[] = []
    const items = dto.items.map(i => {
      if (!shiftIds.has(i.to)) throw new BadRequestException('Turno de destino não é da empresa')
      if ((kind === 'lines' || kind === 'priority') && (!i.lineId || !lineIds.has(i.lineId))) throw new BadRequestException('Linha não é do escopo')
      if (i.patternId && !patternIds.has(i.patternId)) throw new BadRequestException('Regime de folga não encontrado')
      if (kind === 'profiles') {
        const e = input.noProfile.find(x => x.employeeId === i.crewMemberId)
        if (!e) changed.push(i.crewMemberId)
      } else {
        const m = input.crew.find(c => c.id === i.crewMemberId)
        if (!m) throw new BadRequestException('Operador fora da empresa e função')
        if (m.shiftId !== i.from) changed.push(`${m.code} ${m.name}`)
      }
      return { crewMemberId: i.crewMemberId, to: i.to, offset: i.offset, patternId: i.patternId ?? null, lineId: i.lineId ?? null }
    })
    if (changed.length) throw new ConflictException(`Quadro alterado desde a sugestão — gere a sugestão de novo: ${changed.join(', ')}`)
    return items
  }

  // ── adjustments and the selection rule ────────────────────────────────────

  async adjustments(params: { branchId: string; role: CrewRole; from?: string; to?: string }): Promise<RosterAdjustmentRow[]> {
    const rows = await this.prisma.rosterAdjustment.findMany({
      where: {
        branchId: params.branchId, role: params.role,
        ...(params.from || params.to ? { createdAt: { ...(params.from ? { gte: toDbDate(params.from) } : {}), ...(params.to ? { lt: toDbDate(params.to) } : {}) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take:    100,
    })
    return this.rows(rows)
  }

  private async rows(rows: { id: string; kind: string; effective: Date; createdAt: Date; userId: string | null; items: unknown }[]): Promise<RosterAdjustmentRow[]> {
    const users = new Map((await this.prisma.user.findMany({
      where:  { id: { in: [...new Set(rows.flatMap(r => r.userId ?? []))] } },
      select: { id: true, name: true },
    })).map(u => [u.id, u.name]))
    return rows.map(r => ({
      id: r.id, kind: r.kind, effective: dayOf(r.effective), createdAt: r.createdAt.toISOString(),
      user: r.userId ? users.get(r.userId) ?? null : null, items: r.items as RosterAdjustmentItem[],
    }))
  }

  async rule(branchId: string): Promise<RebalanceRules> {
    return withAllCriteria((await this.roster.get(branchId)).rebalanceRules)
  }

  async saveRule(branchId: string, raw: unknown): Promise<RebalanceRules> {
    const rebalanceRules = withAllCriteria(rebalanceRulesSchema.parse(raw))
    const current = await this.roster.get(branchId)
    return (await this.roster.put({ ...current, rebalanceRules }, branchId)).rebalanceRules
  }
}
