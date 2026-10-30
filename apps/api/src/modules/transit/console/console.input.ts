import { BadRequestException } from '@nestjs/common'
import { bestShift, CREW_ROLE_PREFIX, CREW_ROLES, type ConsoleDailyError, type ConsolePlanRow, type CrewRole, type DailySummary, type DutySummary } from '@nyx/schemas'
import type { PrismaService } from '../../../prisma/prisma.service'
import type { TransitCrewConfigService } from '../settings/transit-crew-config.service'
import type { TransitRosterConfigService } from '../settings/transit-roster-config.service'
import type { DayTypeService } from '../timetabling/day-type/day-type.service'
import { addDays, dayOf, localToday, toDbDate } from '../timetabling/plan-validity'
import { outdatedOperations } from '../daily/daily-outdated'
import { parseDay } from '../timetabling/dop/dop-resolution'
import { dailyIssueLabel, type ConsoleCrew, type ConsoleDuty, type ConsoleInput, type ConsolePattern } from './console.calc'

// What the Painel de Escala reads from the database — one load per request, the figures in
// console.calc.ts. Always the planned side: the effective plans (no validTo) and the crew as it
// stands with its open shift link (an adjustment scheduled for later already counts).

// the reference window — 5 weeks: cycles of 7, 14 and 28 days and a month's start/end inside
export const CONSOLE_WINDOW_DAYS = 35
// generated days ahead the Painel warns about
export const CONSOLE_DAILY_DAYS = 30
// the day's issues that make a generated day show up (errors of crew, vehicles and coverage)
const DAILY_ERROR_CODES = new Set([
  'DUTY_UNASSIGNED', 'RESERVE_SHORT', 'BLOCK_NO_VEHICLE', 'BLOCK_NO_CREW', 'VEHICLE_DOUBLE', 'VEHICLE_UNAVAILABLE',
  'CREW_ABSENT', 'CREW_ON_DAY_OFF', 'CREW_INACTIVE', 'SHIFT_WINDOW', 'CREW_WINDOW', 'LINE_NOT_ALLOWED', 'VEHICLE_TYPE_BLOCKED', 'INTER_SHIFT_REST',
])

export interface ConsoleParams { branchId: string; role: CrewRole; scopeId?: string | null }

const patternSelect = { id: true, name: true, pattern: true, anchorDate: true, offOnHolidays: true, staggered: true } as const
const asPattern = (p: { id: string; name: string; pattern: string; anchorDate: Date; offOnHolidays: boolean; staggered: boolean }): ConsolePattern =>
  ({ id: p.id, name: p.name, cycle: { pattern: p.pattern, anchorDate: p.anchorDate, offOnHolidays: p.offOnHolidays }, staggered: p.staggered })

export async function loadConsoleInput(
  prisma: PrismaService, rosterConfig: TransitRosterConfigService, crewConfig: TransitCrewConfigService, dayTypeService: DayTypeService, params: ConsoleParams,
): Promise<ConsoleInput> {
  const { branchId, role } = params
  if (!branchId || !CREW_ROLES.includes(role)) throw new BadRequestException('Informe a empresa e a função')
  const today = localToday()

  // ── scope ──
  const operated = await prisma.scopeOperator.findMany({
    where:   { branchId },
    orderBy: { scope: { name: 'asc' } },
    select:  { scope: { select: { id: true, name: true, _count: { select: { operators: true } } } } },
  })
  if (!operated.length) throw new BadRequestException('A empresa não opera nenhum escopo')
  // an empresa should operate one scope: its crew isn't split per scope, so a second one counts
  // everyone twice (BRANCH_MULTI_SCOPE) — the analysis takes the chosen scope with the whole crew
  const scope = operated.find(o => o.scope.id === params.scopeId)?.scope ?? operated[0].scope
  const sharedScope = scope._count.operators > 1

  const [settings, crewSettings] = await Promise.all([rosterConfig.get(branchId), crewConfig.get(scope.id)])

  // ── window and day types ──
  // by the day types' patterns only: line calendar exceptions and holidays are one-off
  const resolve = await dayTypeService.patternResolver()
  const days: ConsoleInput['days'] = []
  for (let i = 0; i < CONSOLE_WINDOW_DAYS; i++) {
    const day = addDays(today, i)
    // the resolver reads local weekdays — a local midnight, not toDbDate's UTC one
    const dt = resolve(parseDay(day)!)
    if (dt) days.push({ day, weekday: (toDbDate(day).getUTCDay() + 6) % 7, dayTypeId: dt.id })
  }

  // ── effective plans ──
  // no validTo, even when it starts later; a plan without an active crew plan leaves its day type
  // without demand (an error) — it never falls back to the previous plan
  const vehiclePlans = await prisma.vehiclePlan.findMany({
    where:   { scopeId: scope.id, status: { not: 'DRAFT' }, validTo: null },
    orderBy: { validFrom: 'desc' },
    select: {
      id: true, description: true, dayTypeId: true, validFrom: true, summary: true,
      lines:     { select: { lineId: true } },
      crewPlans: { where: { status: 'ACTIVE', validTo: null }, select: { id: true, description: true, summary: true } },
      _count:    { select: { trips: true } },
    },
  })
  // one per day type (activation guarantees it; the latest if not)
  const planOf = new Map<string, typeof vehiclePlans[number]>()
  for (const vp of vehiclePlans) if (!planOf.has(vp.dayTypeId)) planOf.set(vp.dayTypeId, vp)
  const typeIds = [...new Set([...days.map(d => d.dayTypeId), ...planOf.keys()])]
  const dayTypes = await prisma.dayType.findMany({ where: { id: { in: typeIds } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true } })

  const [lines, schedules] = await Promise.all([
    prisma.transitLine.findMany({ where: { scopeId: scope.id, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true } }),
    // a line runs on a day type when it has an approved OS for it
    prisma.lineSchedule.findMany({ where: { status: 'APPROVED', validTo: null, line: { scopeId: scope.id, isActive: true } }, select: { lineId: true, dayTypeId: true } }),
  ])
  const lineCode = new Map(lines.map(l => [l.id, l.code]))

  // ── shifts ──
  const shiftRows = await prisma.crewShift.findMany({
    where:   { isActive: true, branches: { some: { branchId } } },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
    select: {
      id: true, code: true, name: true, priority: true, allowSplit: true,
      startFloor: true, startIdealMin: true, startIdealMax: true, startCeiling: true,
      endFloor: true, endIdealMin: true, endIdealMax: true, endCeiling: true,
      restPattern: { select: patternSelect },
    },
  })
  const shifts = shiftRows.map(({ restPattern, ...s }) => ({ ...s, pattern: restPattern ? asPattern(restPattern) : null }))

  // ── duties of the effective crew plans ──
  const crewPlanIds = [...planOf.values()].flatMap(vp => vp.crewPlans.map(c => c.id))
  const dutyRows = await prisma.duty.findMany({
    where:  { crewPlanId: { in: crewPlanIds }, role },
    select: {
      id: true, crewPlanId: true, dutyNumber: true, kind: true, branchId: true, shiftId: true, summary: true, isStale: true, hasIssues: true, constraints: true,
      pieces: { where: { isStale: false, vehicleBlockId: { not: null } }, select: { vehicleBlockId: true, startMinutes: true, endMinutes: true } },
    },
  })
  const mine = dutyRows.filter(d => d.branchId === branchId || (!d.branchId && !sharedScope))
  const blockIds = [...new Set(mine.flatMap(d => d.pieces.map(p => p.vehicleBlockId!)))]
  const [blocks, blockTrips] = await Promise.all([
    prisma.vehicleBlock.findMany({ where: { id: { in: blockIds } }, select: { id: true, vehicleType: true } }),
    prisma.blockTrip.findMany({
      where:  { vehicleBlockId: { in: blockIds } },
      select: { vehicleBlockId: true, trip: { select: { departureMinutes: true, arrivalMinutes: true, route: { select: { lineId: true } } } } },
    }),
  ])
  const typeOfBlock = new Map(blocks.map(b => [b.id, b.vehicleType as string]))
  const tripsOf = new Map<string, { lineId: string; start: number; end: number }[]>()
  for (const bt of blockTrips) {
    tripsOf.set(bt.vehicleBlockId, [...(tripsOf.get(bt.vehicleBlockId) ?? []), { lineId: bt.trip.route.lineId, start: bt.trip.departureMinutes, end: bt.trip.arrivalMinutes }])
  }
  const dayTypeOfPlan = new Map([...planOf.values()].flatMap(vp => vp.crewPlans.map(c => [c.id, vp.dayTypeId] as const)))

  const duties: ConsoleDuty[] = []
  for (const d of mine) {
    const s = d.summary as DutySummary | null
    if (s?.startMinutes == null || s.endMinutes == null) continue
    const lineMinutes: ConsoleDuty['lineMinutes'] = []
    const vehicleTypes = new Set<string>()
    for (const p of d.pieces) {
      const type = typeOfBlock.get(p.vehicleBlockId!)
      if (type) vehicleTypes.add(type)
      for (const t of tripsOf.get(p.vehicleBlockId!) ?? []) {
        const minutes = Math.min(t.end, p.endMinutes) - Math.max(t.start, p.startMinutes)
        if (minutes <= 0) continue
        const l = lineMinutes.find(x => x.lineId === t.lineId)
        if (l) l.minutes += minutes
        else lineMinutes.push({ lineId: t.lineId, minutes })
      }
    }
    duties.push({
      id: d.id, dayTypeId: dayTypeOfPlan.get(d.crewPlanId)!, shiftId: d.shiftId, kind: d.kind,
      start: s.startMinutes, end: s.endMinutes, paid: s.paidMinutes, overtime: s.overtimeMinutes, lineMinutes, vehicleTypes: [...vehicleTypes], standby: d.kind === 'STANDBY',
      label: `${CREW_ROLE_PREFIX[role]}${d.dutyNumber}`, preferred: (d.constraints as { crewMemberIds?: string[] } | null)?.crewMemberIds ?? [],
    })
  }
  // the empresa's plantões (reserve targets) — demand too, in the shift their hours fit
  for (const [i, r] of settings.reserveTargets.entries()) {
    if (r.role !== role || !planOf.has(r.dayTypeId) && !days.some(d => d.dayTypeId === r.dayTypeId)) continue
    for (let k = 0; k < r.count; k++) {
      duties.push({
        id: `reserve-${i}-${k}`, dayTypeId: r.dayTypeId, shiftId: bestShift(shiftRows, r.startMinutes, r.endMinutes, 'STANDBY')?.id ?? null,
        kind: 'STANDBY', start: r.startMinutes, end: r.endMinutes, paid: r.endMinutes - r.startMinutes, overtime: 0, lineMinutes: [], vehicleTypes: [], standby: true,
        label: null, preferred: [],
      })
    }
  }

  // the empresa's fleet per plan — its blocks with trips (the plan's fleetCount is the whole scope's)
  const fleetRows = await prisma.vehicleBlock.groupBy({
    by:    ['vehiclePlanId'],
    where: { vehiclePlanId: { in: [...planOf.values()].map(vp => vp.id) }, blockTrips: { some: {} }, ...(sharedScope ? { branchId } : { OR: [{ branchId }, { branchId: null }] }) },
    _count: { _all: true },
  })
  const fleetOf = new Map(fleetRows.map(r => [r.vehiclePlanId, r._count._all]))
  // the empresa's own cars, running or in maintenance — what isn't in use is reserve
  const vehicles = await prisma.vehicle.count({ where: { branchId, status: { in: ['ACTIVE', 'MAINTENANCE'] } } })

  const plans: ConsolePlanRow[] = dayTypes.map(t => {
    const vp = planOf.get(t.id)
    const cp = vp?.crewPlans[0] ?? null
    const own = cp ? mine.filter(d => d.crewPlanId === cp.id) : []
    const sums = own.map(d => d.summary as DutySummary | null).filter((s): s is DutySummary => !!s)
    const paid = sums.reduce((n, s) => n + s.paidMinutes, 0)
    const byKind: Record<string, number> = {}
    for (const d of own) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1
    const summary = cp?.summary as { uncoveredMinutes?: number; score?: number } | null
    return {
      dayTypeId: t.id,
      vehiclePlan: vp ? { id: vp.id, label: vp.description || 'Planejamento', validFrom: vp.validFrom ? dayOf(vp.validFrom) : null, fleet: fleetOf.get(vp.id) ?? 0, reserve: vehicles - (fleetOf.get(vp.id) ?? 0), trips: vp._count.trips } : null,
      crewPlan: cp ? {
        id: cp.id, label: cp.description || 'Escala', duties: own.length, byKind,
        avgWorkMinutes: sums.length ? Math.round(sums.reduce((n, s) => n + s.workMinutes, 0) / sums.length) : 0,
        overtimePct: paid ? Math.round(sums.reduce((n, s) => n + s.overtimeMinutes, 0) / paid * 1000) / 10 : 0,
        uncoveredMinutes: summary?.uncoveredMinutes ?? 0,
        stale: own.filter(d => d.isStale).length,
        issues: own.filter(d => d.hasIssues).length,
        noBranch: sharedScope ? dutyRows.filter(d => d.crewPlanId === cp.id && !d.branchId).length : 0,
        score: summary?.score ?? null,
      } : null,
      future: false,
      linesWithoutPlan: vp ? schedules.filter(s => s.dayTypeId === t.id && !vp.lines.some(l => l.lineId === s.lineId)).map(s => lineCode.get(s.lineId) ?? '?') : [],
    }
  }).filter(p => p.vehiclePlan || days.some(d => d.dayTypeId === p.dayTypeId))

  // every rest pattern — what a crew member may switch to (groups action)
  const patterns = (await prisma.restPattern.findMany({ orderBy: { name: 'asc' }, select: patternSelect })).map(asPattern)

  // ── crew ──
  const members = await prisma.crewMember.findMany({
    where:   { role, employee: { branchId, status: 'ACTIVE' } },
    orderBy: { employee: { code: 'asc' } },
    select: {
      id: true, isRosterable: true, notBeforeMinutes: true, notAfterMinutes: true, restOffset: true, blockedVehicleTypes: true, standbyBlocked: true, weeklyHours: true,
      preferredVehicle: { select: { id: true, code: true, status: true, branchId: true } },
      employee: {
        select: {
          code: true, fullName: true, preferredName: true, hireDate: true,
          contracts: { where: { status: 'ACTIVE' }, orderBy: { startDate: 'desc' }, take: 1, select: { weeklyHours: true, workDaysPerWeek: true } },
        },
      },
      restPattern: { select: patternSelect },
      lines:       { select: { lineId: true, access: true, rank: true, priority: true } },
      // the open link: the shift going forward (a later one already scheduled counts)
      shifts: {
        where:  { validTo: null },
        select: {
          validFrom: true,
          shift: {
            select: {
              id: true, priority: true, allowSplit: true,
              startFloor: true, startIdealMin: true, startIdealMax: true, startCeiling: true,
              endFloor: true, endIdealMin: true, endIdealMax: true, endCeiling: true,
              restPattern: { select: patternSelect },
            },
          },
        },
      },
    },
  })
  const date = toDbDate(today)
  const occurrences = await prisma.crewOccurrence.findMany({
    where:  { crewMemberId: { in: members.map(m => m.id) }, kind: 'ABSENCE', status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } },
    select: {
      crewMemberId: true, endDate: true,
      absenceType:     { select: { name: true, effect: true, systemKey: true } },
      coverCrewMember: { select: { employee: { select: { code: true, fullName: true, preferredName: true } } } },
    },
  })
  // only a long absence leaves the supply — short ones are absenteeism, not measured here
  const awayUntil = addDays(today, settings.awayMinDays)
  const nameOf = (e: { fullName: string; preferredName: string | null }) => e.preferredName || e.fullName

  const crew: ConsoleCrew[] = members.map(m => {
    const link = m.shifts[0] ?? null
    const pattern = m.restPattern ?? link?.shift.restPattern ?? null
    const occ = occurrences.filter(o => o.crewMemberId === m.id)
    const away = occ.find(o => o.absenceType?.effect === 'ABSENCE' && o.absenceType.systemKey !== 'VACATION' && dayOf(o.endDate) >= awayUntil)
    const vacation = occ.find(o => o.absenceType?.systemKey === 'VACATION')
    const contract = m.employee.contracts[0]
    return {
      id: m.id, code: m.employee.code, name: nameOf(m.employee), hireDate: dayOf(m.employee.hireDate),
      shiftId: link?.shift.id ?? null, shiftSince: link ? dayOf(link.validFrom) : null,
      window: link?.shift ?? null,
      notBefore: m.notBeforeMinutes, notAfter: m.notAfterMinutes,
      journey: contract ? Math.round((m.weeklyHours ?? contract.weeklyHours) * 60 / contract.workDaysPerWeek) : null,
      pattern: pattern ? asPattern(pattern) : null, ownPattern: !!m.restPattern,
      offset: m.restOffset,
      lineAccess: Object.fromEntries(m.lines.filter(l => l.access).map(l => [l.lineId, l.access!])),
      prefLines: m.lines.filter(l => l.rank != null).map(l => l.lineId),
      priorityLines: m.lines.filter(l => l.priority).map(l => l.lineId),
      blockedVehicleTypes: m.blockedVehicleTypes, standbyBlocked: m.standbyBlocked, rosterable: m.isRosterable,
      away: away ? { reason: away.absenceType?.name ?? 'Afastamento', until: dayOf(away.endDate) } : null,
      vacation: vacation ? { until: dayOf(vacation.endDate), cover: vacation.coverCrewMember ? `${vacation.coverCrewMember.employee.code} ${nameOf(vacation.coverCrewMember.employee)}` : null } : null,
    }
  })

  // fixed cars: inactive, of another empresa, or shared by crew members whose shifts overlap
  const fixedCar: ConsoleInput['fixedCar'] = []
  for (const m of members) {
    const v = m.preferredVehicle
    if (!v) continue
    const me = crew.find(c => c.id === m.id)!
    const reason = v.status !== 'ACTIVE' ? 'veículo inativo'
      : v.branchId !== branchId ? 'veículo de outra empresa'
      : (() => {
        const other = members.find(o => o.id !== m.id && o.preferredVehicle?.id === v.id && (() => {
          const a = me.window, b = crew.find(c => c.id === o.id)!.window
          return !!a && !!b && a.startFloor < b.endCeiling && b.startFloor < a.endCeiling
        })())
        return other ? `dividido com ${other.employee.code} ${nameOf(other.employee)} em turnos sobrepostos` : null
      })()
    if (reason) fixedCar.push({ id: m.id, code: me.code, name: me.name, vehicleCode: v.code, reason })
  }

  // employees whose current contract's job title is crew of the role, without a crew profile
  const titles = await prisma.crewRoleJobTitle.findMany({ where: { role }, select: { jobTitleId: true } })
  const noProfile = titles.length ? (await prisma.employee.findMany({
    where: {
      branchId, status: 'ACTIVE', crewMember: null,
      contracts: { some: { status: 'ACTIVE', jobTitleId: { in: titles.map(t => t.jobTitleId) } } },
    },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, fullName: true, preferredName: true, hireDate: true, contracts: { where: { status: 'ACTIVE' }, orderBy: { startDate: 'desc' }, take: 1, select: { jobTitle: { select: { name: true } } } } },
  })).map(e => ({ employeeId: e.id, code: e.code, name: nameOf(e), jobTitle: e.contracts[0]?.jobTitle.name ?? '', role, hireDate: dayOf(e.hireDate) })) : []

  // ── generated days with errors ──
  const operations = await prisma.dailyOperation.findMany({
    where:   { scopeId: scope.id, status: 'PLANNED', date: { gte: date, lte: toDbDate(addDays(today, CONSOLE_DAILY_DAYS)) } },
    orderBy: { date: 'asc' },
    select:  { id: true, date: true, sources: true, summary: true },
  })
  const outdated = await outdatedOperations(prisma, operations)
  const dailyErrors: ConsoleDailyError[] = operations.flatMap(o => {
    const counts: Record<string, number> = (o.summary as DailySummary | null)?.issues ?? {}
    const issues = Object.entries(counts).filter(([code, n]) => n > 0 && DAILY_ERROR_CODES.has(code)).map(([code, count]) => ({ code, label: dailyIssueLabel(code), count }))
    const why = outdated.get(o.id) ?? null
    return issues.length || why ? [{ operationId: o.id, date: dayOf(o.date), outdated: why, issues }] : []
  })

  return {
    scopeId: scope.id, branchId, role, today,
    scopes: operated.map(o => ({ id: o.scope.id, name: o.scope.name })),
    days, dayTypes, shifts, plans, duties, crew, patterns,
    lines: lines.map(l => ({ id: l.id, code: l.code })),
    lineAccessMode: settings.lineAccessMode, lineMarginPct: settings.lineMarginPct, ruleModes: settings.ruleModes,
    restFloor: crewSettings.range.interShiftRest.floor, bankCompPct: settings.hourBankCompPct,
    noProfile, fixedCar, dailyErrors,
  }
}
