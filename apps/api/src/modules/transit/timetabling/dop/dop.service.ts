import { Injectable } from '@nestjs/common'
import type { VehiclePlanLineSummary, DopPeriodSummary, DopLineDayTypeBreakdown, DopBranchBreakdown } from '@nyx/schemas'
import { dopSchema } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { resourceRegistry } from '../../../../core/resource-registry'
import { DayTypeService } from '../day-type/day-type.service'

// DOP has no Prisma model and no CRUD (docs/proposal/plan_dop_v1.md, decisão 2/3) —
// computed on-the-fly from whatever VehiclePlan is ACTIVE and in vigência for each
// (line, day) of the requested period. Registers itself into resourceRegistry the
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

  async getPeriodSummary(scopeId: string, from: Date, to: Date): Promise<DopPeriodSummary> {
    const db = this.prisma as any

    const [lines, activePlans, calendar, scopeOperators] = await Promise.all([
      db.transitLine.findMany({
        where:   { scopeId, isActive: true },
        select:  { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      db.vehiclePlan.findMany({
        where:  { scopeId, status: 'ACTIVE' },
        select: {
          id:        true,
          dayTypeId: true,
          validFrom: true,
          validTo:   true,
          lines:     { select: { lineId: true, summary: true } },
        },
      }),
      this.dayTypeService.getCalendarComposition(from, to),
      db.scopeOperator.findMany({ where: { scopeId }, select: { branchId: true, branch: { select: { name: true } } } }),
    ])

    const branchNameById = new Map<string, string>(scopeOperators.map((so: any) => [so.branchId, so.branch.name]))

    const lineIds        = lines.map((l: any) => l.id)
    const resolveDayType = await this.dayTypeService.buildDayTypeResolver(from, to, lineIds)

    const dates: Date[] = []
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) dates.push(new Date(d))

    const findActivePlan = (dayTypeId: string, lineId: string, date: Date) =>
      activePlans.find((p: any) =>
        p.dayTypeId === dayTypeId
        && (!p.validFrom || p.validFrom <= date)
        && (!p.validTo || p.validTo >= date)
        && p.lines.some((l: any) => l.lineId === lineId),
      ) ?? null

    const branchAcc = new Map<string, { branchId: string | null; kmProdutiva: number; kmOciosa: number }>()

    const lineSummaries = lines.map((line: any) => {
      const byDayType = new Map<string, DopLineDayTypeBreakdown>()
      let tripsMes = 0, kmProdutivaMes = 0, kmOciosaMes = 0
      let latest: VehiclePlanLineSummary | null = null

      for (const date of dates) {
        const dayType = resolveDayType(date, line.id)
        const plan    = findActivePlan(dayType.id, line.id, date)
        const summary = (plan?.lines.find((l: any) => l.lineId === line.id)?.summary as VehiclePlanLineSummary | undefined) ?? null

        let entry = byDayType.get(dayType.id)
        if (!entry) {
          entry = { dayTypeId: dayType.id, dayTypeCode: dayType.code, dayTypeName: dayType.name, days: 0, fleet: null, trips: 0, kmProdutiva: 0, kmOciosa: 0 }
          byDayType.set(dayType.id, entry)
        }
        entry.days++

        if (summary) {
          // idleKm is new (this same change) — a plan generated before it exists
          // still has a JSON summary without the field, so it needs a fallback;
          // the other fields here have always been part of the shape.
          const idleKm = summary.idleKm ?? 0
          entry.fleet     = summary.fleetSize
          entry.trips     += summary.dailyTrips
          entry.kmProdutiva += summary.dailyKm
          entry.kmOciosa    += idleKm
          tripsMes          += summary.dailyTrips
          kmProdutivaMes    += summary.dailyKm
          kmOciosaMes       += idleKm
          latest = summary

          // byBranch is new (same change as idleKm) — a plan summary generated
          // before it exists just contributes nothing to the empresa breakdown.
          for (const b of summary.byBranch ?? []) {
            const key = b.branchId ?? 'unassigned'
            const cur = branchAcc.get(key) ?? { branchId: b.branchId, kmProdutiva: 0, kmOciosa: 0 }
            cur.kmProdutiva += b.kmProdutiva
            cur.kmOciosa    += b.kmOciosa
            branchAcc.set(key, cur)
          }
        }
      }

      return {
        lineId: line.id, lineCode: line.code, lineName: line.name,
        byDayType: Array.from(byDayType.values()),
        tripsMes, kmProdutivaMes, kmOciosaMes,
        avgSpeed:              latest?.avgSpeed ?? null,
        occupancyIndex:        latest?.occupancyIndex ?? null,
        peakMorningInterval:   latest?.peakMorningInterval ?? null,
        peakAfternoonInterval: latest?.peakAfternoonInterval ?? null,
        offPeakInterval:       latest?.offPeakInterval ?? null,
        peakFleetMorning:      latest?.peakFleetMorning ?? null,
        peakFleetAfternoon:    latest?.peakFleetAfternoon ?? null,
        peakFleetOffPeak:      latest?.peakFleetOffPeak ?? null,
      }
    })

    const totals = { fleetOperacional: 0, kmProdutivaMes: 0, kmOciosaMes: 0, tripsMes: 0 }
    for (const l of lineSummaries) {
      totals.kmProdutivaMes += l.kmProdutivaMes
      totals.kmOciosaMes    += l.kmOciosaMes
      totals.tripsMes       += l.tripsMes
      // "Frota operacional" do escopo — soma, por linha, da frota do dayType mais
      // frequente no período (tipicamente dia útil, só por ter mais ocorrências,
      // sem precisar hardcodar qual DayType é "o" dia útil).
      const dominant = l.byDayType.reduce((a: DopLineDayTypeBreakdown | null, b: DopLineDayTypeBreakdown) => (!a || b.days > a.days ? b : a), null)
      totals.fleetOperacional += dominant?.fleet ?? 0
    }

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
      from: from.toISOString().slice(0, 10),
      to:   to.toISOString().slice(0, 10),
      calendar: calendar.map(c => ({ dayTypeId: c.dayTypeId, dayTypeCode: c.code, dayTypeName: c.name, days: c.days })),
      lines: lineSummaries,
      byBranch,
      totals,
    }
  }
}
