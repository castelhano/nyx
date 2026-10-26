import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  ROSTER_MAX_HORIZON_DAYS, restGroupIndex, restGroupLabel, restPatternWorks, shiftIdealDistance,
  type CrewRole, type DailyIssue, type DailySource, type RosterQuality, type VehiclePlanConstraints, type DutySummary, type RosterBoard, type RosterBoardCell, type RosterShortage,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitCrewConfigService } from '../../settings/transit-crew-config.service'
import { TransitRosterConfigService } from '../../settings/transit-roster-config.service'
import { HourBankService } from '../../hour-bank/hour-bank.service'
import { addDays, dayOf, inForceOn, toDbDate, type Day } from '../../timetabling/plan-validity'
import { RosterModel, diagnoseShortage, lastOn, rosterQuality, signatureGroup } from './roster-generator.calc'
import { daysBetween, loadRosterInput } from './roster-generator.input'
import { generatedRest, loadContextCycles, restOfDay } from '../crew-context'
import { outdatedOperations } from '../daily-outdated'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface RosterSuggestion {
  crewMemberId: string
  code:    string
  name:    string
  // change in the crew member's own score (×100) — higher is better
  points:  number
  warns:   number
  reasons: string[]
}

// The "Escala" screen's data (RosterBoard) for one empresa/role over [from, to]: the days of the
// Scopes it operates, their duties (its own, or without an empresa in a Scope it operates
// alone), its active crew members of the role (plus whoever else holds one of these duties),
// what each has on each day and the load figures the generator works with.
@Injectable()
export class RosterBoardService {
  constructor(
    private readonly prisma:       PrismaService,
    private readonly rosterConfig: TransitRosterConfigService,
    private readonly crewConfig:   TransitCrewConfigService,
    private readonly hourBank:     HourBankService,
  ) {}

  async board(branchId: string, role: CrewRole, from: Day, to: Day): Promise<RosterBoard> {
    if (!branchId || !DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new BadRequestException('Período inválido')
    if (daysBetween(from, to) + 1 > ROSTER_MAX_HORIZON_DAYS) throw new BadRequestException(`O período pode ter no máximo ${ROSTER_MAX_HORIZON_DAYS} dias`)
    const range = { gte: toDbDate(from), lte: toDbDate(to) }
    const dates: Day[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)

    const scopeOps = await this.prisma.scopeOperator.findMany({
      where:  { branchId },
      select: { scopeId: true, scope: { select: { name: true, _count: { select: { operators: true } } } } },
    })
    const scopeIds = scopeOps.map(s => s.scopeId)
    const aloneIn  = scopeOps.filter(s => s.scope._count.operators === 1).map(s => s.scopeId)
    const scopeName = new Map(scopeOps.map(s => [s.scopeId, s.scope.name]))

    const operations = await this.prisma.dailyOperation.findMany({
      where:  { scopeId: { in: scopeIds }, date: range },
      select: { id: true, scopeId: true, date: true, status: true, sources: true, crewContext: true },
    })
    const opById = new Map(operations.map(o => [o.id, o]))
    const outdated = await outdatedOperations(this.prisma, operations)

    const [duties, shifts, vehicles, offTypes] = await Promise.all([
      this.prisma.dailyDuty.findMany({
        where: {
          dailyOperationId: { in: operations.map(o => o.id) }, role,
          OR: [{ branchId }, { branchId: null, operation: { scopeId: { in: aloneIn } } }],
        },
        orderBy: { dutyNumber: 'asc' },
        select: {
          id: true, dailyOperationId: true, dutyNumber: true, kind: true, shiftId: true, summary: true, issues: true, isStale: true,
          pieces: {
            orderBy: { startMinutes: 'asc' },
            select: { startMinutes: true, endMinutes: true, isStale: true, dailyBlockId: true, block: { select: { blockNumber: true, vehicleId: true, issues: true, vehicle: { select: { code: true } } } } },
          },
          rosterEntries: { select: { crewMemberId: true, locked: true } },
          sourceDutyId: true,
        },
      }),
      this.prisma.crewShift.findMany({ where: { branches: { some: { branchId } } }, orderBy: { code: 'asc' }, select: { id: true, code: true } }),
      this.prisma.vehicle.findMany({ where: { branchId, status: 'ACTIVE' }, orderBy: { code: 'asc' }, select: { id: true, code: true, vehicleType: true } }),
      this.prisma.crewAbsenceType.findMany({
        where:   { isActive: true, effect: { in: ['DAY_OFF', 'COMP_OFF'] } },
        orderBy: [{ systemKey: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
        select:  { id: true, code: true, name: true, effect: true, systemKey: true },
      }),
    ])

    // the trips of the duties' blocks — each piece's main line
    const blockIds = [...new Set(duties.flatMap(d => d.pieces.flatMap(p => p.dailyBlockId ?? [])))]
    const trips = await this.prisma.dailyBlockEvent.findMany({
      where:  { dailyBlockId: { in: blockIds }, kind: 'TRIP', isCancelled: false },
      select: { dailyBlockId: true, lineId: true, startMinutes: true, endMinutes: true, bundleId: true },
    })
    const lines = await this.prisma.transitLine.findMany({ where: { id: { in: [...new Set(trips.flatMap(t => t.lineId ?? []))] } }, select: { id: true, code: true } })
    const lineCode = new Map(lines.map(l => [l.id, l.code]))
    const tripsOf = new Map<string, typeof trips>()
    for (const t of trips) tripsOf.set(t.dailyBlockId!, [...(tripsOf.get(t.dailyBlockId!) ?? []), t])
    const mainLine = (blockId: string | null, start: number, end: number) => {
      const minutes = new Map<string, number>()
      for (const t of tripsOf.get(blockId ?? '') ?? []) {
        const m = Math.min(t.endMinutes, end) - Math.max(t.startMinutes, start)
        if (m > 0 && t.lineId) minutes.set(t.lineId, (minutes.get(t.lineId) ?? 0) + m)
      }
      const top = [...minutes.entries()].sort((a, b) => b[1] - a[1])[0]
      return top ? lineCode.get(top[0]) ?? null : null
    }

    // ── crew members: the empresa's of the role, and anyone else holding a duty here ──
    const holders = [...new Set(duties.flatMap(d => d.rosterEntries.map(e => e.crewMemberId)))]
    const pattern = { select: { name: true, pattern: true, staggered: true, anchorDate: true, offOnHolidays: true } }
    const members = await this.prisma.crewMember.findMany({
      where:   { OR: [{ role, employee: { branchId, status: 'ACTIVE' } }, { id: { in: holders } }] },
      orderBy: { employee: { code: 'asc' } },
      select: {
        id: true, role: true, isRosterable: true, restOffset: true,
        employee:    { select: { code: true, fullName: true, preferredName: true, branchId: true } },
        restPattern: pattern,
        shifts: {
          where:  { validFrom: { lte: toDbDate(to) }, OR: [{ validTo: null }, { validTo: { gte: toDbDate(from) } }] },
          orderBy: { validFrom: 'asc' },
          select: { validFrom: true, validTo: true, shift: { select: { id: true, restPattern: pattern } } },
        },
      },
    })
    const memberIds = members.map(m => m.id)
    const [entries, occurrences, holidays, changeLogs, covers] = await Promise.all([
      this.prisma.rosterEntry.findMany({ where: { crewMemberId: { in: memberIds }, date: range }, select: { crewMemberId: true, date: true, kind: true, dailyDutyId: true, locked: true, absenceTypeId: true } }),
      this.prisma.crewOccurrence.findMany({
        where:  { crewMemberId: { in: memberIds }, status: { in: ['REQUESTED', 'APPROVED'] }, startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(from) } },
        select: {
          id: true, crewMemberId: true, kind: true, status: true, startDate: true, endDate: true, startNotBefore: true, endNotAfter: true,
          absenceType: { select: { name: true, systemKey: true } }, coverCrewMember: { select: { employee: { select: { code: true } } } },
        },
      }),
      this.prisma.holiday.findMany({ where: { date: range, OR: [{ branchId: null }, { branchId }] }, select: { date: true } }),
      this.prisma.dailyChangeLog.findMany({
        where:  { dailyOperationId: { in: operations.filter(o => o.status !== 'PLANNED').map(o => o.id) }, crewMemberIds: { hasSome: memberIds } },
        select: { dailyOperationId: true, crewMemberIds: true },
      }),
      // férias the crew members cover as ferista — on their days, the titular's rest pattern
      this.prisma.crewOccurrence.findMany({
        where:  { coverCrewMemberId: { in: memberIds }, status: 'APPROVED', startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(from) } },
        select: {
          coverCrewMemberId: true, startDate: true, endDate: true,
          crewMember: {
            select: {
              restOffset: true, restPattern: pattern, employee: { select: { code: true } },
              shifts: {
                where:  { validFrom: { lte: toDbDate(to) }, OR: [{ validTo: null }, { validTo: { gte: toDbDate(from) } }] },
                select: { validFrom: true, validTo: true, shift: { select: { restPattern: pattern } } },
              },
            },
          },
        },
      }),
    ])
    // `${crewMemberId}|${date}` changed after the day was published
    const changed = new Set(changeLogs.flatMap(l => l.crewMemberIds.map(id => `${id}|${dayOf(opById.get(l.dailyOperationId)!.date)}`)))
    const holidaySet = new Set(holidays.map(h => dayOf(h.date)))

    // the generator's figures for the current allocation
    const [{ stats, quality }, generations, bank] = await Promise.all([
      this.stats(branchId, role, from, to, entries), this.generations(branchId, role, from, to), this.hourBank.balances(branchId),
    ])

    // the days' crew contexts (the rest cycles each was generated with), per date
    const cycles = await loadContextCycles(this.prisma, operations.map(o => o.crewContext))
    const contextOf = (crewMemberId: string, date: string) =>
      operations.find(o => dayOf(o.date) === date && generatedRest(o.crewContext, crewMemberId))?.crewContext ?? null

    const cells: RosterBoardCell[] = []
    for (const m of members) {
      for (const date of dates) {
        const bound = m.shifts.find(s => dayOf(s.validFrom) <= date && (!s.validTo || dayOf(s.validTo) >= date))?.shift
        // covering a titular on férias: his rest pattern
        const cover = covers.find(c => c.coverCrewMemberId === m.id && dayOf(c.startDate) <= date && dayOf(c.endDate) >= date)?.crewMember
        const tp = cover ? cover.restPattern ?? cover.shifts.find(s => dayOf(s.validFrom) <= date && (!s.validTo || dayOf(s.validTo) >= date))?.shift.restPattern ?? null : null
        // a generated day: the rest he was generated with
        const rest = restOfDay(contextOf(m.id, date), m.id, cycles, { pattern: tp ?? m.restPattern ?? bound?.restPattern ?? null, offset: tp ? cover!.restOffset : m.restOffset })
        const holiday = holidaySet.has(date)
        const patternOff = !!rest.pattern && !restPatternWorks(rest.pattern, rest.offset, date, holiday)
        const mine = entries.filter(e => e.crewMemberId === m.id && dayOf(e.date) === date)
        const reqs = occurrences.filter(o => o.crewMemberId === m.id && dayOf(o.startDate) <= date && dayOf(o.endDate) >= date)
        const wasChanged = changed.has(`${m.id}|${date}`)
        if (!patternOff && !holiday && !mine.length && !reqs.length && !wasChanged && !cover) continue
        cells.push({
          crewMemberId: m.id, date, patternOff, holiday, changed: wasChanged, covering: cover?.employee.code ?? null,
          entries:  mine.map(e => ({ kind: e.kind, dailyDutyId: e.dailyDutyId, locked: e.locked, absenceTypeId: e.absenceTypeId })),
          requests: reqs.map(o => ({
            id: o.id, kind: o.kind, status: o.status as 'REQUESTED' | 'APPROVED', startNotBefore: o.startNotBefore, endNotAfter: o.endNotAfter,
            vacation: o.absenceType?.systemKey === 'VACATION',
            label: o.kind === 'ABSENCE'
              ? `${o.absenceType?.name ?? 'Ausência'}${o.coverCrewMember ? ` · ferista ${o.coverCrewMember.employee.code}` : ''}`
              : [o.startNotBefore != null && `após ${hm(o.startNotBefore)}`, o.endNotAfter != null && `até ${hm(o.endNotAfter)}`].filter(Boolean).join(', '),
          })),
        })
      }
    }

    // the preferred crew members (read live): the logical duty's, then its trip groups' (the
    // days' vehicle plans — VehiclePlan.constraints.bundleCrew)
    const dutyPins = new Map((await this.prisma.duty.findMany({
      where:  { id: { in: [...new Set(duties.flatMap(d => d.sourceDutyId ?? []))] } },
      select: { id: true, constraints: true },
    })).map(d => [d.id, (d.constraints as { crewMemberIds?: string[] } | null)?.crewMemberIds ?? []]))
    const bundleCrew = new Map<string, string[]>()
    for (const p of await this.prisma.vehiclePlan.findMany({
      where:  { id: { in: [...new Set(operations.flatMap(o => ((o.sources ?? []) as unknown as DailySource[]).map(s => s.vehiclePlanId)))] } },
      select: { constraints: true },
    })) {
      for (const [b, ids] of Object.entries((p.constraints as VehiclePlanConstraints | null)?.bundleCrew ?? {})) bundleCrew.set(b, ids)
    }
    const preferredOf = (d: (typeof duties)[number]) => {
      const groups = new Set(d.pieces.flatMap(p => (tripsOf.get(p.dailyBlockId ?? '') ?? [])
        .filter(t => t.bundleId && Math.min(t.endMinutes, p.endMinutes) > Math.max(t.startMinutes, p.startMinutes)).map(t => t.bundleId!)))
      return [...new Set([...(dutyPins.get(d.sourceDutyId ?? '') ?? []), ...[...groups].flatMap(b => bundleCrew.get(b) ?? [])])]
    }
    const boardDuties = duties.map(d => {
      const op = opById.get(d.dailyOperationId)!
      const s = d.summary as DutySummary | null
      const blocks = new Map<string, RosterBoard['duties'][number]['blocks'][number]>()
      for (const p of d.pieces) {
        if (!p.dailyBlockId || !p.block || blocks.has(p.dailyBlockId)) continue
        blocks.set(p.dailyBlockId, {
          id: p.dailyBlockId, number: p.block.blockNumber, vehicleId: p.block.vehicleId, vehicleCode: p.block.vehicle?.code ?? null,
          issues: (p.block.issues as DailyIssue[] | null) ?? [],
        })
      }
      const pieces = d.pieces.filter(p => !p.isStale).map(p => ({ start: p.startMinutes, end: p.endMinutes, line: mainLine(p.dailyBlockId, p.startMinutes, p.endMinutes), blockId: p.dailyBlockId }))
      return {
        id: d.id, operationId: op.id, date: dayOf(op.date), scope: scopeName.get(op.scopeId) ?? '', number: d.dutyNumber, kind: d.kind, shiftId: d.shiftId,
        start: s?.startMinutes ?? null, end: s?.endMinutes ?? null, paid: s?.paidMinutes ?? 0,
        lines: [...new Set(pieces.flatMap(p => p.line ?? []))],
        pieces, blocks: [...blocks.values()],
        issues: (d.issues as DailyIssue[] | null) ?? [],
        crewMemberId: d.rosterEntries[0]?.crewMemberId ?? null,
        locked: d.rosterEntries[0]?.locked ?? false,
        preferred: preferredOf(d),
        isStale: d.isStale,
      }
    })

    return {
      from, to,
      quality, generations,
      multiScope: scopeIds.length > 1,
      days: dates.map(date => {
        const ops = operations.filter(o => dayOf(o.date) === date)
        const mine = boardDuties.filter(d => d.date === date)
        return {
          date,
          operations: ops.map(o => ({ id: o.id, scopeId: o.scopeId, scope: scopeName.get(o.scopeId) ?? '', status: o.status, outdated: outdated.get(o.id) ?? null })),
          duties: mine.length, assigned: mine.filter(d => d.crewMemberId).length,
          issues: mine.filter(d => d.issues.some(i => i.severity !== 'info') || d.blocks.some(b => b.issues.length)).length,
        }
      }),
      shifts,
      duties: boardDuties,
      members: members.map(m => {
        const current = m.shifts.find(s => dayOf(s.validFrom) <= from && (!s.validTo || dayOf(s.validTo) >= from)) ?? m.shifts[0]
        const p = m.restPattern ?? current?.shift.restPattern ?? null
        const group = p ? restGroupIndex(p, m.restOffset) : null
        return {
          id: m.id, code: m.employee.code, name: m.employee.preferredName || m.employee.fullName,
          shiftId: current?.shift.id ?? null,
          rest: p ? `${p.name}${group != null && p.pattern.length > 7 ? ` · ${restGroupLabel(group)}` : ''}` : null,
          rosterable: m.isRosterable,
          foreign: m.role !== role || m.employee.branchId !== branchId,
          stats: stats.get(m.id) ?? null,
          bank:  bank.get(m.id) ?? null,
        }
      }),
      cells,
      vehicles,
      offTypes: offTypes.map(t => ({ id: t.id, code: t.code, name: t.name, effect: t.effect as 'DAY_OFF' | 'COMP_OFF', system: !!t.systemKey })),
    }
  }

  // The best crew members for a duty, as the generator would score them: free on the date,
  // allowed by the rules (BLOCK never, WARN flagged), the change in their own score and why.
  async suggest(dutyId: string): Promise<RosterSuggestion[]> {
    const duty = await this.prisma.dailyDuty.findUnique({
      where:  { id: dutyId },
      select: { role: true, branchId: true, rosterEntries: { select: { crewMemberId: true } }, operation: { select: { date: true, scopeId: true } } },
    })
    if (!duty) throw new NotFoundException('Tabela não encontrada')
    const branchId = duty.branchId ?? (await this.prisma.scopeOperator.findMany({ where: { scopeId: duty.operation.scopeId }, select: { branchId: true } }))
      .map(o => o.branchId).find((_, __, all) => all.length === 1)
    if (!branchId) return []
    const date = dayOf(duty.operation.date)
    const { input } = await loadRosterInput(this.prisma, this.rosterConfig, this.crewConfig, {
      branchId, role: duty.role, from: date, to: date, ensureMonthlyLoad: true, maxChanges: 99, restrictToBranchLines: false, vehicles: false, includePublished: true, extraStandby: [], compensate: false,
    }, { published: true })
    const di = input.duties.findIndex(d => d.id === dutyId)
    if (di < 0) return []
    const d = input.duties[di]
    const model = new RosterModel(input)
    // who already holds something on the date
    const busy = new Set((await this.prisma.rosterEntry.findMany({
      where:  { crewMemberId: { in: input.members.map(m => m.id) }, date: toDbDate(date) },
      select: { crewMemberId: true },
    })).map(e => e.crewMemberId))
    const holder = duty.rosterEntries[0]?.crewMemberId

    const out: RosterSuggestion[] = []
    input.members.forEach((m, mi) => {
      if (m.id === holder || busy.has(m.id)) return
      const rule = model.ruleOf(mi, di)
      if (rule < 0) return
      const without = model.evaluate(mi, Int32Array.from([-1]))
      const withIt  = model.evaluate(mi, Int32Array.from([di]))
      if (withIt.hard) return
      const reasons: string[] = []
      const w = m.windows[0]
      if (w) {
        const off = shiftIdealDistance(w, d.start, d.end)
        reasons.push(off ? `${off} min fora do ideal do turno` : 'no ideal do turno')
      }
      const grade = Math.max(0, ...d.lineMinutes.map(l => m.prefGrade[l.lineId] ?? 0))
      if (grade > 0) reasons.push(grade >= 1 ? 'linha preferida principal' : 'linha preferida')
      const gap = m.targetMinutes - without.worked
      if (Math.abs(gap) >= 60) reasons.push(gap > 0 ? `${hm(Math.round(gap))} abaixo da carga` : `${hm(Math.round(-gap))} acima da carga`)
      const prev = lastOn(m, 0, m.lastSignatures)[signatureGroup(d.signature)]
      if (prev) reasons.push(prev === d.signature ? 'mesma tabela dos últimos dias' : 'troca de tabela')
      if (withIt.warns > 0) reasons.push('fere uma regra (permitida com pendência)')
      out.push({
        crewMemberId: m.id, code: m.code, name: m.name,
        points: Math.round((withIt.score - without.score) * 100), warns: withIt.warns, reasons,
      })
    })
    return out.sort((a, b) => a.warns - b.warns || b.points - a.points).slice(0, 8)
  }

  // Why the period's duties without anyone have none (the generator's diagnosis, on the current
  // allocation): grouped by reason and shift.
  async shortage(branchId: string, role: CrewRole, from: Day, to: Day): Promise<RosterShortage[]> {
    if (!branchId || !DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new BadRequestException('Período inválido')
    const { input } = await loadRosterInput(this.prisma, this.rosterConfig, this.crewConfig, {
      branchId, role, from, to, ensureMonthlyLoad: true, maxChanges: 99, restrictToBranchLines: false, vehicles: false, includePublished: true, extraStandby: [], compensate: false,
    }, { published: true })
    if (!input.duties.length) return []
    const model = new RosterModel(input)
    const dutyIndex = new Map(input.duties.map((d, i) => [d.id, i]))
    const memberIndex = new Map(input.members.map((m, i) => [m.id, i]))
    const assign = input.members.map(() => new Int32Array(input.days.length).fill(-1))
    const holder = new Int32Array(input.duties.length).fill(-1)
    const entries = await this.prisma.rosterEntry.findMany({ where: { dailyDutyId: { in: input.duties.map(d => d.id) } }, select: { crewMemberId: true, dailyDutyId: true } })
    for (const e of entries) {
      const di = dutyIndex.get(e.dailyDutyId!)!
      const mi = memberIndex.get(e.crewMemberId)
      // held by someone outside the empresa / role: covered all the same
      holder[di] = mi ?? input.members.length
      if (mi != null) assign[mi][input.duties[di].day] = di
    }
    return diagnoseShortage(model, assign, holder)
  }

  // the accepted generations overlapping [from, to], newest first
  private async generations(branchId: string, role: CrewRole, from: Day, to: Day): Promise<RosterBoard['generations']> {
    const rows = await this.prisma.rosterGeneration.findMany({
      where:   { branchId, role, fromDate: { lte: toDbDate(to) }, toDate: { gte: toDbDate(from) } },
      orderBy: { acceptedAt: 'desc' },
      take:    50,
    })
    const users = new Map((await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap(r => r.userId ?? []))] } }, select: { id: true, name: true },
    })).map(u => [u.id, u.name]))
    return rows.map(r => {
      const s = r.summary as { duties?: number; quality?: RosterQuality }
      return {
        id: r.id, from: dayOf(r.fromDate), to: dayOf(r.toDate), acceptedAt: r.acceptedAt.toISOString(),
        user: r.userId ? users.get(r.userId) ?? null : null, assigned: r.assigned, duties: s.duties ?? r.assigned, changed: r.changed,
        quality: s.quality ?? null,
      }
    })
  }

  // load, changes and preferred-line share per crew member, as the generator scores them, and the
  // allocation's quality over the period (the PUBLISHED days included)
  private async stats(branchId: string, role: CrewRole, from: Day, to: Day, entries: { crewMemberId: string; dailyDutyId: string | null }[]) {
    const out = new Map<string, NonNullable<RosterBoard['members'][number]['stats']>>()
    const { input } = await loadRosterInput(this.prisma, this.rosterConfig, this.crewConfig, {
      branchId, role, from, to, ensureMonthlyLoad: true, maxChanges: 99, restrictToBranchLines: false, vehicles: false, includePublished: true, extraStandby: [], compensate: false,
    }, { published: true })
    if (!input.members.length) return { stats: out, quality: null }
    const model = new RosterModel(input)
    const rows: Int32Array[] = []
    const dutyIndex = new Map(input.duties.map((d, i) => [d.id, i]))
    input.members.forEach((m, mi) => {
      const row = new Int32Array(input.days.length).fill(-1)
      for (const e of entries) {
        if (e.crewMemberId !== m.id || !e.dailyDutyId) continue
        const di = dutyIndex.get(e.dailyDutyId)
        if (di != null && m.status[input.duties[di].day] === 'free') row[input.duties[di].day] = di
      }
      rows.push(row)
      const ev = model.evaluate(mi, row)
      out.set(m.id, { workedMinutes: ev.worked, targetMinutes: Math.round(m.targetMinutes), changes: ev.changes, prefShare: ev.prefShare == null ? null : Math.round(ev.prefShare) })
    })
    return { stats: out, quality: input.duties.length ? { ...rosterQuality(model, rows), fixedCar: await this.fixedCar(entries) } : null }
  }

  // the worked days of crew members with a preferred vehicle, and those driving it on some piece
  private async fixedCar(entries: { crewMemberId: string; dailyDutyId: string | null }[]) {
    const preferred = new Map((await this.prisma.crewMember.findMany({
      where:  { id: { in: [...new Set(entries.map(e => e.crewMemberId))] }, preferredVehicleId: { not: null } },
      select: { id: true, preferredVehicleId: true },
    })).map(c => [c.id, c.preferredVehicleId!]))
    const mine = entries.filter(e => e.dailyDutyId && preferred.has(e.crewMemberId))
    const cars = new Map((await this.prisma.dailyDuty.findMany({
      where:  { id: { in: mine.map(e => e.dailyDutyId!) }, kind: { not: 'STANDBY' } },
      select: { id: true, pieces: { where: { isStale: false }, select: { block: { select: { vehicleId: true } } } } },
    })).map(d => [d.id, d.pieces.map(p => p.block?.vehicleId)]))
    let met = 0, days = 0
    for (const e of mine) {
      const vs = cars.get(e.dailyDutyId!)
      if (!vs) continue
      days++
      if (vs.includes(preferred.get(e.crewMemberId))) met++
    }
    return { met, days }
  }
}

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
