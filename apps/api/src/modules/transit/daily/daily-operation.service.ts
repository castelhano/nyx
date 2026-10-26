import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  dailyOperationSchema, restPatternWorks, validateBlock,
  type CreateDailyOperationDto, type DailyIssue, type DailyOperation, type DailySource, type DailySummary,
  type CrewRole, type DutySummary, type UpdateDailyOperationDto, type VehicleTypeValue,
} from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { TransitCrewConfigService } from '../settings/transit-crew-config.service'
import { TransitRosterConfigService } from '../settings/transit-roster-config.service'
import { TransitGeneralConfigService } from '../settings/transit-general-config.service'
import { DayTypeService } from '../timetabling/day-type/day-type.service'
import { computeCrewPlan } from '../timetabling/crew-plan/crew-scoring.calc'
import { loadCrewBranchRules } from '../timetabling/crew-plan/crew-branch-rules'
import { loadCrewWalk } from '../timetabling/crew-plan/crew-walk'
import { canonicalJson } from '../timetabling/crew-plan/crew-plan.service'
import { defaultIntervalMaxMinutes } from '../timetabling/vehicle-plan/block-issues.utils'
import { addDays, dayOf, parseStartDate, toDbDate, type Day } from '../timetabling/plan-validity'
import { systemAbsenceTypeId } from '../crew/crew-absence-type/system-types'
import { materializeDay } from './daily-materialize'
import { loadDailyRelief } from './daily-relief'
import { crewIssues, loadCrewFacts, vehicleIssues, type BlockFacts, type DutyFacts } from './daily-checks'
import { loadContextCycles, restOfDay } from './crew-context'

type ChangeAction = 'ASSIGN_CREW' | 'UNASSIGN_CREW' | 'SWAP_CREW' | 'ASSIGN_VEHICLE' | 'CANCEL_TRIP' | 'RESTORE_TRIP' | 'DAY_OFF' | 'UNPUBLISH' | 'REOPEN'

// The day's real operation (DailyOperation). Creating one materializes the plans in force on the
// date; every edit recalculates the day (duty summaries/issues through the crew calculation,
// block issues through validateBlock, and the day's own crew/vehicle checks). A PUBLISHED day
// logs each change (DailyChangeLog); a CLOSED one is read-only.
@Injectable()
export class DailyOperationService extends BaseService<DailyOperation, CreateDailyOperationDto, UpdateDailyOperationDto> {
  private readonly logger = new Logger(DailyOperationService.name)
  constructor(
    prisma: PrismaService,
    private readonly dayTypes: DayTypeService,
    private readonly crewConfig: TransitCrewConfigService,
    private readonly rosterConfig: TransitRosterConfigService,
    private readonly generalConfig: TransitGeneralConfigService,
  ) {
    super(prisma, 'dailyOperation', dailyOperationSchema, 'transit')
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  override async create(dto: CreateDailyOperationDto): Promise<DailyOperation> {
    const day = parseStartDate(typeof dto.date === 'string' ? (dto.date as string).slice(0, 10) : dayOf(new Date(dto.date)))
    const existing = await this.prisma.dailyOperation.findUnique({ where: { scopeId_date: { scopeId: dto.scopeId, date: toDbDate(day) } }, select: { id: true } })
    if (existing) return this.findOne(existing.id)
    const id = await materializeDay(this.prisma, this.dayTypes, dto.scopeId, day)
    await this.syncReserves(id)
    await this.recalculate(id)
    return this.findOne(id)
  }

  // The empresas' plantões on a PLANNED day (RosterSettings.reserveTargets of its day type): one
  // STANDBY duty (STANDBY activity, no pieces, sourceDutyId null) per unit of each target. Missing
  // ones are created after the day's last duty number; ones beyond the target — or of a target
  // gone — are removed while nobody holds them. The caller recalculates when it returns true.
  async syncReserves(id: string): Promise<boolean> {
    const op = await this.prisma.dailyOperation.findUnique({ where: { id }, select: { id: true, scopeId: true, dayTypeId: true, status: true } })
    if (!op || op.status !== 'PLANNED') return false
    const branches = await this.prisma.scopeOperator.findMany({ where: { scopeId: op.scopeId }, select: { branchId: true } })
    const existing = await this.prisma.dailyDuty.findMany({
      where:  { dailyOperationId: id, kind: 'STANDBY', sourceDutyId: null, standbyExtra: null },
      select: {
        id: true, role: true, branchId: true, _count: { select: { rosterEntries: true } },
        activities: { where: { type: 'STANDBY' }, select: { startMinutes: true, endMinutes: true, originLocalityId: true }, take: 1 },
      },
    })
    const keyOf = (role: string, branchId: string | null, start: number, end: number, localityId: string | null) => `${role}|${branchId}|${start}|${end}|${localityId ?? ''}`
    const have = new Map<string, typeof existing>()
    for (const d of existing) {
      const a = d.activities[0]
      const key = a ? keyOf(d.role, d.branchId, a.startMinutes, a.endMinutes, a.originLocalityId) : `?${d.id}`
      have.set(key, [...(have.get(key) ?? []), d])
    }

    const create: { role: CrewRole; branchId: string; startMinutes: number; endMinutes: number; localityId: string | null }[] = []
    const remove: string[] = []
    for (const { branchId } of branches) {
      const settings = await this.rosterConfig.get(branchId)
      for (const t of settings.reserveTargets.filter(t => t.dayTypeId === op.dayTypeId)) {
        for (let i = 0; i < t.count; i++) create.push({ role: t.role, branchId, startMinutes: t.startMinutes, endMinutes: t.endMinutes, localityId: t.localityId })
      }
    }
    // what exists already counts toward its target; the rest of a target is created
    const missing = create.filter(c => {
      const key = keyOf(c.role, c.branchId, c.startMinutes, c.endMinutes, c.localityId)
      const list = have.get(key) ?? []
      if (!list.length) return true
      list.shift()
      return false
    })
    // what's left over (beyond the target, or no target) goes while unheld
    for (const list of have.values()) for (const d of list) if (!d._count.rosterEntries) remove.push(d.id)
    if (!missing.length && !remove.length) return false

    const numbers = await this.prisma.dailyDuty.groupBy({ by: ['role'], where: { dailyOperationId: id }, _max: { dutyNumber: true } })
    const next = new Map(numbers.map(n => [n.role, n._max.dutyNumber ?? 0]))
    await this.prisma.$transaction(async tx => {
      if (remove.length) await tx.dailyDuty.deleteMany({ where: { id: { in: remove } } })
      for (const c of missing) {
        const dutyNumber = (next.get(c.role) ?? 0) + 1
        next.set(c.role, dutyNumber)
        await tx.dailyDuty.create({
          data: {
            dailyOperationId: id, role: c.role, dutyNumber, kind: 'STANDBY', branchId: c.branchId,
            activities: { create: { type: 'STANDBY', startMinutes: c.startMinutes, endMinutes: c.endMinutes, originLocalityId: c.localityId, destinationLocalityId: c.localityId } },
          },
        })
      }
    })
    return true
  }

  // Plantões extras asked at a roster generation (`tag` = its job): `count` STANDBY duties of the
  // empresa after the day's last duty number. The caller recalculates.
  async createExtraStandby(
    id: string, role: CrewRole, branchId: string, t: { startMinutes: number; endMinutes: number; localityId: string | null; count: number }, tag: string,
  ): Promise<void> {
    const last = await this.prisma.dailyDuty.aggregate({ where: { dailyOperationId: id, role }, _max: { dutyNumber: true } })
    let dutyNumber = last._max.dutyNumber ?? 0
    await this.prisma.$transaction(async tx => {
      for (let i = 0; i < t.count; i++) {
        await tx.dailyDuty.create({
          data: {
            dailyOperationId: id, role, dutyNumber: ++dutyNumber, kind: 'STANDBY', branchId, standbyExtra: tag,
            activities: { create: { type: 'STANDBY', startMinutes: t.startMinutes, endMinutes: t.endMinutes, originLocalityId: t.localityId, destinationLocalityId: t.localityId } },
          },
        })
      }
    })
  }

  override update(): Promise<DailyOperation> {
    throw new BadRequestException('A escala diária muda pelas ações da tela do dia')
  }

  override async remove(id: string): Promise<void> {
    const op = await this.operation(id)
    if (op.status !== 'PLANNED') throw new BadRequestException('Só um dia ainda planejado pode ser excluído')
    await super.remove(id)
  }

  // discards the day and copies the plans again — its allocation goes with it
  async rematerialize(id: string): Promise<{ id: string }> {
    const op = await this.operation(id)
    if (op.status !== 'PLANNED') throw new BadRequestException('Só um dia ainda planejado pode ser refeito')
    await this.prisma.dailyOperation.delete({ where: { id } })
    const created = await this.create({ scopeId: op.scopeId, date: op.date })
    return { id: created.id }
  }

  async setStatus(id: string, status: 'PUBLISHED' | 'CLOSED'): Promise<void> {
    const op = await this.operation(id)
    const from = status === 'PUBLISHED' ? 'PLANNED' : 'PUBLISHED'
    if (op.status !== from) throw new BadRequestException(status === 'PUBLISHED' ? 'Só um dia planejado pode ser publicado' : 'Só um dia publicado pode ser encerrado')
    await this.prisma.dailyOperation.update({
      where: { id },
      data:  status === 'PUBLISHED' ? { status, publishedAt: new Date() } : { status, closedAt: new Date() },
    })
  }

  // Back one status, for a mistake (admins only — the controller checks): a PUBLISHED day back to
  // PLANNED (unpublish — the generator may redo it from scratch), a CLOSED one back to PUBLISHED
  // (reopen — to fix what was done). The allocation stays; the reason goes to the day's log.
  async revertStatus(id: string, reason: string, userId: string | undefined): Promise<void> {
    if (!reason?.trim()) throw new BadRequestException('Informe o motivo')
    const op = await this.operation(id)
    if (op.status === 'PLANNED') throw new BadRequestException('O dia já está planejado')
    const unpublish = op.status === 'PUBLISHED'
    await this.prisma.$transaction([
      this.prisma.dailyOperation.update({
        where: { id },
        data:  unpublish ? { status: 'PLANNED', publishedAt: null } : { status: 'PUBLISHED', closedAt: null },
      }),
      this.prisma.dailyChangeLog.create({
        data: {
          dailyOperationId: id, userId: userId ?? null, action: unpublish ? 'UNPUBLISH' : 'REOPEN', entityType: 'DailyOperation', entityId: id,
          crewMemberIds: [], before: { status: op.status }, after: { status: unpublish ? 'PLANNED' : 'PUBLISHED', reason: reason.trim() },
        },
      }),
    ])
  }

  // ── allocation ──────────────────────────────────────────────────────────────

  async assignCrew(id: string, dutyId: string, crewMemberId: string | null, userId?: string): Promise<void> {
    const op = await this.editable(id)
    const touched = await this.applyCrew(op, dutyId, crewMemberId, userId)
    if (touched) await this.recalculateAround(op, touched)
  }

  // Several duties at once (the roster screen's block edits, paste): applied in order — each one
  // validated against what the previous left — then each touched day recalculated once.
  async assignMany(items: { dutyId: string; crewMemberId: string | null }[], userId?: string): Promise<void> {
    const duties = await this.prisma.dailyDuty.findMany({ where: { id: { in: items.map(i => i.dutyId) } }, select: { id: true, dailyOperationId: true } })
    const opOf = new Map(duties.map(d => [d.id, d.dailyOperationId]))
    const ops = new Map<string, Awaited<ReturnType<DailyOperationService['editable']>>>()
    const members = new Map<string, Set<string>>()
    for (const item of items) {
      const opId = opOf.get(item.dutyId)
      if (!opId) throw new NotFoundException('Tabela não encontrada')
      if (!ops.has(opId)) ops.set(opId, await this.editable(opId))
      const touched = await this.applyCrew(ops.get(opId)!, item.dutyId, item.crewMemberId, userId)
      for (const m of touched ?? []) if (m) members.set(opId, (members.get(opId) ?? new Set()).add(m))
    }
    for (const [opId, op] of ops) await this.recalculateAround(op, [...(members.get(opId) ?? [])])
  }

  // writes one duty's crew member (no recalculation) — the crew members touched, or null when
  // nothing changed
  private async applyCrew(
    op: { id: string; scopeId: string; date: Date; status: string }, dutyId: string, crewMemberId: string | null, userId?: string,
  ): Promise<(string | null)[] | null> {
    const id = op.id
    const duty = await this.prisma.dailyDuty.findFirst({
      where:  { id: dutyId, dailyOperationId: id },
      select: { id: true, kind: true, summary: true, rosterEntries: { select: { id: true, crewMemberId: true } } },
    })
    if (!duty) throw new NotFoundException('Tabela não encontrada')
    const previous = duty.rosterEntries[0]?.crewMemberId ?? null
    if (previous === crewMemberId) return null

    if (crewMemberId) {
      const entries = await this.prisma.rosterEntry.findMany({
        where:  { crewMemberId, date: op.date, NOT: { dailyDutyId: dutyId } },
        select: { kind: true, dailyDuty: { select: { summary: true } } },
      })
      if (entries.some(e => e.kind === 'DAY_OFF' || e.kind === 'COMP_OFF')) {
        throw new BadRequestException('O operador está de folga no dia — remova a folga antes')
      }
      const span = (s: unknown) => s as DutySummary | null
      const mine = span(duty.summary)
      if (mine?.startMinutes != null && mine.endMinutes != null && entries.some(e => {
        const o = span(e.dailyDuty?.summary)
        return o?.startMinutes != null && o.endMinutes != null && o.startMinutes < mine.endMinutes! && o.endMinutes > mine.startMinutes!
      })) throw new BadRequestException('O operador já está em outra tabela nesse horário')
    }

    await this.prisma.$transaction(async tx => {
      await tx.rosterEntry.deleteMany({ where: { dailyDutyId: dutyId } })
      if (crewMemberId) {
        await tx.rosterEntry.create({
          data: { crewMemberId, date: op.date, kind: duty.kind === 'STANDBY' ? 'STANDBY' : 'DUTY', dailyDutyId: dutyId },
        })
      }
    })
    await this.log(op, userId, crewMemberId ? 'ASSIGN_CREW' : 'UNASSIGN_CREW', 'DailyDuty', dutyId,
      [previous, crewMemberId], { crewMemberId: previous }, { crewMemberId })
    return [previous, crewMemberId]
  }

  // a locked allocation survives the roster generator
  async setLocked(id: string, dutyId: string, locked: boolean): Promise<void> {
    await this.editable(id)
    const { count } = await this.prisma.rosterEntry.updateMany({ where: { dailyDutyId: dutyId, dailyDuty: { dailyOperationId: id } }, data: { locked } })
    if (!count) throw new BadRequestException('A tabela não tem operador')
  }

  async assignVehicle(id: string, blockId: string, vehicleId: string | null, userId?: string): Promise<void> {
    const op = await this.editable(id)
    const block = await this.prisma.dailyBlock.findFirst({ where: { id: blockId, dailyOperationId: id }, select: { vehicleId: true } })
    if (!block) throw new NotFoundException('Carro não encontrado')
    if (block.vehicleId === vehicleId) return
    await this.prisma.dailyBlock.update({ where: { id: blockId }, data: { vehicleId } })
    await this.log(op, userId, 'ASSIGN_VEHICLE', 'DailyBlock', blockId, await this.crewOfBlock(blockId), { vehicleId: block.vehicleId }, { vehicleId })
    await this.recalculate(id)
  }

  async setTripCancelled(id: string, eventId: string, cancelled: boolean, userId?: string): Promise<void> {
    const op = await this.editable(id)
    const event = await this.prisma.dailyBlockEvent.findFirst({ where: { id: eventId, dailyOperationId: id, kind: 'TRIP' }, select: { isCancelled: true, dailyBlockId: true } })
    if (!event) throw new NotFoundException('Viagem não encontrada')
    if (event.isCancelled === cancelled) return
    await this.prisma.dailyBlockEvent.update({ where: { id: eventId }, data: { isCancelled: cancelled } })
    await this.log(op, userId, cancelled ? 'CANCEL_TRIP' : 'RESTORE_TRIP', 'DailyBlockEvent', eventId,
      event.dailyBlockId ? await this.crewOfBlock(event.dailyBlockId) : [], { isCancelled: !cancelled }, { isCancelled: cancelled })
    await this.recalculate(id)
  }

  // DAY_OFF / COMP_OFF on the day for a crew member without a duty; null clears it
  // `absenceTypeId`: the day off's type (its ERP code) — none: the system type of the kind
  async setDayOff(id: string, crewMemberId: string, kind: 'DAY_OFF' | 'COMP_OFF' | null, userId?: string, absenceTypeId?: string | null): Promise<void> {
    const op = await this.editable(id)
    const entries = await this.prisma.rosterEntry.findMany({ where: { crewMemberId, date: op.date }, select: { id: true, kind: true, dailyDutyId: true, absenceTypeId: true } })
    if (kind && entries.some(e => e.dailyDutyId)) throw new BadRequestException('O operador está escalado no dia — tire-o da tabela antes')
    if (kind === 'COMP_OFF') await this.assertNotHoliday(dayOf(op.date), crewMemberId)
    const typeId = kind ? absenceTypeId ?? await systemAbsenceTypeId(this.prisma, kind) : null
    const before = entries.find(e => !e.dailyDutyId)
    if ((before?.kind ?? null) === kind && (before?.absenceTypeId ?? null) === typeId) return
    await this.prisma.$transaction(async tx => {
      await tx.rosterEntry.deleteMany({ where: { crewMemberId, date: op.date, dailyDutyId: null } })
      if (kind) await tx.rosterEntry.create({ data: { crewMemberId, date: op.date, kind, absenceTypeId: typeId } })
    })
    await this.log(op, userId, 'DAY_OFF', 'CrewMember', crewMemberId, [crewMemberId], { kind: before?.kind ?? null }, { kind, absenceTypeId: typeId })
  }

  // Two crew members swap everything they have on a date (duties, days off) — the roster screen's
  // drag. Nothing locked, no closed day.
  async swapDay(date: Day, a: string, b: string, userId?: string): Promise<void> {
    if (a === b) return
    const entries = await this.prisma.rosterEntry.findMany({
      where:  { date: toDbDate(date), crewMemberId: { in: [a, b] } },
      select: { id: true, crewMemberId: true, locked: true, dailyDuty: { select: { operation: { select: { id: true, scopeId: true, date: true, status: true } } } } },
    })
    if (!entries.length) return
    if (entries.some(e => e.locked)) throw new BadRequestException('Há alocação travada — destrave antes de trocar')
    if (entries.some(e => e.dailyDuty?.operation.status === 'CLOSED')) throw new BadRequestException('Dia encerrado — somente leitura')
    await this.prisma.$transaction(entries.map(e => this.prisma.rosterEntry.update({
      where: { id: e.id }, data: { crewMemberId: e.crewMemberId === a ? b : a, source: 'MANUAL' },
    })))
    const ops = new Map(entries.flatMap(e => (e.dailyDuty ? [[e.dailyDuty.operation.id, e.dailyDuty.operation] as const] : [])))
    for (const op of ops.values()) {
      await this.log(op, userId, 'SWAP_CREW', 'CrewMember', a, [a, b], { crewMemberIds: [a, b] }, { crewMemberIds: [b, a] })
      await this.recalculateAround(op, [a, b])
    }
  }

  // a type given: its effect is the kind (a DAY_OFF / COMP_OFF type)
  async setDayOffMany(items: { date: Day; crewMemberId: string }[], kind: 'DAY_OFF' | 'COMP_OFF' | null, userId?: string, absenceTypeId?: string | null): Promise<void> {
    if (absenceTypeId) {
      const type = await this.prisma.crewAbsenceType.findUnique({ where: { id: absenceTypeId }, select: { effect: true } })
      if (!type || type.effect === 'ABSENCE') throw new BadRequestException('O tipo não é uma folga')
      kind = type.effect
    }
    for (const i of items) await this.setDayOffOn(i.date, i.crewMemberId, kind, userId, absenceTypeId)
  }

  // a day off by date — the roster screen works by date (no day needs to exist yet)
  async setDayOffOn(date: Day, crewMemberId: string, kind: 'DAY_OFF' | 'COMP_OFF' | null, userId?: string, absenceTypeId?: string | null): Promise<void> {
    const entries = await this.prisma.rosterEntry.findMany({
      where:  { crewMemberId, date: toDbDate(date) },
      select: { dailyDutyId: true, dailyDuty: { select: { dailyOperationId: true } } },
    })
    const opId = entries.find(e => e.dailyDuty)?.dailyDuty?.dailyOperationId
    if (opId) return this.setDayOff(opId, crewMemberId, kind, userId, absenceTypeId)
    if (kind === 'COMP_OFF') await this.assertNotHoliday(date, crewMemberId)
    const typeId = kind ? absenceTypeId ?? await systemAbsenceTypeId(this.prisma, kind) : null
    await this.prisma.$transaction(async tx => {
      await tx.rosterEntry.deleteMany({ where: { crewMemberId, date: toDbDate(date), dailyDutyId: null } })
      if (kind) await tx.rosterEntry.create({ data: { crewMemberId, date: toDbDate(date), kind, absenceTypeId: typeId } })
    })
  }

  // no compensatory day off on a holiday (hour bank: a holiday worked is paid, never compensated)
  private async assertNotHoliday(date: Day, crewMemberId: string): Promise<void> {
    const m = await this.prisma.crewMember.findUnique({ where: { id: crewMemberId }, select: { employee: { select: { branchId: true } } } })
    const holiday = await this.prisma.holiday.findFirst({
      where:  { date: toDbDate(date), OR: [{ branchId: null }, ...(m ? [{ branchId: m.employee.branchId }] : [])] },
      select: { name: true },
    })
    if (holiday) throw new BadRequestException(`Folga compensada não pode ser em feriado (${holiday.name})`)
  }

  private async crewOfBlock(blockId: string): Promise<string[]> {
    const entries = await this.prisma.rosterEntry.findMany({
      where:  { dailyDuty: { pieces: { some: { dailyBlockId: blockId } } } },
      select: { crewMemberId: true },
    })
    return entries.map(e => e.crewMemberId)
  }

  private async log(
    op: { id: string; status: string }, userId: string | undefined, action: ChangeAction, entityType: string, entityId: string,
    crewMemberIds: (string | null)[], before: Record<string, unknown>, after: Record<string, unknown>,
  ): Promise<void> {
    if (op.status !== 'PUBLISHED') return
    await this.prisma.dailyChangeLog.create({
      data: {
        dailyOperationId: op.id, userId: userId ?? null, action, entityType, entityId,
        crewMemberIds: [...new Set(crewMemberIds.filter((m): m is string => !!m))],
        before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue,
      },
    })
  }

  private async operation(id: string) {
    const op = await this.prisma.dailyOperation.findUnique({ where: { id }, select: { id: true, scopeId: true, date: true, status: true, sources: true, crewContext: true } })
    if (!op) throw new NotFoundException('Dia operacional não encontrado')
    return op
  }

  private async editable(id: string) {
    const op = await this.operation(id)
    if (op.status === 'CLOSED') throw new BadRequestException('Dia encerrado — somente leitura')
    return op
  }

  // a crew change also moves the rest to/from the neighboring days of the same Scope
  // The day now; its neighbors (the rest across dates) in the background — the edit answers
  // without waiting for them.
  private async recalculateAround(op: { id: string; scopeId: string; date: Date }, crewMemberIds: (string | null)[]): Promise<void> {
    await this.recalculate(op.id)
    if (!crewMemberIds.some(Boolean)) return
    const day = dayOf(op.date)
    const neighbors = await this.prisma.dailyOperation.findMany({
      where:  { scopeId: op.scopeId, date: { in: [toDbDate(addDays(day, -1)), toDbDate(addDays(day, 1))] }, status: { not: 'CLOSED' } },
      select: { id: true },
    })
    for (const n of neighbors) this.recalculateLater(n.id)
  }

  // one background recalculation chain per day — never two of the same day at once
  private readonly pending = new Map<string, Promise<void>>()
  recalculateLater(id: string): void {
    const next = (this.pending.get(id) ?? Promise.resolve())
      .then(() => this.recalculate(id))
      .catch(err => this.logger.warn(`Recalculating day ${id} failed: ${err instanceof Error ? err.message : err}`))
      .finally(() => { if (this.pending.get(id) === next) this.pending.delete(id) })
    this.pending.set(id, next)
  }

  // ── recalculate ─────────────────────────────────────────────────────────────

  async recalculate(id: string): Promise<void> {
    const op = await this.operation(id)
    const day = dayOf(op.date)
    const sources = op.sources as unknown as DailySource[]

    const [settings, relief, duties, blocks, events, maxStand] = await Promise.all([
      this.crewConfig.get(op.scopeId),
      loadDailyRelief(this.prisma, id),
      this.prisma.dailyDuty.findMany({
        where:  { dailyOperationId: id },
        select: {
          id: true, role: true, kind: true, branchId: true, shiftId: true, summary: true, issues: true, isStale: true,
          pieces:     { select: { id: true, dailyBlockId: true, startMinutes: true, endMinutes: true, startLocalityId: true, endLocalityId: true, isStale: true, staleReason: true } },
          activities: { select: { id: true, type: true, intervalTypeId: true, startMinutes: true, endMinutes: true } },
        },
      }),
      this.prisma.dailyBlock.findMany({
        where:  { dailyOperationId: id },
        select: { id: true, branchId: true, depotId: true, vehicleType: true, vehicleId: true, issues: true, vehicle: { select: { vehicleType: true } } },
      }),
      this.prisma.dailyBlockEvent.findMany({ where: { dailyOperationId: id } }),
      defaultIntervalMaxMinutes(this.prisma, this.generalConfig),
    ])

    const intervalTypeIds = [...new Set(duties.flatMap(d => d.activities.map(a => a.intervalTypeId)).filter((x): x is string => !!x))]
    const pairs = new Map<string, { originId: string; destinationId: string }>()
    for (const d of duties) {
      const sorted = [...d.pieces].sort((a, b) => a.startMinutes - b.startMinutes)
      for (let i = 1; i < sorted.length; i++) {
        const from = sorted[i - 1].endLocalityId, to = sorted[i].startLocalityId
        if (from !== to) pairs.set(`${from}:${to}`, { originId: from, destinationId: to })
      }
    }
    const [paidTypes, walk, mealStops, branchRules] = await Promise.all([
      intervalTypeIds.length ? this.prisma.intervalType.findMany({ where: { id: { in: intervalTypeIds } }, select: { id: true, isPaid: true } }) : Promise.resolve([]),
      loadCrewWalk(this.prisma, [...new Set([...pairs.values()].flatMap(p => [p.originId, p.destinationId]))], [...pairs.values()]),
      settings.mealBreakIntervalTypeId
        ? this.prisma.routeLocality.findMany({ where: { allowsMealBreak: true, localityId: { not: null } }, select: { routeId: true, localityId: true } })
        : Promise.resolve([]),
      loadCrewBranchRules(this.prisma, { lineIds: sources.flatMap(s => s.lineIds) }),
    ])
    const isPaid = new Map(paidTypes.map(t => [t.id, t.isPaid]))

    const result = computeCrewPlan({
      settings,
      blocks: [...relief.values()],
      duties: duties.map(d => ({
        id: d.id, role: d.role, kind: d.kind, branchId: d.branchId, shiftId: null, shiftPinned: false,
        pieces: d.pieces.map(p => ({ ...p, vehicleBlockId: p.dailyBlockId })),
        activities: d.activities.map(a => ({ ...a, isPaidBreak: a.type === 'BREAK' && !!a.intervalTypeId && !!isPaid.get(a.intervalTypeId) })),
      })),
      walk,
      mealStops:     new Set(mealStops.map(s => `${s.routeId}:${s.localityId}`)),
      shifts:        branchRules.shifts,
      lineOperators: branchRules.lineOperators,
    })

    // ── the day's own checks ──
    const blockById = new Map(blocks.map(b => [b.id, b]))
    const dutyFacts: DutyFacts[] = duties.map(d => {
      const live = d.pieces.filter(p => !result.pieces.get(p.id)?.isStale && p.dailyBlockId)
      const lineIds = new Set<string>(), types = new Set<VehicleTypeValue>()
      for (const p of live) {
        const rb = relief.get(p.dailyBlockId!)
        for (const t of rb?.trips ?? []) if (t.arrivalMinutes > p.startMinutes && t.departureMinutes < p.endMinutes) lineIds.add(t.lineId)
        const b = blockById.get(p.dailyBlockId!)
        if (b) types.add(b.vehicle?.vehicleType ?? b.vehicleType)
      }
      return { id: d.id, role: d.role, kind: d.kind, branchId: d.branchId, summary: result.duties.get(d.id)!.summary, lineIds: [...lineIds], vehicleTypes: [...types] }
    })
    const crewFacts = await loadCrewFacts(this.prisma, this.rosterConfig, day, duties.map(d => d.id), op.crewContext)
    const dutyDayIssues = crewIssues(day, dutyFacts, crewFacts, settings.range.interShiftRest.floor)

    const live = events.filter(e => !e.isCancelled)
    const uncoveredByBlock = new Map<string, number>()
    for (const u of result.summary.uncovered) uncoveredByBlock.set(u.vehicleBlockId, (uncoveredByBlock.get(u.vehicleBlockId) ?? 0) + u.endMinutes - u.startMinutes)
    const blockFacts: BlockFacts[] = blocks.map(b => {
      const trips = live.filter(e => e.dailyBlockId === b.id && e.kind === 'TRIP')
      return {
        id: b.id, branchId: b.branchId, vehicleId: b.vehicleId, window: relief.get(b.id)?.window ?? null,
        lineIds: [...new Set(trips.map(t => t.lineId!))],
        requiredTypes: [...new Set(trips.map(t => t.requiredVehicleType).filter((t): t is VehicleTypeValue => !!t))],
        uncoveredMinutes: uncoveredByBlock.get(b.id) ?? 0,
      }
    })
    const blockDayIssues = await vehicleIssues(this.prisma, day, blockFacts)

    const bundleSizes = new Map<string, number>()
    for (const e of live) if (e.bundleId && e.dailyBlockId) bundleSizes.set(e.bundleId, (bundleSizes.get(e.bundleId) ?? 0) + 1)

    // ── write ──
    const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
    const counts: Record<string, number> = {}
    // advisories (info) aren't pendências
    const pending = <T extends { severity?: string }>(issues: T[]) => issues.filter(i => i.severity !== 'info')
    const count = (issues: { code: string; severity?: string }[]) => { for (const i of new Set(pending(issues).map(x => x.code))) counts[i] = (counts[i] ?? 0) + 1 }

    await this.prisma.$transaction(async tx => {
      for (const d of duties) {
        for (const p of d.pieces) {
          const st = result.pieces.get(p.id)
          if (st && (st.isStale !== p.isStale || st.staleReason !== p.staleReason)) {
            await tx.dailyDutyPiece.update({ where: { id: p.id }, data: { isStale: st.isStale, staleReason: st.staleReason } })
          }
        }
        const r = result.duties.get(d.id)!
        const issues = [...r.issues, ...(dutyDayIssues.get(d.id) ?? [])]
        count(issues)
        if (d.isStale === r.isStale && d.shiftId === r.shiftId && same(d.summary, r.summary) && same(d.issues, issues)) continue
        await tx.dailyDuty.update({
          where: { id: d.id },
          data:  { summary: r.summary, issues: issues as unknown as Prisma.InputJsonValue, hasIssues: pending(issues).length > 0, isStale: r.isStale, shiftId: r.shiftId },
        })
      }
      for (const b of blocks) {
        const evs = live.filter(e => e.dailyBlockId === b.id)
        const planIssues = validateBlock({
          depotId: b.depotId, branchId: b.branchId,
          trips: evs.filter(e => e.kind === 'TRIP').map(e => ({
            departureMinutes: e.startMinutes, arrivalMinutes: e.endMinutes,
            originLocalityId: e.originLocalityId!, destinationLocalityId: e.destinationLocalityId!, bundleId: e.bundleId, lineId: e.lineId ?? undefined,
          })),
          deadruns: evs.filter(e => e.kind === 'DEADRUN').map(e => ({
            type: e.deadrunType ?? 'DISPLACEMENT', departureMinutes: e.startMinutes, arrivalMinutes: e.endMinutes,
            originLocalityId: e.originLocalityId!, destinationLocalityId: e.destinationLocalityId!, bundleId: e.bundleId,
          })),
          intervals: evs.filter(e => e.kind === 'INTERVAL').map(e => ({ departureMinutes: e.startMinutes, arrivalMinutes: e.endMinutes, bundleId: e.bundleId })),
          maxStandMinutes: maxStand,
          bundleSizes,
          lineOperators: branchRules.lineOperators,
        })
        const issues: (typeof planIssues[number] | DailyIssue)[] = [...planIssues, ...(blockDayIssues.get(b.id) ?? [])]
        count(issues)
        if (same(b.issues, issues)) continue
        await tx.dailyBlock.update({ where: { id: b.id }, data: { issues: issues as unknown as Prisma.InputJsonValue, hasIssues: issues.length > 0 } })
      }

      const assigned = await tx.rosterEntry.count({ where: { dailyDuty: { dailyOperationId: id } } })
      const summary: DailySummary = {
        issues:         counts,
        dutyCount:      duties.length,
        assignedCount:  assigned,
        blockCount:     blocks.length,
        vehicleCount:   blocks.filter(b => b.vehicleId).length,
        uncoveredTrips: events.filter(e => e.kind === 'TRIP' && !e.dailyBlockId && !e.isCancelled).length,
        cancelledTrips: events.filter(e => e.kind === 'TRIP' && e.isCancelled).length,
      }
      await tx.dailyOperation.update({ where: { id }, data: { summary: summary as unknown as Prisma.InputJsonValue } })
    }, { timeout: 60_000 })
  }

  // ── board (the day's screen) ────────────────────────────────────────────────

  async getBoard(id: string) {
    const op = await this.prisma.dailyOperation.findUnique({
      where:   { id },
      include: { scope: { select: { name: true, lines: { select: { id: true, code: true } } } }, dayType: { select: { name: true } } },
    })
    if (!op) throw new NotFoundException('Dia operacional não encontrado')
    const day = dayOf(op.date)
    const date = op.date
    const sources = op.sources as unknown as DailySource[]

    const operators = await this.prisma.scopeOperator.findMany({
      where:  { scopeId: op.scopeId },
      select: { branchId: true, abbr: true, branch: { select: { name: true } } },
    })
    const branchIds = operators.map(o => o.branchId)

    const [blocks, events, duties, shifts, members, vehicles, entries, occurrences, holidays, planLabels, dayTypeNames] = await Promise.all([
      this.prisma.dailyBlock.findMany({ where: { dailyOperationId: id }, orderBy: { blockNumber: 'asc' } }),
      this.prisma.dailyBlockEvent.findMany({ where: { dailyOperationId: id }, orderBy: { startMinutes: 'asc' } }),
      this.prisma.dailyDuty.findMany({
        where:   { dailyOperationId: id },
        orderBy: [{ role: 'asc' }, { dutyNumber: 'asc' }],
        include: {
          pieces:        { orderBy: { sequence: 'asc' } },
          activities:    { orderBy: { startMinutes: 'asc' } },
          rosterEntries: { select: { crewMemberId: true, locked: true } },
        },
      }),
      this.prisma.crewShift.findMany({
        where:  { branches: { some: { branchId: { in: branchIds } } } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.crewMember.findMany({
        where:  { employee: { branchId: { in: branchIds }, status: 'ACTIVE' } },
        select: {
          id: true, role: true, restOffset: true,
          employee:    { select: { code: true, fullName: true, branchId: true } },
          restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } },
          shifts: {
            where:  { validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
            select: { shift: { select: { id: true, code: true, restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } } } } },
          },
        },
        orderBy: { employee: { code: 'asc' } },
      }),
      this.prisma.vehicle.findMany({
        where:   { branchId: { in: branchIds }, status: { not: 'DECOMMISSIONED' } },
        orderBy: { code: 'asc' },
        select: {
          id: true, code: true, branchId: true, vehicleType: true, status: true,
          unavailabilities: { where: { startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] }, select: { reason: true } },
        },
      }),
      this.prisma.rosterEntry.findMany({ where: { date }, select: { crewMemberId: true, kind: true, dailyDutyId: true } }),
      this.prisma.crewOccurrence.findMany({
        where:  { status: 'APPROVED', kind: 'ABSENCE', startDate: { lte: date }, endDate: { gte: date } },
        select: { crewMemberId: true, absenceType: { select: { name: true } } },
      }),
      this.prisma.holiday.findMany({ where: { date }, select: { branchId: true } }),
      this.prisma.vehiclePlan.findMany({ where: { id: { in: sources.map(s => s.vehiclePlanId) } }, select: { id: true, description: true } }),
      this.prisma.dayType.findMany({ where: { id: { in: sources.map(s => s.dayTypeId) } }, select: { id: true, name: true } }),
    ])
    // a generated day judges the rest cycle by the one it was generated with
    const cycles = await loadContextCycles(this.prisma, [op.crewContext])

    const lineCode = new Map(op.scope.lines.map(l => [l.id, l.code]))
    const localityIds = new Set<string>()
    for (const e of events) { if (e.originLocalityId) localityIds.add(e.originLocalityId); if (e.destinationLocalityId) localityIds.add(e.destinationLocalityId) }
    for (const d of duties) for (const p of d.pieces) { localityIds.add(p.startLocalityId); localityIds.add(p.endLocalityId) }
    const localities = await this.prisma.transitLocality.findMany({ where: { id: { in: [...localityIds] } }, select: { id: true, name: true, abbr: true } })

    const dutyIdsOf = new Map<string, string[]>()
    for (const e of entries) if (e.dailyDutyId) dutyIdsOf.set(e.crewMemberId, [...(dutyIdsOf.get(e.crewMemberId) ?? []), e.dailyDutyId])
    const ownDutyIds = new Set(duties.map(d => d.id))

    return {
      operation: {
        id: op.id, scopeId: op.scopeId, scopeName: op.scope.name, date: day, dayTypeName: op.dayType.name,
        status: op.status, summary: op.summary as DailySummary | null, publishedAt: op.publishedAt, closedAt: op.closedAt,
        sources: sources.map(s => ({
          ...s,
          vehiclePlanLabel: planLabels.find(p => p.id === s.vehiclePlanId)?.description ?? null,
          dayTypeName:      dayTypeNames.find(t => t.id === s.dayTypeId)?.name ?? null,
          lineCodes:        s.lineIds.map(l => lineCode.get(l) ?? '?'),
        })),
      },
      operators: operators.map(o => ({ branchId: o.branchId, abbr: o.abbr, name: o.branch.name })),
      shifts,
      lineCodes: op.scope.lines.map(l => l.code),
      localities,
      blocks: blocks.map(b => ({
        id: b.id, blockNumber: b.blockNumber, branchId: b.branchId, vehicleType: b.vehicleType, vehicleId: b.vehicleId,
        issues: (b.issues as unknown[] | null) ?? [], hasIssues: b.hasIssues,
        events: events.filter(e => e.dailyBlockId === b.id).map(e => ({
          id: e.id, kind: e.kind, deadrunType: e.deadrunType, lineCode: e.lineId ? lineCode.get(e.lineId) ?? '?' : null,
          startMinutes: e.startMinutes, endMinutes: e.endMinutes, isCancelled: e.isCancelled,
          originLocalityId: e.originLocalityId, destinationLocalityId: e.destinationLocalityId,
        })),
      })),
      uncoveredTrips: events.filter(e => e.kind === 'TRIP' && !e.dailyBlockId).map(e => ({
        id: e.id, lineCode: e.lineId ? lineCode.get(e.lineId) ?? '?' : '?', startMinutes: e.startMinutes, endMinutes: e.endMinutes, isCancelled: e.isCancelled,
      })),
      duties: duties.map(d => ({
        id: d.id, role: d.role, dutyNumber: d.dutyNumber, kind: d.kind, branchId: d.branchId, shiftId: d.shiftId,
        summary: d.summary as DutySummary | null, issues: (d.issues as unknown[] | null) ?? [], isStale: d.isStale, hasIssues: d.hasIssues,
        crewMemberId: d.rosterEntries[0]?.crewMemberId ?? null,
        locked:       d.rosterEntries[0]?.locked ?? false,
        pieces: d.pieces.map(p => ({
          id: p.id, dailyBlockId: p.dailyBlockId, startMinutes: p.startMinutes, endMinutes: p.endMinutes,
          startLocalityId: p.startLocalityId, endLocalityId: p.endLocalityId, isStale: p.isStale, staleReason: p.staleReason,
        })),
        activities: d.activities.map(a => ({ id: a.id, type: a.type, startMinutes: a.startMinutes, endMinutes: a.endMinutes })),
      })),
      // the operators' crew members and what each does on the day
      crew: members.map(m => {
        const mine = entries.filter(e => e.crewMemberId === m.id)
        const absence = occurrences.find(o => o.crewMemberId === m.id)
        const { pattern, offset } = restOfDay(op.crewContext, m.id, cycles, { pattern: m.restPattern ?? m.shifts[0]?.shift.restPattern ?? null, offset: m.restOffset })
        const isHoliday = holidays.some(h => !h.branchId || h.branchId === m.employee.branchId)
        const off = mine.find(e => !e.dailyDutyId)?.kind ?? null
        return {
          id: m.id, code: m.employee.code, name: m.employee.fullName, branchId: m.employee.branchId, role: m.role,
          shiftId: m.shifts[0]?.shift.id ?? null,
          dutyIds:      (dutyIdsOf.get(m.id) ?? []).filter(x => ownDutyIds.has(x)),
          // duties of another Scope's day on the same date
          elsewhere:    (dutyIdsOf.get(m.id) ?? []).filter(x => !ownDutyIds.has(x)).length,
          dayOff:       off,
          absence:      absence?.absenceType?.name ?? (absence ? 'Ausência' : null),
          patternOff:   !!pattern && !restPatternWorks(pattern, offset, day, isHoliday),
        }
      }),
      vehicles: vehicles.map(v => ({
        id: v.id, code: v.code, branchId: v.branchId, vehicleType: v.vehicleType,
        unavailable: v.status !== 'ACTIVE' ? v.status : v.unavailabilities[0]?.reason ?? null,
      })),
    }
  }
}
