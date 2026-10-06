import { Injectable } from '@nestjs/common'
import type { VehiclePlanLineSummary, VehiclePlanSummary, VehicleBlockSummary, DopPeriodSummary, DopLineDayTypeBreakdown, DopBranchBreakdown } from '@nyx/schemas'
import { dopSchema } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { resourceRegistry } from '../../../../core/resource-registry'
import { DayTypeService } from '../day-type/day-type.service'
import { periodDates, findActivePlan, formatDay } from './dop-resolution'

// DOP has no Prisma model and no CRUD — computed on-the-fly from whatever VehiclePlan is
// ACTIVE and in vigência for each (line, day) of the requested period (no snapshot:
// reopening a past month after editing a plan may change its numbers). Registers itself into resourceRegistry the
// same way BaseSettingsService does (base-settings.service.ts:38-39), without
// extending it — there's no get()/put() against a Settings row here, just a report.
@Injectable()
export class DopService {
  constructor(
    private readonly prisma:        PrismaService,
    private readonly dayTypeService: DayTypeService,
  ) {
    resourceRegistry.push({ domain: 'transit', resource: 'dop', schema: dopSchema })
  }

  // branchId: only that operator's share — its blocks' km, trips and vehicles on each line
  async getPeriodSummary(scopeId: string, from: Date, to: Date, branchId?: string): Promise<DopPeriodSummary> {
    const db = this.prisma as any

    const [lines, activePlans, calendar, scopeOperators] = await Promise.all([
      db.transitLine.findMany({
        where:   { scopeId, isActive: true },
        select:  { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      db.vehiclePlan.findMany({
        where:  { scopeId, status: { in: ['ACTIVE', 'SUPERSEDED'] } },
        select: {
          id:        true,
          dayTypeId: true,
          validFrom: true,
          validTo:   true,
          summary:   true,
          lines:     { select: { lineId: true, summary: true } },
          blocks:    { select: { branchId: true, summary: true } },
        },
      }),
      this.dayTypeService.getCalendarComposition(from, to),
      db.scopeOperator.findMany({ where: { scopeId }, select: { branchId: true, branch: { select: { name: true } } } }),
    ])

    const branchNameById = new Map<string, string>(scopeOperators.map((so: any) => [so.branchId, so.branch.name]))

    const lineIds        = lines.map((l: any) => l.id)
    const resolveDayType = await this.dayTypeService.buildDayTypeResolver(from, to, lineIds)

    const dates = periodDates(from, to)

    const branchAcc = new Map<string, { branchId: string | null; kmProdutiva: number; kmOciosa: number }>()
    // day → the plans in force on it (any line), for the Scope-level fleet and hours
    const plansByDay = new Map<string, Set<any>>()

    const lineSummaries = lines.map((line: any) => {
      const byDayType = new Map<string, DopLineDayTypeBreakdown>()
      let tripsMes = 0, kmProdutivaMes = 0, kmOciosaMes = 0
      // a summary per day type — the snapshot values come from the predominant one
      const snapshotByDayType = new Map<string, VehiclePlanLineSummary>()

      for (const date of dates) {
        const dayType = resolveDayType(date, line.id)
        const plan    = findActivePlan<any>(activePlans, dayType.id, line.id, date)
        const summary = (plan?.lines.find((l: any) => l.lineId === line.id)?.summary as VehiclePlanLineSummary | undefined) ?? null
        if (plan) {
          const day = formatDay(date)
          if (!plansByDay.has(day)) plansByDay.set(day, new Set())
          plansByDay.get(day)!.add(plan)
        }

        let entry = byDayType.get(dayType.id)
        if (!entry) {
          entry = { dayTypeId: dayType.id, dayTypeCode: dayType.code, dayTypeName: dayType.name, days: 0, fleet: null, trips: 0, kmProdutiva: 0, kmOciosa: 0 }
          byDayType.set(dayType.id, entry)
        }
        entry.days++

        // with a branch filter, the line only counts where that branch runs it
        const share = branchId ? (summary?.byBranch ?? []).find(b => b.branchId === branchId) : undefined
        if (summary && (!branchId || share)) {
          // idleKm is new (this same change) — a plan generated before it exists
          // still has a JSON summary without the field, so it needs a fallback;
          // the other fields here have always been part of the shape.
          // byBranch trips/fleet are newer still — missing until the plan is recalculated.
          const fleet  = share ? share.fleet ?? 0 : summary.fleetSize
          const trips  = share ? share.trips ?? 0 : summary.dailyTrips
          const km     = share ? share.kmProdutiva : summary.dailyKm
          const idleKm = share ? share.kmOciosa : summary.idleKm ?? 0
          entry.fleet     = fleet
          entry.trips     += trips
          entry.kmProdutiva += km
          entry.kmOciosa    += idleKm
          tripsMes          += trips
          kmProdutivaMes    += km
          kmOciosaMes       += idleKm
          snapshotByDayType.set(dayType.id, summary)

          // byBranch is new (same change as idleKm) — a plan summary generated
          // before it exists just contributes nothing to the empresa breakdown.
          for (const b of (summary.byBranch ?? []).filter(b => !branchId || b.branchId === branchId)) {
            const key = b.branchId ?? 'unassigned'
            const cur = branchAcc.get(key) ?? { branchId: b.branchId, kmProdutiva: 0, kmOciosa: 0 }
            cur.kmProdutiva += b.kmProdutiva
            cur.kmOciosa    += b.kmOciosa
            branchAcc.set(key, cur)
          }
        }
      }

      const dominant = Array.from(byDayType.values())
        .filter(e => snapshotByDayType.has(e.dayTypeId))
        .reduce<DopLineDayTypeBreakdown | null>((a, b) => (!a || b.days > a.days ? b : a), null)
      const snap = dominant ? snapshotByDayType.get(dominant.dayTypeId)! : null
      // with an operator filter the peaks have no per-operator split — its fleet on the day stands in
      const fleetOperacional = !snap ? null
        : branchId ? dominant!.fleet
        : Math.max(snap.peakFleetMorning ?? 0, snap.peakFleetAfternoon ?? 0)

      return {
        lineId: line.id, lineCode: line.code, lineName: line.name,
        byDayType: Array.from(byDayType.values()),
        tripsMes, kmProdutivaMes, kmOciosaMes,
        avgSpeed:              snap?.avgSpeed ?? null,
        occupancyIndex:        snap?.occupancyIndex ?? null,
        peakMorningInterval:   snap?.peakMorningInterval ?? null,
        peakAfternoonInterval: snap?.peakAfternoonInterval ?? null,
        offPeakInterval:       snap?.offPeakInterval ?? null,
        peakFleetMorning:      snap?.peakFleetMorning ?? null,
        peakFleetAfternoon:    snap?.peakFleetAfternoon ?? null,
        peakFleetOffPeak:      snap?.peakFleetOffPeak ?? null,
        fleetOperacional,
      }
    })

    const totals = { fleetOperacional: 0, vehicleHoursMes: 0, kmProdutivaMes: 0, kmOciosaMes: 0, tripsMes: 0 }
    for (const l of lineSummaries) {
      totals.kmProdutivaMes += l.kmProdutivaMes
      totals.kmOciosaMes    += l.kmOciosaMes
      totals.tripsMes       += l.tripsMes
    }

    // Scope level, per day, over the plans in force: vehicles at the larger peak (each once,
    // however many lines it runs — not the lines' peaks summed) and vehicle hours. With an
    // operator filter: the hours of its blocks, and its lines' operational fleets summed (the
    // plan peaks have no per-operator split).
    const fleetByDay: number[] = []
    for (const plans of plansByDay.values()) {
      let fleet = 0
      for (const plan of plans) {
        const s = plan.summary as VehiclePlanSummary | null
        if (!branchId) fleet += Math.max(s?.peakFleetMorning ?? 0, s?.peakFleetAfternoon ?? 0)
        for (const b of plan.blocks as { branchId: string | null; summary: VehicleBlockSummary | null }[]) {
          if (!branchId || b.branchId === branchId) totals.vehicleHoursMes += (b.summary?.totalMinutes ?? 0) / 60
        }
      }
      if (fleet > 0) fleetByDay.push(fleet)
    }
    totals.fleetOperacional = branchId
      ? lineSummaries.reduce((s: number, l: { fleetOperacional: number | null }) => s + (l.fleetOperacional ?? 0), 0)
      : mostCommon(fleetByDay)

    const byBranch: DopBranchBreakdown[] = Array.from(branchAcc.values())
      .map(b => ({
        branchId:    b.branchId,
        branchName:  b.branchId ? (branchNameById.get(b.branchId) ?? b.branchId) : 'Não informado',
        kmProdutiva: b.kmProdutiva,
        kmOciosa:    b.kmOciosa,
      }))
      .sort((a, b) => (b.kmProdutiva + b.kmOciosa) - (a.kmProdutiva + a.kmOciosa))

    return {
      scopeId,
      from: formatDay(from),
      to:   formatDay(to),
      calendar: calendar.map(c => ({ dayTypeId: c.dayTypeId, dayTypeCode: c.code, dayTypeName: c.name, days: c.days })),
      lines: lineSummaries,
      byBranch,
      totals,
    }
  }
}

// the value most days share (ties → the larger) — the period's typical day, without
// hardcoding which day type is "the" weekday; 0 with no day at all
function mostCommon(values: number[]): number {
  const count = new Map<number, number>()
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1)
  let best = 0, bestCount = 0
  for (const [v, n] of count) if (n > bestCount || (n === bestCount && v > best)) { best = v; bestCount = n }
  return best
}
