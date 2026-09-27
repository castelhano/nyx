import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  CREW_ROLES, dayTypePatternSchema,
  type CrewPlanSummary, type DutySummary, type VehiclePlanSummary,
  type DopCrewPeriodSummary, type DopCrewMetrics, type DopCrewLine, type DopCrewBranch,
  type DopCrewDayTypeQuality, type DopCrewRoleQuality, type DopCrewStaffing, type DopCrewCost,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { DayTypeService } from '../day-type/day-type.service'
import { TransitCrewCostConfigService } from '../../settings/transit-crew-cost-config.service'
import { TransitRosterConfigService } from '../../settings/transit-roster-config.service'
import { periodDates, findActivePlan, inForce, formatDay } from './dop-resolution'

// DOP, visão Escala (docs/proposal/plan_dop_crew_v1.md). Same (day, line) resolution as the
// vehicle view, plus the VehiclePlan's ACTIVE CrewPlan in force on the day. Per-line numbers
// come from CrewPlanSummary.byLine; per-duty data (inter-shift rest, averages, multi-line) is
// read from the duties of the crew plan in force on the latest day of each DayType.

const OVERTIME_PREMIUM = 1.5
const NIGHT_PREMIUM    = 0.2
const NIGHT_HOUR       = 52.5   // reduced night hour, in clock minutes

type Summary = CrewPlanSummary | null
type Slice   = CrewPlanSummary['byLine'][number]

const emptyMetrics = (): DopCrewMetrics => ({ dutyShare: 0, workMinutes: 0, paidMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, cost: 0 })
const emptyByRole  = () => Object.fromEntries(CREW_ROLES.map(r => [r, emptyMetrics()])) as Record<string, DopCrewMetrics>

function addSlice(target: Record<string, DopCrewMetrics>, s: Slice, snapshot: boolean) {
  const m = target[s.role] ??= emptyMetrics()
  if (snapshot) m.dutyShare = s.dutyShare
  else m.dutyShare += s.dutyShare
  m.workMinutes     += s.workMinutes
  m.paidMinutes     += s.paidMinutes
  m.overtimeMinutes += s.overtimeMinutes
  m.nightMinutes    += s.nightMinutes
}

@Injectable()
export class DopCrewService {
  constructor(
    private readonly prisma:         PrismaService,
    private readonly dayTypeService: DayTypeService,
    private readonly crewCost:       TransitCrewCostConfigService,
    private readonly roster:         TransitRosterConfigService,
  ) {}

  // branchId: only that operator's duties (Duty.branchId) and vehicles (VehicleBlock.branchId)
  async getPeriodSummary(scopeId: string, from: Date, to: Date, branchId?: string): Promise<DopCrewPeriodSummary> {
    const ofBranch = (b: string | null) => !branchId || b === branchId

    const [lines, vehiclePlans, calendar, scopeOperators, dayTypes, costSettings, rosterSettings] = await Promise.all([
      this.prisma.transitLine.findMany({ where: { scopeId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.vehiclePlan.findMany({
        where:  { scopeId, status: 'ACTIVE' },
        select: {
          id: true, dayTypeId: true, validFrom: true, validTo: true, summary: true,
          lines:     { select: { lineId: true } },
          crewPlans: { where: { status: 'ACTIVE' }, select: { id: true, validFrom: true, validTo: true, summary: true } },
        },
      }),
      this.dayTypeService.getCalendarComposition(from, to),
      this.prisma.scopeOperator.findMany({ where: { scopeId }, select: { branchId: true, branch: { select: { name: true } } } }),
      this.prisma.dayType.findMany({ where: { pattern: { not: Prisma.DbNull } }, select: { id: true, pattern: true }, orderBy: { priority: 'asc' } }),
      this.crewCost.get(scopeId),
      this.roster.get(),
    ])

    const branchNameById = new Map(scopeOperators.map(so => [so.branchId, so.branch.name]))
    const resolveDayType = await this.dayTypeService.buildDayTypeResolver(from, to, lines.map(l => l.id))
    const dates          = periodDates(from, to)

    const crewPlanOf = (vp: (typeof vehiclePlans)[number] | null, date: Date) =>
      vp?.crewPlans.find(cp => inForce(cp, date)) ?? null

    // ── typical week: ISO weekday → DayType, weekdays patterns only, by priority ──
    const weekDayType = new Map<number, string>()
    for (const dt of dayTypes) {
      const p = dayTypePatternSchema.safeParse(dt.pattern)
      if (!p.success || p.data.type !== 'weekdays') continue
      for (const d of p.data.days) if (!weekDayType.has(d)) weekDayType.set(d, dt.id)
    }
    const workdayCounts = new Map<string, number>()
    for (let d = 1; d <= 5; d++) {
      const id = weekDayType.get(d)
      if (id) workdayCounts.set(id, (workdayCounts.get(id) ?? 0) + 1)
    }
    const referenceDayTypeId = [...workdayCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    // ── (day, line) resolution ────────────────────────────────────────────────
    const lineRows = new Map<string | null, { lineId: string | null; lineCode: string; lineName: string; byDayType: Map<string, Record<string, DopCrewMetrics>>; byRole: Record<string, DopCrewMetrics> }>()
    const rowOf = (lineId: string | null, code: string, name: string) => {
      let row = lineRows.get(lineId)
      if (!row) { row = { lineId, lineCode: code, lineName: name, byDayType: new Map(), byRole: emptyByRole() }; lineRows.set(lineId, row) }
      return row
    }
    for (const l of lines) rowOf(l.id, l.code, l.name)

    const branchAcc      = new Map<string | null, Record<string, DopCrewMetrics>>()
    const noCrewDays     = new Map<string, number>()
    const latestPlanByDt = new Map<string, string>()   // dayTypeId → crewPlanId, latest day wins
    const summaryById    = new Map<string, Summary>()
    let referenceFleet   = 0
    let referenceVpId: string | null = null
    let coveredMinutes   = 0

    const addToLine = (lineId: string | null, code: string, name: string, dayTypeId: string, slices: Slice[]) => {
      const row = rowOf(lineId, code, name)
      let dt = row.byDayType.get(dayTypeId)
      if (!dt) { dt = emptyByRole(); row.byDayType.set(dayTypeId, dt) }
      // byDayType: dutyShare is a snapshot, minutes summed over the days of that type
      for (const s of slices) { addSlice(dt, s, true); addSlice(row.byRole, s, false) }
    }

    for (const date of dates) {
      const usedToday = new Map<string, string>()   // crewPlanId → dayTypeId
      let missingCrew: string | null = null

      for (const line of lines) {
        const dayType = resolveDayType(date, line.id)
        const vp      = findActivePlan(vehiclePlans, dayType.id, line.id, date)
        if (!vp) continue
        // plan-level fleet — per-line fleets would count a shared vehicle once per line
        if (dayType.id === referenceDayTypeId) {
          referenceFleet = (vp.summary as VehiclePlanSummary | null)?.fleetCount ?? referenceFleet
          referenceVpId  = vp.id
        }
        const cp = crewPlanOf(vp, date)
        if (!cp) { missingCrew ??= dayType.id; continue }

        const summary = cp.summary as Summary
        summaryById.set(cp.id, summary)
        if (!usedToday.has(cp.id)) usedToday.set(cp.id, dayType.id)
        addToLine(line.id, line.code, line.name, dayType.id, (summary?.byLine ?? []).filter(s => s.lineId === line.id && ofBranch(s.branchId ?? null)))
      }

      if (missingCrew) noCrewDays.set(missingCrew, (noCrewDays.get(missingCrew) ?? 0) + 1)

      // plan-level parts, once per crew plan in use that day
      for (const [cpId, dayTypeId] of usedToday) {
        const summary = summaryById.get(cpId) ?? null
        latestPlanByDt.set(dayTypeId, cpId)
        coveredMinutes += branchId
          ? (summary?.coveredByBranch ?? []).find(c => c.branchId === branchId)?.minutes ?? 0
          : summary?.coveredMinutes ?? 0
        const noLine = (summary?.byLine ?? []).filter(s => s.lineId === null && ofBranch(s.branchId ?? null))
        if (noLine.length) addToLine(null, 'Sem linha', 'Jornadas sem viagem', dayTypeId, noLine)
        for (const b of (summary?.byBranch ?? []).filter(b => ofBranch(b.branchId))) {
          const acc = branchAcc.get(b.branchId) ?? emptyByRole()
          const m = acc[b.role] ??= emptyMetrics()
          m.dutyShare += b.dutyCount; m.paidMinutes += b.paidMinutes
          m.overtimeMinutes += b.overtimeMinutes; m.nightMinutes += b.nightMinutes
          branchAcc.set(b.branchId, acc)
        }
      }
    }

    // ── staffing: typical week in force on each day ───────────────────────────
    const dutiesOnWeekday = (weekday: number, date: Date, role: string) => {
      const dtId = weekDayType.get(weekday)
      if (!dtId) return 0
      const vp = vehiclePlans.find(p => p.dayTypeId === dtId && inForce(p, date)) ?? null
      const s  = crewPlanOf(vp, date)?.summary as Summary
      if (!branchId) return s?.byRole[role] ?? 0
      return s?.byBranch?.find(b => b.branchId === branchId && b.role === role)?.dutyCount ?? 0
    }
    const staffing: Record<string, DopCrewStaffing> = {}
    const staffDays: Record<string, number> = {}   // Σ over the days of the staffing in force
    for (const role of CREW_ROLES) {
      let best: DopCrewStaffing = { estimate: 0, weekday: 0, saturday: 0, sunday: 0 }
      staffDays[role] = 0
      for (const date of dates) {
        const weekday  = Math.max(...[1, 2, 3, 4, 5].map(w => dutiesOnWeekday(w, date, role)))
        const saturday = dutiesOnWeekday(6, date, role)
        const sunday   = dutiesOnWeekday(7, date, role)
        const estimate = Math.max(weekday, saturday + sunday)
        staffDays[role] += estimate
        if (estimate > best.estimate) best = { estimate, weekday, saturday, sunday }
      }
      staffing[role] = best
    }

    // ── costs (current parameters, proportional by days ÷ 30) ─────────────────
    const lineList = [...lineRows.values()]
    const costs: Record<string, DopCrewCost> = {}
    for (const role of CREW_ROLES) {
      const p        = costSettings.byRole[role]
      const hourRate = p.monthlyHours > 0 ? p.baseSalary / p.monthlyHours : 0
      const overtimeMin = lineList.reduce((s, l) => s + (l.byRole[role]?.overtimeMinutes ?? 0), 0)
      const nightMin    = lineList.reduce((s, l) => s + (l.byRole[role]?.nightMinutes ?? 0), 0)
      const fixed    = staffDays[role] * p.baseSalary / 30
      const overtime = overtimeMin / 60 * hourRate * OVERTIME_PREMIUM
      const night    = nightMin / NIGHT_HOUR * hourRate * NIGHT_PREMIUM
      const charges  = (fixed + overtime + night) * p.chargesPercent / 100
      const benefits = staffDays[role] * p.benefitsPerEmployee / 30
      costs[role] = { fixed, overtime, night, charges, benefits, total: fixed + overtime + night + charges + benefits }
    }
    const allocate = (rows: Record<string, DopCrewMetrics>[]) => {
      for (const role of CREW_ROLES) {
        const paid = rows.reduce((s, r) => s + (r[role]?.paidMinutes ?? 0), 0)
        for (const r of rows) if (r[role]) r[role].cost = paid > 0 ? costs[role].total * r[role].paidMinutes / paid : 0
      }
    }
    allocate(lineList.map(l => l.byRole))
    allocate([...branchAcc.values()])

    // ── per-duty data of the crew plan in force on the latest day of each DayType ──
    const snapshotIds = [...new Set(latestPlanByDt.values())]
    const duties = snapshotIds.length
      ? await this.prisma.duty.findMany({
          where:  { crewPlanId: { in: snapshotIds }, ...(branchId ? { branchId } : {}) },
          select: { crewPlanId: true, role: true, kind: true, summary: true, isStale: true, hasIssues: true },
        })
      : []
    const { floor, idealMin } = rosterSettings.range.interShiftRest
    const quality: DopCrewDayTypeQuality[] = [...latestPlanByDt].map(([dayTypeId, cpId]) => {
      const byRole: Record<string, DopCrewRoleQuality> = {}
      for (const role of CREW_ROLES) {
        const ds      = duties.filter(d => d.crewPlanId === cpId && d.role === role)
        const working = ds.map(d => d.summary as DutySummary | null).filter((s): s is DutySummary => !!s && s.pieceCount > 0)
        const avg     = (f: (s: DutySummary) => number) => working.length ? working.reduce((s, x) => s + f(x), 0) / working.length : 0
        const rest    = working.map(s => s.interShiftRestMinutes).filter((m): m is number => m != null)
        const byKind: Record<string, number> = {}
        for (const d of ds) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1
        byRole[role] = {
          dutyCount:            ds.length,
          byKind,
          issueDutyCount:       ds.filter(d => d.hasIssues).length,
          staleDutyCount:       ds.filter(d => d.isStale).length,
          interShiftBelowFloor: rest.filter(m => m < floor).length,
          interShiftBelowIdeal: rest.filter(m => m >= floor && m < idealMin).length,
          avgSpreadMinutes:     avg(s => s.spreadMinutes),
          avgWorkMinutes:       avg(s => s.workMinutes),
          avgBreakMinutes:      avg(s => s.breakMinutes),
          avgVehicleChanges:    avg(s => s.vehicleChanges),
          avgLineChanges:       avg(s => s.lineChanges),
          // lineCount is missing on summaries written before it existed
          multiLineCount:       working.filter(s => (s.lineCount ?? 0) >= 2).length,
        }
      }
      return { dayTypeId, score: summaryById.get(cpId)?.score ?? null, byRole }
    })

    // plan-level fleetCount has no branch split — count that branch's blocks instead
    if (branchId && referenceVpId) {
      referenceFleet = await this.prisma.vehicleBlock.count({ where: { vehiclePlanId: referenceVpId, branchId } })
    }

    const byBranch: DopCrewBranch[] = [...branchAcc].map(([branchId, byRole]) => ({
      branchId,
      branchName: branchId ? (branchNameById.get(branchId) ?? branchId) : 'Não informado',
      byRole,
    }))
    // Sem linha last
    const linesOut: DopCrewLine[] = lineList
      .sort((a, b) => (a.lineId === null ? 1 : b.lineId === null ? -1 : 0))
      .map(l => ({ lineId: l.lineId, lineCode: l.lineCode, lineName: l.lineName, byRole: l.byRole, byDayType: [...l.byDayType].map(([dayTypeId, byRole]) => ({ dayTypeId, byRole })) }))

    return {
      scopeId,
      from: formatDay(from),
      to:   formatDay(to),
      days: dates.length,
      calendar: calendar.map(c => ({ dayTypeId: c.dayTypeId, dayTypeCode: c.code, dayTypeName: c.name, days: c.days })),
      referenceDayTypeId,
      referenceFleet,
      noCrewDays: [...noCrewDays].map(([dayTypeId, days]) => ({ dayTypeId, days })),
      lines: linesOut,
      byBranch,
      quality,
      staffing,
      costs,
      coveredMinutes,
    }
  }
}
