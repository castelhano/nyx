import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import {
  DAILY_ISSUE_LABEL, ROSTER_MAX_HORIZON_DAYS, dayRepairApplySchema, dayRepairQuerySchema, formatDutyNumber,
  type CrewRole, type DailyIssue, type DailyIssueCode, type DayRepairKind, type DayRepairProposal, type DutySummary, type RepairStep, type RosterSettings,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitRosterConfigService } from '../../settings/transit-roster-config.service'
import { TransitCrewConfigService } from '../../settings/transit-crew-config.service'
import { HourBankService } from '../../hour-bank/hour-bank.service'
import { dayOf, toDbDate } from '../../timetabling/plan-validity'
import { DailyOperationService } from '../daily-operation.service'
import { loadRosterInput, daysBetween } from '../roster/roster-generator.input'
import { carBlockSelect, loadCarFacts, type CarBlock } from '../roster/roster-vehicles'
import { repairCrew, type CrewRepairTarget } from './crew-repair.calc'
import { repairVehicles, type VehicleRepairBlock } from './vehicle-repair.calc'

// "Reparar" (Escala screen): proposes how to fix the period's pendências of one empresa/role,
// changing as little as it can (crew-repair.calc.ts, vehicle-repair.calc.ts), and applies the
// options the user confirms — each step checked against the day as it is now (409 when it
// changed), then written through DailyOperationService, which recalculates the days and logs the
// changes of a PUBLISHED one.

// pendências of the holder that take him off the duty, whatever the rule modes
const HARD: DailyIssueCode[] = ['CREW_ABSENT', 'CREW_ON_DAY_OFF', 'CREW_INACTIVE', 'NO_SHIFT', 'CREW_BRANCH_MISMATCH']
// the ones under a configurable rule — BLOCK takes him off, WARN only for someone without pendências
const RULE: Partial<Record<DailyIssueCode, keyof RosterSettings['ruleModes']>> = {
  SHIFT_WINDOW: 'shiftWindow', LINE_NOT_ALLOWED: 'lineAccess', VEHICLE_TYPE_BLOCKED: 'vehicleType',
  INTER_SHIFT_REST: 'interShiftRest', LICENSE_EXPIRED: 'license', COURSE_EXPIRED: 'course',
}

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

@Injectable()
export class DayRepairService {
  constructor(
    private readonly prisma:       PrismaService,
    private readonly rosterConfig: TransitRosterConfigService,
    private readonly crewConfig:   TransitCrewConfigService,
    private readonly hourBank:     HourBankService,
    private readonly daily:        DailyOperationService,
  ) {}

  async propose(kind: DayRepairKind, raw: unknown): Promise<DayRepairProposal> {
    const q = dayRepairQuerySchema.parse(raw)
    if (q.from > q.to || daysBetween(q.from, q.to) + 1 > ROSTER_MAX_HORIZON_DAYS) throw new BadRequestException('Período inválido')
    const items = kind === 'crew' ? await this.crew(q.branchId, q.role, q.from, q.to) : await this.vehicles(q.branchId, q.from, q.to)
    return { kind, from: q.from, to: q.to, items }
  }

  // ── crew ──────────────────────────────────────────────────────────────────

  private async crew(branchId: string, role: CrewRole, from: string, to: string) {
    const [{ input: rg, operationIds }, settings, bank] = await Promise.all([
      loadRosterInput(this.prisma, this.rosterConfig, this.crewConfig, {
        branchId, role, from, to, ensureMonthlyLoad: true, maxChanges: 99, restrictToBranchLines: false, vehicles: false,
        includePublished: true, extraStandby: [], compensate: false,
      }, { published: true }),
      this.rosterConfig.get(branchId),
      this.hourBank.positionsAt(branchId, from),
    ])
    const [operations, duties, compOffs] = await Promise.all([
      this.prisma.dailyOperation.findMany({ where: { id: { in: operationIds } }, select: { date: true, status: true } }),
      this.prisma.dailyDuty.findMany({
        where:  { id: { in: rg.duties.map(d => d.id) } },
        select: {
          id: true, dutyNumber: true, kind: true, summary: true, issues: true,
          rosterEntries: { select: { crewMemberId: true, crewMember: { select: { employee: { select: { code: true, fullName: true, preferredName: true } } } } } },
        },
      }),
      this.prisma.rosterEntry.findMany({
        where:  { crewMemberId: { in: rg.members.map(m => m.id) }, kind: 'COMP_OFF', source: 'GENERATED', date: { gte: toDbDate(from), lte: toDbDate(to) } },
        select: { crewMemberId: true, date: true },
      }),
    ])
    const published = new Set(operations.filter(o => o.status === 'PUBLISHED').map(o => dayOf(o.date)))
    const byId = new Map(duties.map(d => [d.id, d]))
    const memberIndex = new Map(rg.members.map((m, i) => [m.id, i]))
    const dayIndex = new Map(rg.days.map((d, i) => [d, i]))

    const holder: number[] = [], holderId: (string | null)[] = [], holderLabel: (string | null)[] = [], dutyLabel: string[] = []
    const targets: CrewRepairTarget[] = []
    rg.duties.forEach((d, di) => {
      const row = byId.get(d.id)
      const e = row?.rosterEntries[0]
      holder.push(e ? memberIndex.get(e.crewMemberId) ?? -2 : -1)
      holderId.push(e?.crewMemberId ?? null)
      const emp = e?.crewMember.employee
      holderLabel.push(emp ? `${emp.code} ${emp.preferredName || emp.fullName}` : null)
      const s = row?.summary as DutySummary | null
      dutyLabel.push(`${d.standby ? 'Plantão' : formatDutyNumber(role, row?.dutyNumber ?? 0)}${s?.startMinutes != null ? ` · ${clock(s.startMinutes)}–${clock(s.endMinutes!)}` : ''}`)
      if (d.standby) return
      if (!e) { targets.push({ di, reason: DAILY_ISSUE_LABEL.DUTY_UNASSIGNED, warnOnly: false }); return }
      const codes = ((row.issues ?? []) as unknown as DailyIssue[]).filter(i => i.crewMemberId === e.crewMemberId && i.severity !== 'info').map(i => i.code)
      const hard = codes.filter(c => HARD.includes(c) || (RULE[c] && settings.ruleModes[RULE[c]] === 'BLOCK'))
      const warn = codes.filter(c => RULE[c] && settings.ruleModes[RULE[c]] === 'WARN')
      if (hard.length) targets.push({ di, reason: hard.map(c => DAILY_ISSUE_LABEL[c]).join(' · '), warnOnly: false })
      else if (warn.length) targets.push({ di, reason: warn.map(c => DAILY_ISSUE_LABEL[c]).join(' · '), warnOnly: true })
    })

    const compOff = rg.members.map(() => rg.days.map(() => false))
    for (const c of compOffs) {
      const mi = memberIndex.get(c.crewMemberId), t = dayIndex.get(dayOf(c.date))
      if (mi != null && t != null) compOff[mi][t] = true
    }
    const balance = rg.members.map(m => {
      const p = bank?.get(m.id)
      return p ? p.expiring + p.lot - p.negative : null
    })

    return repairCrew({ rg, holder, holderId, holderLabel, dutyLabel, targets, compOff, balance, published: rg.days.map(d => published.has(d)) })
  }

  // ── vehicles ──────────────────────────────────────────────────────────────

  private async vehicles(branchId: string, from: string, to: string) {
    const settings = await this.rosterConfig.get(branchId)
    const range = { gte: toDbDate(from), lte: toDbDate(to) }
    const rows = await this.prisma.dailyBlock.findMany({
      where:  { branchId, operation: { date: range, status: { in: ['PLANNED', 'PUBLISHED'] } } },
      select: { ...carBlockSelect, blockNumber: true, vehicleId: true, issues: true, operation: { select: { date: true, status: true } } },
    })
    if (!rows.length) return []
    const blocks: VehicleRepairBlock[] = rows.map(r => ({
      ...(r as unknown as CarBlock), blockNumber: r.blockNumber, vehicleId: r.vehicleId,
      issues: ((r.issues ?? []) as unknown as DailyIssue[]).map(i => i.code), published: r.operation.status === 'PUBLISHED',
    }))
    const [facts, others] = await Promise.all([
      loadCarFacts(this.prisma, branchId, blocks, settings.habitualVehicleDays),
      this.prisma.dailyBlock.findMany({
        where:  { vehicleId: { not: null }, operation: { date: range }, NOT: { id: { in: rows.map(r => r.id) } } },
        select: { vehicleId: true, operation: { select: { date: true } } },
      }),
    ])
    const busy = new Map<string, Set<string>>()
    for (const o of others) {
      const d = dayOf(o.operation.date)
      busy.set(d, (busy.get(d) ?? new Set()).add(o.vehicleId!))
    }
    const current = [...new Set(rows.flatMap(r => r.vehicleId ?? []))]
    const code = new Map((await this.prisma.vehicle.findMany({ where: { id: { in: current } }, select: { id: true, code: true } })).map(v => [v.id, v.code]))
    for (const v of facts.vehicles) code.set(v.id, v.code)
    return repairVehicles({ facts, blocks, busy, code })
  }

  // ── apply ─────────────────────────────────────────────────────────────────

  // The steps in order: each must find what it expects (the day may have changed since the
  // proposal) — checked over all of them before writing anything.
  async apply(kind: DayRepairKind, raw: unknown, userId?: string): Promise<{ changed: number }> {
    const dto = dayRepairApplySchema.parse(raw)
    const steps = dto.steps
    if (steps.some(s => (kind === 'crew' ? s.type === 'vehicle' : s.type !== 'vehicle'))) throw new BadRequestException('Passo de outro tipo de reparo')
    await this.check(steps)

    // folgas compensadas cancelled first — the crew steps then find the day free
    for (const s of steps) if (s.type === 'compOff') await this.daily.setDayOffOn(s.date, s.crewMemberId, null, userId)
    const crew = steps.flatMap(s => (s.type === 'crew' ? [{ dutyId: s.dutyId, crewMemberId: s.to }] : []))
    if (crew.length) await this.daily.assignMany(crew, userId)
    for (const s of steps) {
      if (s.type !== 'vehicle') continue
      const block = await this.prisma.dailyBlock.findUnique({ where: { id: s.blockId }, select: { dailyOperationId: true } })
      await this.daily.assignVehicle(block!.dailyOperationId, s.blockId, s.to, userId)
    }
    return { changed: steps.length }
  }

  private async check(steps: RepairStep[]): Promise<void> {
    const dutyIds = steps.flatMap(s => (s.type === 'crew' ? [s.dutyId] : []))
    const blockIds = steps.flatMap(s => (s.type === 'vehicle' ? [s.blockId] : []))
    const [entries, blocks, offs] = await Promise.all([
      this.prisma.rosterEntry.findMany({ where: { dailyDutyId: { in: dutyIds } }, select: { dailyDutyId: true, crewMemberId: true } }),
      this.prisma.dailyBlock.findMany({ where: { id: { in: blockIds } }, select: { id: true, vehicleId: true, operation: { select: { status: true } } } }),
      this.prisma.rosterEntry.findMany({
        where:  { OR: steps.flatMap(s => (s.type === 'compOff' ? [{ crewMemberId: s.crewMemberId, date: toDbDate(s.date), kind: 'COMP_OFF' as const, source: 'GENERATED' }] : [])) },
        select: { crewMemberId: true, date: true },
      }),
    ])
    const duties = await this.prisma.dailyDuty.findMany({ where: { id: { in: dutyIds } }, select: { id: true, operation: { select: { status: true, date: true } } } })
    const dateOf = new Map(duties.map(d => [d.id, dayOf(d.operation.date)]))
    if ([...duties, ...blocks].some(x => x.operation.status === 'CLOSED')) throw new ConflictException('Um dos dias foi encerrado — gere o reparo de novo')
    const crewOf = new Map<string, string | null>(dutyIds.map(id => [id, null]))
    for (const e of entries) crewOf.set(e.dailyDutyId!, e.crewMemberId)
    const carOf = new Map(blocks.map(b => [b.id, b.vehicleId]))
    const offSet = new Set(offs.map(o => `${o.crewMemberId}|${dayOf(o.date)}`))
    for (const s of steps) {
      if (s.type === 'compOff') {
        if (!offSet.delete(`${s.crewMemberId}|${s.date}`)) throw new ConflictException('A folga compensada já não existe — gere o reparo de novo')
        continue
      }
      const map = s.type === 'crew' ? crewOf : carOf
      const id = s.type === 'crew' ? s.dutyId : s.blockId
      if ((map.get(id) ?? null) !== s.from) {
        throw new ConflictException('A escala mudou desde a proposta — gere o reparo de novo (ou a mesma pessoa / carro foi escolhida em duas opções)')
      }
      map.set(id, s.to)
    }
    // one crew member on two of the chosen options' duties of a day (e.g. the same plantão twice)
    const taken = new Set<string>()
    for (const s of steps) {
      if (s.type !== 'crew' || !s.to) continue
      const k = `${s.to}|${dateOf.get(s.dutyId)}`
      if (taken.has(k)) throw new BadRequestException('O mesmo operador foi escolhido em duas opções do mesmo dia')
      taken.add(k)
    }
  }
}
