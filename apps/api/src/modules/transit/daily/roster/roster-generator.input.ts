import { restPatternWorks, type DutySummary, type RosterGeneratorParams, type ShiftWindow } from '@nyx/schemas'
import type { PrismaService } from '../../../../prisma/prisma.service'
import type { TransitCrewConfigService } from '../../settings/transit-crew-config.service'
import type { TransitRosterConfigService } from '../../settings/transit-roster-config.service'
import { loadCrewBranchRules } from '../../timetabling/crew-plan/crew-branch-rules'
import { addDays, dayOf, toDbDate, type Day } from '../../timetabling/plan-validity'
import { effectiveWindow } from '../daily-checks'
import type { RgDuty, RgFixed, RgInput, RgMember, RgStatus } from './roster-generator.calc'

// Reads everything the generator needs for one empresa/role over [from, to]:
//  - the duties of the PLANNED days of the Scopes the empresa operates (its own duties, or the
//    ones without an empresa in a Scope it operates alone) — not already held by a fixed entry
//  - its rosterable, active crew members of the role, with what each day means for them
//  - the load window (load period start .. to): minutes worked and changes before `from`
//
// A fixed entry stays as it is: locked, on a day no longer PLANNED, a compensatory day off or a
// day off entered by hand.

export interface RosterContext {
  input:      RgInput
  scopeIds:   string[]
  // the PLANNED days in the horizon
  operationIds: string[]
}

const HISTORY_DAYS = 45

// `published`: also the duties of PUBLISHED days (the roster screen's suggestions — the generator
// itself only touches PLANNED days)
export async function loadRosterInput(
  prisma: PrismaService, rosterConfig: TransitRosterConfigService, crewConfig: TransitCrewConfigService, params: RosterGeneratorParams,
  options: { published?: boolean } = {},
): Promise<RosterContext> {
  const { branchId, role, from, to } = params
  const days: Day[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  const dayIndex = new Map(days.map((d, i) => [d, i]))

  const settings = await rosterConfig.get(branchId)
  const periodStart = loadPeriodStart(from, settings.loadPeriodStartDay)
  const periodDays  = daysBetween(periodStart, loadPeriodStart(addDays(periodStart, 32), settings.loadPeriodStartDay))
  const historyFrom = [periodStart, addDays(from, -HISTORY_DAYS)].sort()[0]

  const operators = await prisma.scopeOperator.findMany({ where: { branchId }, select: { scopeId: true, scope: { select: { _count: { select: { operators: true } } } } } })
  const scopeIds  = operators.map(o => o.scopeId)
  const aloneIn   = operators.filter(o => o.scope._count.operators === 1).map(o => o.scopeId)
  const crewSettings = await crewConfig.get(scopeIds[0])

  const operations = await prisma.dailyOperation.findMany({
    where:  { scopeId: { in: scopeIds }, date: { gte: toDbDate(from), lte: toDbDate(to) }, status: { in: options.published ? ['PLANNED', 'PUBLISHED'] : ['PLANNED'] } },
    select: { id: true, date: true, scopeId: true },
  })

  // ── crew members ──
  const members = await prisma.crewMember.findMany({
    where:  { role, isRosterable: true, employee: { branchId, status: 'ACTIVE' } },
    orderBy: { employee: { code: 'asc' } },
    select: {
      id: true, notBeforeMinutes: true, notAfterMinutes: true, restOffset: true, blockedVehicleTypes: true,
      licenseExpiresAt: true, courseExpiresAt: true, weeklyHours: true, overtimePreference: true,
      employee: {
        select: {
          code: true, fullName: true, preferredName: true,
          contracts: { where: { status: 'ACTIVE' }, orderBy: { startDate: 'desc' }, take: 1, select: { weeklyHours: true } },
        },
      },
      restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } },
      lines:       { select: { lineId: true, access: true, rank: true } },
      shifts: {
        where:  { validFrom: { lte: toDbDate(to) }, OR: [{ validTo: null }, { validTo: { gte: toDbDate(from) } }] },
        select: {
          validFrom: true, validTo: true,
          shift: { select: { ...shiftWindowSelect, isActive: true, restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } } } },
        },
      },
    },
  })
  const memberIds = members.map(m => m.id)

  const [duties, entries, occurrences, holidays] = await Promise.all([
    prisma.dailyDuty.findMany({
      where: {
        dailyOperationId: { in: operations.map(o => o.id) },
        role,
        OR: [{ branchId }, { branchId: null, operation: { scopeId: { in: aloneIn } } }],
      },
      orderBy: [{ dailyOperationId: 'asc' }, { dutyNumber: 'asc' }],
      select: {
        id: true, kind: true, shiftId: true, summary: true, dailyOperationId: true,
        rosterEntries: { select: { locked: true } },
      },
    }),
    prisma.rosterEntry.findMany({
      where:  { crewMemberId: { in: memberIds }, date: { gte: toDbDate(historyFrom), lte: toDbDate(addDays(to, 1)) } },
      select: {
        crewMemberId: true, date: true, kind: true, locked: true, source: true, dailyDutyId: true,
        dailyDuty: { select: { shiftId: true, summary: true, operation: { select: { status: true } } } },
      },
    }),
    prisma.crewOccurrence.findMany({
      where:  { crewMemberId: { in: memberIds }, status: 'APPROVED', startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(periodStart) } },
      select: { crewMemberId: true, kind: true, startDate: true, endDate: true, startNotBefore: true, endNotAfter: true },
    }),
    prisma.holiday.findMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) } }, select: { date: true, branchId: true } }),
  ])

  // lines/vehicle types of every duty read (horizon + history), from its live pieces
  const opDay = new Map(operations.map(o => [o.id, dayOf(o.date)]))
  const dutyIds = [...new Set([...duties.map(d => d.id), ...entries.flatMap(e => e.dailyDutyId ?? [])])]
  const facts = await dutyLines(prisma, dutyIds)
  const { lineOperators } = await loadCrewBranchRules(prisma, { lineIds: [...new Set([...facts.values()].flatMap(f => f.lines.map(l => l.lineId)))] })
  const signature = (dutyId: string, shiftId: string | null) => {
    const lines = facts.get(dutyId)?.lines ?? []
    const dominant = lines.reduce<{ lineId: string; minutes: number } | null>((a, l) => (!a || l.minutes > a.minutes ? l : a), null)
    return `${dominant?.lineId ?? '-'}|${shiftId ?? '-'}`
  }

  const rgDuties: RgDuty[] = []
  for (const d of duties) {
    const s = d.summary as DutySummary | null
    if (d.rosterEntries.some(e => e.locked) || s?.startMinutes == null || s.endMinutes == null) continue
    const f = facts.get(d.id)
    rgDuties.push({
      id: d.id, day: dayIndex.get(opDay.get(d.dailyOperationId)!)!, start: s.startMinutes, end: s.endMinutes, paid: s.paidMinutes, kind: d.kind,
      signature: signature(d.id, d.shiftId),
      lineMinutes: f?.lines ?? [],
      vehicleTypes: f?.vehicleTypes ?? [],
      operated: !params.restrictToBranchLines || (f?.lines ?? []).every(l => {
        const ops = lineOperators.get(l.lineId)
        return !ops?.length || ops.includes(branchId)
      }),
    })
  }

  // ── each crew member's days ──
  const maxPreferred = settings.maxPreferredLines
  const rgMembers: RgMember[] = members.map(m => {
    const mine = entries.filter(e => e.crewMemberId === m.id)
    const occ  = occurrences.filter(o => o.crewMemberId === m.id)
    const absentOn = (day: Day) => occ.some(o => o.kind === 'ABSENCE' && dayOf(o.startDate) <= day && dayOf(o.endDate) >= day)
    const isFixed = (e: typeof mine[number]) =>
      e.locked || e.kind === 'COMP_OFF' || (e.kind === 'DAY_OFF' && e.source === 'MANUAL')
      || (!!e.dailyDuty && !(e.dailyDuty.operation.status === 'PLANNED' || (options.published && e.dailyDuty.operation.status === 'PUBLISHED')))

    const status: RgStatus[] = [], windows: (ShiftWindow | null)[] = [], fixed: (RgFixed | null)[] = [], licenseExpired: boolean[] = [], courseExpired: boolean[] = []
    for (const day of days) {
      const onDay = mine.filter(e => dayOf(e.date) === day && isFixed(e))
      const works = onDay.filter(e => e.dailyDuty)
      const bound = m.shifts.find(s => dayOf(s.validFrom) <= day && (!s.validTo || dayOf(s.validTo) >= day))?.shift ?? null
      const timeWindows = occ.filter(o => o.kind === 'TIME_WINDOW' && dayOf(o.startDate) <= day && dayOf(o.endDate) >= day)
      windows.push(bound ? effectiveWindow(bound, m, timeWindows) : null)
      licenseExpired.push(!!m.licenseExpiresAt && dayOf(m.licenseExpiresAt) < day)
      courseExpired.push(!!m.courseExpiresAt && dayOf(m.courseExpiresAt) < day)
      fixed.push(works.length ? merge(works.map(e => ({ s: e.dailyDuty!.summary as DutySummary | null, sig: signature(e.dailyDutyId!, e.dailyDuty!.shiftId) }))) : null)

      if (works.length) status.push('fixed')
      else if (onDay.length || absentOn(day) || !bound) status.push('away')
      else {
        const pattern = m.restPattern ?? bound.restPattern
        const isHoliday = holidays.some(h => dayOf(h.date) === day && (!h.branchId || h.branchId === branchId))
        status.push(pattern && !restPatternWorks(pattern, m.restOffset, day, isHoliday) ? 'off' : 'free')
      }
    }

    // the load window before the horizon
    let workedBefore = 0, changesBefore = 0, last: string | null = null, prevEnd: number | null = null, nextStart: number | null = null
    const worked = mine.filter(e => e.dailyDuty && dayOf(e.date) < from).sort((a, b) => a.date.getTime() - b.date.getTime())
    for (const e of worked) {
      const s = e.dailyDuty!.summary as DutySummary | null
      const sig = signature(e.dailyDutyId!, e.dailyDuty!.shiftId)
      if (dayOf(e.date) >= periodStart) {
        workedBefore += s?.paidMinutes ?? 0
        if (last != null && sig !== last) changesBefore++
      }
      last = sig
      if (dayOf(e.date) === addDays(from, -1) && s?.endMinutes != null) prevEnd = Math.max(prevEnd ?? 0, s.endMinutes)
    }
    for (const e of mine.filter(x => x.dailyDuty && dayOf(x.date) === addDays(to, 1))) {
      const s = e.dailyDuty!.summary as DutySummary | null
      if (s?.startMinutes != null) nextStart = Math.min(nextStart ?? Infinity, s.startMinutes)
    }

    // the target: monthly load pro rata over the load window, minus absences / compensatory days off
    const weekly  = m.weeklyHours ?? m.employee.contracts[0]?.weeklyHours ?? settings.defaultWeeklyHours
    const window  = daysBetween(periodStart, addDays(to, 1))
    const reduced = new Set<Day>()
    for (let d = periodStart; d <= to; d = addDays(d, 1)) {
      if (absentOn(d) || mine.some(e => e.kind === 'COMP_OFF' && dayOf(e.date) === d)) reduced.add(d)
    }
    const targetMinutes = weekly * 5 * 60 * Math.max(0, window - reduced.size) / periodDays

    const prefGrade: Record<string, number> = {}
    for (const l of m.lines) {
      if (l.rank != null && l.rank <= maxPreferred) prefGrade[l.lineId] = (settings.preferredLineGrades[l.rank - 1] ?? 0) / 100
    }
    return {
      id: m.id, code: m.employee.code, name: m.employee.preferredName || m.employee.fullName,
      lineAccess: Object.fromEntries(m.lines.filter(l => l.access).map(l => [l.lineId, l.access!])),
      prefGrade,
      blockedVehicleTypes: m.blockedVehicleTypes,
      overtimePreference: m.overtimePreference,
      status, windows, fixed, licenseExpired, courseExpired,
      targetMinutes, workedBefore, changesBefore, lastSignature: last, prevEnd, nextStart,
    }
  })

  return {
    scopeIds,
    operationIds: operations.map(o => o.id),
    input: {
      days, duties: rgDuties, members: rgMembers,
      loadDaysBefore: daysBetween(periodStart, from),
      ensureMonthlyLoad: params.ensureMonthlyLoad,
      maxChanges: params.maxChanges,
      lineAccessMode: settings.lineAccessMode,
      ruleModes: settings.ruleModes,
      range: settings.range,
      rest: crewSettings.range.interShiftRest,
    },
  }
}

const shiftWindowSelect = {
  id: true, priority: true, allowSplit: true,
  startFloor: true, startIdealMin: true, startIdealMax: true, startCeiling: true,
  endFloor: true, endIdealMin: true, endIdealMax: true, endCeiling: true,
} as const

// two fixed duties on one day count as one span
function merge(list: { s: DutySummary | null; sig: string }[]): RgFixed | null {
  const valid = list.filter(x => x.s?.startMinutes != null && x.s.endMinutes != null)
  if (!valid.length) return null
  return {
    start: Math.min(...valid.map(x => x.s!.startMinutes!)),
    end:   Math.max(...valid.map(x => x.s!.endMinutes!)),
    paid:  valid.reduce((n, x) => n + x.s!.paidMinutes, 0),
    signature: valid[0].sig,
  }
}

// the load period holding `day`: it starts on `startDay` of a month
export function loadPeriodStart(day: Day, startDay: number): Day {
  const [y, m, d] = day.split('-').map(Number)
  const month = d >= startDay ? m - 1 : m - 2
  const date = new Date(Date.UTC(y, month, startDay))
  return dayOf(date)
}

export function daysBetween(a: Day, b: Day): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

// trip minutes per line and the vehicle types of each daily duty's live pieces
export async function dutyLines(prisma: PrismaService, dutyIds: string[]) {
  const pieces = await prisma.dailyDutyPiece.findMany({
    where:  { dailyDutyId: { in: dutyIds }, isStale: false, dailyBlockId: { not: null } },
    select: { dailyDutyId: true, dailyBlockId: true, startMinutes: true, endMinutes: true },
  })
  const blockIds = [...new Set(pieces.map(p => p.dailyBlockId!))]
  const [trips, blocks] = await Promise.all([
    prisma.dailyBlockEvent.findMany({
      where:  { dailyBlockId: { in: blockIds }, kind: 'TRIP', isCancelled: false },
      select: { dailyBlockId: true, lineId: true, startMinutes: true, endMinutes: true },
    }),
    prisma.dailyBlock.findMany({ where: { id: { in: blockIds } }, select: { id: true, vehicleType: true, vehicle: { select: { vehicleType: true } } } }),
  ])
  const tripsByBlock = new Map<string, typeof trips>()
  for (const t of trips) tripsByBlock.set(t.dailyBlockId!, [...(tripsByBlock.get(t.dailyBlockId!) ?? []), t])
  const typeOf = new Map(blocks.map(b => [b.id, b.vehicle?.vehicleType ?? b.vehicleType]))

  const out = new Map<string, { lines: { lineId: string; minutes: number }[]; vehicleTypes: string[] }>()
  for (const p of pieces) {
    const f = out.get(p.dailyDutyId) ?? { lines: [], vehicleTypes: [] }
    out.set(p.dailyDutyId, f)
    const type = typeOf.get(p.dailyBlockId!)
    if (type && !f.vehicleTypes.includes(type)) f.vehicleTypes.push(type)
    for (const t of tripsByBlock.get(p.dailyBlockId!) ?? []) {
      const minutes = Math.min(t.endMinutes, p.endMinutes) - Math.max(t.startMinutes, p.startMinutes)
      if (minutes <= 0 || !t.lineId) continue
      const l = f.lines.find(x => x.lineId === t.lineId)
      if (l) l.minutes += minutes
      else f.lines.push({ lineId: t.lineId, minutes })
    }
  }
  return out
}
