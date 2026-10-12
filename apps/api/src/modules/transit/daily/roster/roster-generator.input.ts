import { restPatternWorks, type DutySummary, type RosterGeneratorParams, type ShiftWindow, type VehiclePlanConstraints } from '@nyx/schemas'
import type { PrismaService } from '../../../../prisma/prisma.service'
import type { TransitCrewConfigService } from '../../settings/transit-crew-config.service'
import type { TransitRosterConfigService } from '../../settings/transit-roster-config.service'
import { loadCrewBranchRules } from '../../timetabling/crew-plan/crew-branch-rules'
import { addDays, dayOf, toDbDate, type Day } from '../../timetabling/plan-validity'
import { effectiveWindow } from '../daily-checks'
import { NOT_PUBLISHED, STANDBY_LINE, isChange, signatureGroup, type RgDuty, type RgFixed, type RgInput, type RgMember, type RgStatus } from './roster-generator.calc'

// Reads everything the generator needs for one empresa/role over [from, to]:
//  - the duties of the PLANNED days (and PUBLISHED ones, `published`) of the Scopes the empresa
//    operates (its own duties, or the ones without an empresa in a Scope it operates alone) — not
//    already held by a fixed entry
//  - its rosterable, active crew members of the role, with what each day means for them
//  - the load window (load period start, or the first day with data, .. to): minutes worked and
//    changes before `from` — the imported frequency's hours on the days it has (CrewTimesheetDay)
//  - férias with a ferista: on their days he takes the titular's place — his position in the
//    preferred lists, his last duties (the table continuity pulls the same one) and his rest
//    pattern; the change of table on entering / leaving doesn't count
//
// A fixed entry stays as it is: locked, on a day no longer PLANNED, a compensatory day off or a
// day off entered by hand.

export interface RosterContext {
  input:      RgInput
  scopeIds:   string[]
  // the days in the horizon it may change (PLANNED, and PUBLISHED with `published`)
  operationIds: string[]
}

const HISTORY_DAYS = 45

// `published`: also the duties of PUBLISHED days (the roster screen's suggestions, and the
// generator's includePublished) — what each crew member holds on them goes in RgMember.published
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
  // the load window starts on the period's first day — or on the first day the system has for the
  // empresa, when later: a day without data isn't a day worked zero
  const firstDay = await prisma.dailyOperation.findFirst({ where: { scopeId: { in: scopeIds } }, orderBy: { date: 'asc' }, select: { date: true } })
  const loadStart = firstDay && dayOf(firstDay.date) > periodStart ? [dayOf(firstDay.date), from].sort()[0] : periodStart

  const operations = await prisma.dailyOperation.findMany({
    where:  { scopeId: { in: scopeIds }, date: { gte: toDbDate(from), lte: toDbDate(to) }, status: { in: options.published ? ['PLANNED', 'PUBLISHED'] : ['PLANNED'] } },
    select: { id: true, date: true, scopeId: true, status: true, sources: true },
  })
  const publishedDays = new Set(operations.filter(o => o.status === 'PUBLISHED').map(o => dayOf(o.date)))

  // ── crew members ──
  const members = await prisma.crewMember.findMany({
    where:  { role, isRosterable: true, employee: { branchId, status: 'ACTIVE' } },
    orderBy: { employee: { code: 'asc' } },
    select: {
      id: true, notBeforeMinutes: true, notAfterMinutes: true, restOffset: true, blockedVehicleTypes: true,
      licenseExpiresAt: true, courseExpiresAt: true, weeklyHours: true, overtimePreference: true, standbyRank: true, standbyBlocked: true,
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

  // ── férias with a ferista ──
  const covers = (await prisma.crewOccurrence.findMany({
    where: {
      kind: 'ABSENCE', status: 'APPROVED', coverCrewMemberId: { not: null },
      startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(historyFrom) },
      OR: [{ crewMemberId: { in: memberIds } }, { coverCrewMemberId: { in: memberIds } }],
    },
    select: { crewMemberId: true, coverCrewMemberId: true, startDate: true, endDate: true },
  })).map(c => ({ titular: c.crewMemberId, cover: c.coverCrewMemberId!, start: dayOf(c.startDate), end: dayOf(c.endDate) }))
  const coverOn    = (titular: string, day: Day) => covers.find(c => c.titular === titular && c.start <= day && c.end >= day)?.cover
  const coveringOn = (cover: string, day: Day) => covers.find(c => c.cover === cover && c.start <= day && c.end >= day)
  const titularIds = [...new Set(covers.map(c => c.titular))]
  const titulars = new Map((await prisma.crewMember.findMany({
    where:  { id: { in: titularIds } },
    select: {
      id: true, restOffset: true,
      restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } },
      shifts: {
        where:  { validFrom: { lte: toDbDate(to) }, OR: [{ validTo: null }, { validTo: { gte: toDbDate(from) } }] },
        select: { validFrom: true, validTo: true, shift: { select: { restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } } } } },
      },
    },
  })).map(t => [t.id, t]))

  const [duties, entries, occurrences, holidays, timesheet] = await Promise.all([
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
      where:  { crewMemberId: { in: [...memberIds, ...titularIds] }, date: { gte: toDbDate(historyFrom), lte: toDbDate(addDays(to, 1)) } },
      select: {
        crewMemberId: true, date: true, kind: true, locked: true, source: true, dailyDutyId: true,
        dailyDuty: { select: { shiftId: true, summary: true, operation: { select: { status: true } } } },
      },
    }),
    prisma.crewOccurrence.findMany({
      where:  { crewMemberId: { in: memberIds }, status: 'APPROVED', startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(periodStart) } },
      select: { crewMemberId: true, kind: true, startDate: true, endDate: true, startNotBefore: true, endNotAfter: true, absenceType: { select: { effect: true } } },
    }),
    prisma.holiday.findMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) } }, select: { date: true, branchId: true } }),
    // the frequency's real hours before the horizon
    prisma.crewTimesheetDay.findMany({
      where:  { crewMemberId: { in: memberIds }, date: { gte: toDbDate(loadStart), lt: toDbDate(from) } },
      select: { crewMemberId: true, date: true, workedMinutes: true },
    }),
  ])

  // lines/vehicle types of every duty read (horizon + history), from its live pieces
  const opDay = new Map(operations.map(o => [o.id, dayOf(o.date)]))
  const dutyIds = [...new Set([...duties.map(d => d.id), ...entries.flatMap(e => e.dailyDutyId ?? [])])]
  const facts = await dutyLines(prisma, dutyIds)
  const { lineOperators } = await loadCrewBranchRules(prisma, { lineIds: [...new Set([...facts.values()].flatMap(f => f.lines.map(l => l.lineId)))] })
  // the logical duty each daily duty was copied from, and its crew plan — the duty's identity
  // across days (see RgDuty.signature)
  const sources = await prisma.dailyDuty.findMany({ where: { id: { in: dutyIds } }, select: { id: true, sourceDutyId: true } })
  const logical = await prisma.duty.findMany({
    where:  { id: { in: [...new Set(sources.flatMap(s => s.sourceDutyId ?? []))] } },
    select: { id: true, crewPlanId: true, constraints: true },
  })
  const planOf = new Map(logical.map(d => [d.id, d.crewPlanId]))
  // the preferred crew members of the logical duty (read live — a change in the plan reaches the
  // days already created), as member indices
  const memberIndex = new Map(members.map((m, i) => [m.id, i]))
  const dutyPins = new Map(logical.map(d => [d.id, (d.constraints as { crewMemberIds?: string[] } | null)?.crewMemberIds ?? []]))
  // the trip groups' crew members (VehiclePlan.constraints.bundleCrew of the days' plans)
  const bundleCrew = new Map<string, string[]>()
  for (const p of await prisma.vehiclePlan.findMany({
    where:  { id: { in: [...new Set(operations.flatMap(o => ((o.sources ?? []) as { vehiclePlanId: string }[]).map(s => s.vehiclePlanId)))] } },
    select: { constraints: true },
  })) {
    for (const [b, ids] of Object.entries((p.constraints as VehiclePlanConstraints | null)?.bundleCrew ?? {})) bundleCrew.set(b, ids)
  }
  // a daily duty's preferred crew: its logical duty's, then its trip groups' — as member indices;
  // a titular on férias gives his place to his ferista
  const preferredOf = (dutyId: string, day: Day) => [...new Set([
    ...(dutyPins.get(sourceOf.get(dutyId) ?? '') ?? []),
    ...(facts.get(dutyId)?.bundles ?? []).flatMap(b => bundleCrew.get(b) ?? []),
  ].map(id => coverOn(id, day) ?? id))].flatMap(id => memberIndex.get(id) ?? [])
  const sourceOf = new Map(sources.map(s => [s.id, s.sourceDutyId]))
  const signature = (dutyId: string, shiftId: string | null) => {
    const src = sourceOf.get(dutyId)
    const plan = src ? planOf.get(src) : undefined
    if (src && plan) return `${plan}#${src}`
    // no logical duty (made in the day): its dominant line and shift
    const lines = facts.get(dutyId)?.lines ?? []
    const dominant = lines.reduce<{ lineId: string; minutes: number } | null>((a, l) => (!a || l.minutes > a.minutes ? l : a), null)
    return `-#${dominant?.lineId ?? '-'}|${shiftId ?? '-'}`
  }

  const shiftCodes = new Map((await prisma.crewShift.findMany({
    where: { id: { in: [...new Set(duties.flatMap(d => d.shiftId ?? []))] } }, select: { id: true, code: true },
  })).map(s => [s.id, s.code]))

  const rgDuties: RgDuty[] = []
  for (const d of duties) {
    const s = d.summary as DutySummary | null
    if (d.rosterEntries.some(e => e.locked) || s?.startMinutes == null || s.endMinutes == null) continue
    const f = facts.get(d.id)
    rgDuties.push({
      id: d.id, day: dayIndex.get(opDay.get(d.dailyOperationId)!)!, start: s.startMinutes, end: s.endMinutes, paid: s.paidMinutes, kind: d.kind,
      signature: signature(d.id, d.shiftId),
      shift: d.shiftId ? shiftCodes.get(d.shiftId) ?? null : null,
      // a plantão is worked as one more "line" (STANDBY_LINE) — preferences and access apply to it
      lineMinutes: d.kind === 'STANDBY' ? [{ lineId: STANDBY_LINE, minutes: s.endMinutes - s.startMinutes }] : f?.lines ?? [],
      vehicleTypes: f?.vehicleTypes ?? [],
      standby: d.kind === 'STANDBY',
      preferred: preferredOf(d.id, opDay.get(d.dailyOperationId)!),
      operated: !params.restrictToBranchLines || (f?.lines ?? []).every(l => {
        const ops = lineOperators.get(l.lineId)
        return !ops?.length || ops.includes(branchId)
      }),
    })
  }

  // the duties a crew member worked before `day`, in order — and the last one per crew plan
  const workedOf = (crewMemberId: string, day: Day) => entries
    .filter(e => e.crewMemberId === crewMemberId && e.dailyDuty && dayOf(e.date) < day)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const lastOf = (list: typeof entries) => {
    const last: Record<string, string> = {}
    for (const e of list) {
      const sig = signature(e.dailyDutyId!, e.dailyDuty!.shiftId)
      last[signatureGroup(sig)] = sig
    }
    return last
  }

  // ── each crew member's days ──
  const dutyIndex = new Map(rgDuties.map((d, i) => [d.id, i]))
  const maxPreferred = settings.maxPreferredLines
  const rgMembers: RgMember[] = members.map(m => {
    const mine = entries.filter(e => e.crewMemberId === m.id)
    const occ  = occurrences.filter(o => o.crewMemberId === m.id)
    const absentOn = (day: Day) => occ.some(o => o.kind === 'ABSENCE' && dayOf(o.startDate) <= day && dayOf(o.endDate) >= day)
    // a requested weekly day off (effect DAY_OFF) takes the day but not the load
    const reducesLoad = (day: Day) => occ.some(o => o.kind === 'ABSENCE' && o.absenceType?.effect !== 'DAY_OFF' && dayOf(o.startDate) <= day && dayOf(o.endDate) >= day)
    const isFixed = (e: typeof mine[number]) =>
      e.locked || e.kind === 'COMP_OFF' || (e.kind === 'DAY_OFF' && e.source !== 'GENERATED')
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
        // covering a titular: his days off
        const cov = coveringOn(m.id, day)
        const t = cov ? titulars.get(cov.titular) : undefined
        const tPattern = t ? t.restPattern ?? t.shifts.find(s => dayOf(s.validFrom) <= day && (!s.validTo || dayOf(s.validTo) >= day))?.shift.restPattern ?? null : null
        const pattern = tPattern ?? m.restPattern ?? bound.restPattern
        const offset  = tPattern ? t!.restOffset : m.restOffset
        const isHoliday = holidays.some(h => dayOf(h.date) === day && (!h.branchId || h.branchId === branchId))
        status.push(pattern && !restPatternWorks(pattern, offset, day, isHoliday) ? 'off' : 'free')
      }
    }

    // the load window before the horizon
    let workedBefore = 0, changesBefore = 0, prevEnd: number | null = null, nextStart: number | null = null
    let last: Record<string, string> = {}
    const worked = workedOf(m.id, from)
    // covering a titular: his last duties on the first day, back to his own the day after
    const swaps = covers.filter(c => c.cover === m.id).flatMap(c => [
      { day: c.start, last: lastOf([...workedOf(c.titular, c.start)]) },
      { day: addDays(c.end, 1), last: lastOf(workedOf(m.id, c.start)) },
    ]).sort((a, b) => a.day.localeCompare(b.day))
    const pending = swaps.filter(w => w.day < from)
    const real = new Map(timesheet.filter(t => t.crewMemberId === m.id).map(t => [dayOf(t.date), t.workedMinutes]))
    for (const e of worked) {
      while (pending.length && pending[0].day <= dayOf(e.date)) last = { ...pending.shift()!.last }
      const s = e.dailyDuty!.summary as DutySummary | null
      const sig = signature(e.dailyDutyId!, e.dailyDuty!.shiftId)
      if (dayOf(e.date) >= loadStart) {
        if (!real.has(dayOf(e.date))) workedBefore += s?.paidMinutes ?? 0
        if (isChange(last, sig)) changesBefore++
      }
      last[signatureGroup(sig)] = sig
      if (dayOf(e.date) === addDays(from, -1) && s?.endMinutes != null) prevEnd = Math.max(prevEnd ?? 0, s.endMinutes)
    }
    while (pending.length) last = { ...pending.shift()!.last }
    for (const minutes of real.values()) workedBefore += minutes
    const lastSwaps = Object.fromEntries(swaps.filter(w => w.day >= from && w.day <= to).map(w => [dayIndex.get(w.day)!, w.last]))
    for (const e of mine.filter(x => x.dailyDuty && dayOf(x.date) === addDays(to, 1))) {
      const s = e.dailyDuty!.summary as DutySummary | null
      if (s?.startMinutes != null) nextStart = Math.min(nextStart ?? Infinity, s.startMinutes)
    }

    // the target: monthly load pro rata over the load window, minus absences / compensatory days off
    const weekly  = m.weeklyHours ?? m.employee.contracts[0]?.weeklyHours ?? settings.defaultWeeklyHours
    const window  = daysBetween(loadStart, addDays(to, 1))
    const reduced = new Set<Day>()
    for (let d = loadStart; d <= to; d = addDays(d, 1)) {
      if (reducesLoad(d) || mine.some(e => e.kind === 'COMP_OFF' && dayOf(e.date) === d)) reduced.add(d)
    }
    const targetMinutes = weekly * 5 * 60 * Math.max(0, window - reduced.size) / periodDays

    const prefGrade: Record<string, number> = {}
    for (const l of m.lines) {
      if (l.rank != null && l.rank <= maxPreferred) prefGrade[l.lineId] = (settings.preferredLineGrades[l.rank - 1] ?? 0) / 100
    }
    if (m.standbyRank != null && m.standbyRank <= maxPreferred && !m.standbyBlocked) {
      prefGrade[STANDBY_LINE] = (settings.preferredLineGrades[m.standbyRank - 1] ?? 0) / 100
    }
    return {
      id: m.id, code: m.employee.code, name: m.employee.preferredName || m.employee.fullName,
      // the plantão: allowed unless blocked, whatever the empresa's mode
      lineAccess: { ...Object.fromEntries(m.lines.filter(l => l.access).map(l => [l.lineId, l.access!])), [STANDBY_LINE]: m.standbyBlocked ? 'BLOCKED' : 'ENABLED' },
      prefGrade,
      blockedVehicleTypes: m.blockedVehicleTypes,
      overtimePreference: m.overtimePreference,
      status, windows, fixed, licenseExpired, courseExpired,
      targetMinutes, workedBefore, changesBefore, lastSignatures: last, lastSwaps, prevEnd, nextStart,
      current: days.map(day => {
        const held = mine.find(e => dayOf(e.date) === day && e.dailyDutyId && dutyIndex.has(e.dailyDutyId))
        return held ? dutyIndex.get(held.dailyDutyId!)! : -1
      }),
      published: days.map(day => {
        if (!publishedDays.has(day)) return NOT_PUBLISHED
        const held = mine.find(e => dayOf(e.date) === day && e.dailyDutyId && dutyIndex.has(e.dailyDutyId))
        return held ? dutyIndex.get(held.dailyDutyId!)! : -1
      }),
    }
  })

  return {
    scopeIds,
    operationIds: operations.map(o => o.id),
    input: {
      days, duties: rgDuties, members: rgMembers,
      loadDaysBefore: daysBetween(loadStart, from),
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
      select: { dailyBlockId: true, lineId: true, startMinutes: true, endMinutes: true, bundleId: true },
    }),
    prisma.dailyBlock.findMany({ where: { id: { in: blockIds } }, select: { id: true, vehicleType: true, vehicle: { select: { vehicleType: true } } } }),
  ])
  const tripsByBlock = new Map<string, typeof trips>()
  for (const t of trips) tripsByBlock.set(t.dailyBlockId!, [...(tripsByBlock.get(t.dailyBlockId!) ?? []), t])
  const typeOf = new Map(blocks.map(b => [b.id, b.vehicle?.vehicleType ?? b.vehicleType]))

  const out = new Map<string, { lines: { lineId: string; minutes: number }[]; vehicleTypes: string[]; bundles: string[] }>()
  for (const p of pieces) {
    const f = out.get(p.dailyDutyId) ?? { lines: [], vehicleTypes: [], bundles: [] }
    out.set(p.dailyDutyId, f)
    const type = typeOf.get(p.dailyBlockId!)
    if (type && !f.vehicleTypes.includes(type)) f.vehicleTypes.push(type)
    for (const t of tripsByBlock.get(p.dailyBlockId!) ?? []) {
      const minutes = Math.min(t.endMinutes, p.endMinutes) - Math.max(t.startMinutes, p.startMinutes)
      if (minutes > 0 && t.bundleId && !f.bundles.includes(t.bundleId)) f.bundles.push(t.bundleId)
      if (minutes <= 0 || !t.lineId) continue
      const l = f.lines.find(x => x.lineId === t.lineId)
      if (l) l.minutes += minutes
      else f.lines.push({ lineId: t.lineId, minutes })
    }
  }
  return out
}
