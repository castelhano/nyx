import { lineVehicleTypesSchema, restPatternWorks, shiftFits, shiftIdealDistance, type DailyIssue, type DutySummary, type ShiftWindow, type VehicleTypeValue } from '@nyx/schemas'
import type { PrismaService } from '../../../prisma/prisma.service'
import type { TransitRosterConfigService } from '../settings/transit-roster-config.service'
import { addDays, dayOf, toDbDate, type Day } from '../timetabling/plan-validity'
import { loadContextCycles, restOfDay } from './crew-context'

// The day's own checks — who works each duty and which vehicle runs each block — on top of
// what the crew/vehicle calculations already flag. Never block anything: they become
// DailyDuty.issues / DailyBlock.issues.

export interface DutyFacts {
  id:        string
  role:      string
  kind:      string
  branchId:  string | null
  summary:   DutySummary
  // lines and vehicle types of its live pieces
  lineIds:   string[]
  vehicleTypes: VehicleTypeValue[]
  // its fixed crew members — on it, the line, vehicle type and shift window checks are only info
  fixed:     string[]
}

export interface BlockFacts {
  id:          string
  branchId:    string | null
  vehicleId:   string | null
  window:      { startMinutes: number; endMinutes: number } | null
  lineIds:     string[]
  // requiredVehicleType of its trips
  requiredTypes: VehicleTypeValue[]
  // service spans with no DRIVER piece (CrewPlanSummary.uncovered)
  uncoveredMinutes: number
}

type CrewRow = Awaited<ReturnType<typeof loadCrewFacts>>['members'][number]

// Everything the crew checks read about the crew members holding the day's duties — `crewContext`:
// the day's DailyOperation.crewContext (the rest cycles it was generated with)
export async function loadCrewFacts(prisma: PrismaService, roster: TransitRosterConfigService, day: Day, dailyDutyIds: string[], crewContext: unknown = null) {
  const entries = await prisma.rosterEntry.findMany({
    where:  { dailyDutyId: { in: dailyDutyIds } },
    select: { crewMemberId: true, dailyDutyId: true },
  })
  const memberIds = [...new Set(entries.map(e => e.crewMemberId))]
  const date = toDbDate(day)
  const [members, sameDay, neighbors, occurrences, holidays] = await Promise.all([
    prisma.crewMember.findMany({
      where:  { id: { in: memberIds } },
      select: {
        id: true, isRosterable: true, notBeforeMinutes: true, notAfterMinutes: true, restOffset: true,
        blockedVehicleTypes: true, licenseExpiresAt: true, courseExpiresAt: true, standbyBlocked: true,
        employee:    { select: { branchId: true, status: true } },
        restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } },
        lines:       { select: { lineId: true, access: true } },
        shifts: {
          where:  { validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
          select: { shift: { select: { ...shiftWindowSelect, restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } } } } },
        },
      },
    }),
    // every entry of these people on the date, in any Scope — more than one duty / a day off
    prisma.rosterEntry.findMany({
      where:  { crewMemberId: { in: memberIds }, date },
      select: { crewMemberId: true, kind: true, dailyDutyId: true, dailyDuty: { select: { summary: true } } },
    }),
    prisma.rosterEntry.findMany({
      where:  { crewMemberId: { in: memberIds }, date: { in: [toDbDate(addDays(day, -1)), toDbDate(addDays(day, 1))] }, dailyDutyId: { not: null } },
      select: { crewMemberId: true, date: true, dailyDuty: { select: { summary: true } } },
    }),
    prisma.crewOccurrence.findMany({
      where:  { crewMemberId: { in: memberIds }, status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } },
      select: { crewMemberId: true, kind: true, startNotBefore: true, endNotAfter: true },
    }),
    prisma.holiday.findMany({ where: { date }, select: { branchId: true } }),
  ])
  const branches = [...new Set(members.map(m => m.employee.branchId))]
  const settings = new Map(await Promise.all(branches.map(async b => [b, await roster.get(b)] as const)))
  const cycles = await loadContextCycles(prisma, [crewContext])
  return { entries, members, sameDay, neighbors, occurrences, holidays, settings, crewContext, cycles }
}

const shiftWindowSelect = {
  id: true, priority: true, allowSplit: true,
  startFloor: true, startIdealMin: true, startIdealMax: true, startCeiling: true,
  endFloor: true, endIdealMin: true, endIdealMax: true, endCeiling: true,
} as const

// issues per daily duty about the crew member on it
export function crewIssues(
  day: Day, duties: DutyFacts[], facts: Awaited<ReturnType<typeof loadCrewFacts>>, restFloor: number,
): Map<string, DailyIssue[]> {
  const out = new Map<string, DailyIssue[]>()
  const memberById = new Map(facts.members.map(m => [m.id, m]))
  const holderOf = new Map(facts.entries.map(e => [e.dailyDutyId!, e.crewMemberId]))

  for (const duty of duties) {
    const issues: DailyIssue[] = []
    out.set(duty.id, issues)
    const memberId = holderOf.get(duty.id)
    if (!memberId) {
      if (duty.kind === 'STANDBY') issues.push({ code: 'RESERVE_SHORT', severity: 'warning' })
      else if (duty.role === 'DRIVER') issues.push({ code: 'DUTY_UNASSIGNED', severity: 'error' })
      continue
    }
    const m = memberById.get(memberId)
    if (!m) continue
    const push = (code: DailyIssue['code'], severity: DailyIssue['severity'] = 'error', value?: number) =>
      issues.push({ code, severity, crewMemberId: memberId, ...(value != null ? { value } : {}) })
    const fixedRule = duty.fixed.includes(memberId) ? 'info' : 'error'

    if (m.employee.status !== 'ACTIVE') push('CREW_INACTIVE')
    if (facts.occurrences.some(o => o.crewMemberId === memberId && o.kind === 'ABSENCE')) push('CREW_ABSENT')

    const mine = facts.sameDay.filter(e => e.crewMemberId === memberId)
    if (mine.some(e => e.kind === 'DAY_OFF' || e.kind === 'COMP_OFF') || offByPattern(m, day, facts)) push('CREW_ON_DAY_OFF')
    if (mine.filter(e => e.dailyDutyId).length > 1) push('CREW_MULTIPLE_DUTIES', 'warning')

    if (duty.branchId && m.employee.branchId !== duty.branchId) push('CREW_BRANCH_MISMATCH')

    const start = duty.summary.startMinutes, end = duty.summary.endMinutes
    const shift = m.shifts[0]?.shift
    const window = shift ? effectiveWindow(shift, m, facts.occurrences.filter(o => o.crewMemberId === memberId)) : null
    if (!shift) push('NO_SHIFT', 'warning')
    else if (start != null && end != null && !shiftFits(window!, start, end, duty.kind)) {
      push('SHIFT_WINDOW', fixedRule)
    } else if (start != null && end != null && window) {
      // inside the window but far from its ideal (beyond shiftFit's ceiling): an advisory
      const limit = facts.settings.get(m.employee.branchId)?.range.shiftFit.ceiling ?? 120
      const off = shiftIdealDistance(window, start, end)
      if (off > limit) {
        const side = (label: string, v: number, lo: number, hi: number) =>
          v < lo || v > hi ? `${label} ${clock(v)} (ideal ${clock(lo)}–${clock(hi)})` : null
        const detail = [side('início', start, window.startIdealMin, window.startIdealMax), side('fim', end, window.endIdealMin, window.endIdealMax)].filter(Boolean).join(' · ')
        issues.push({ code: 'SHIFT_IDEAL', severity: 'info', crewMemberId: memberId, value: off, detail })
      }
    }

    const mode = facts.settings.get(m.employee.branchId)?.lineAccessMode ?? 'BLACKLIST'
    const access = new Map(m.lines.map(l => [l.lineId, l.access]))
    if (duty.lineIds.some(l => mode === 'WHITELIST' ? access.get(l) !== 'ENABLED' : access.get(l) === 'BLOCKED')) push('LINE_NOT_ALLOWED', fixedRule)
    if (duty.vehicleTypes.some(t => m.blockedVehicleTypes.includes(t))) push('VEHICLE_TYPE_BLOCKED', fixedRule)
    if (duty.kind === 'STANDBY' && m.standbyBlocked) push('STANDBY_BLOCKED')

    const expired = (d: Date | null) => !!d && dayOf(d) < day
    if (expired(m.licenseExpiresAt)) push('LICENSE_EXPIRED')
    if (expired(m.courseExpiresAt)) push('COURSE_EXPIRED')

    // rest from the previous day's duty to this one, and from this one to the next day's
    if (start != null && end != null) {
      for (const n of facts.neighbors.filter(x => x.crewMemberId === memberId)) {
        const s = n.dailyDuty?.summary as DutySummary | null
        if (s?.startMinutes == null || s.endMinutes == null) continue
        const rest = dayOf(n.date) < day ? 1440 + start - s.endMinutes : 1440 + s.startMinutes - end
        if (rest < restFloor) push('INTER_SHIFT_REST', 'error', rest)
      }
    }
  }
  return out
}

// the shift's bounds, with the crew member's own and an approved time-window request on top
export function effectiveWindow(
  shift: ShiftWindow, m: Pick<CrewRow, 'notBeforeMinutes' | 'notAfterMinutes'>,
  occurrences: { kind: string; startNotBefore: number | null; endNotAfter: number | null }[],
): ShiftWindow {
  let startFloor = m.notBeforeMinutes ?? shift.startFloor
  let endCeiling = m.notAfterMinutes ?? shift.endCeiling
  for (const o of occurrences.filter(x => x.kind === 'TIME_WINDOW')) {
    if (o.startNotBefore != null) startFloor = Math.max(startFloor, o.startNotBefore)
    if (o.endNotAfter != null) endCeiling = Math.min(endCeiling, o.endNotAfter)
  }
  return { ...shift, startFloor, endCeiling }
}

// off by his rest cycle — the one the day was generated with, else his current one
function offByPattern(m: CrewRow, day: Day, facts: Awaited<ReturnType<typeof loadCrewFacts>>): boolean {
  const { pattern, offset } = restOfDay(facts.crewContext, m.id, facts.cycles, { pattern: m.restPattern ?? m.shifts[0]?.shift.restPattern ?? null, offset: m.restOffset })
  if (!pattern) return false
  const isHoliday = facts.holidays.some(h => !h.branchId || h.branchId === m.employee.branchId)
  return !restPatternWorks(pattern, offset, day, isHoliday)
}

// issues per daily block about its vehicle and coverage
export async function vehicleIssues(prisma: PrismaService, day: Day, blocks: BlockFacts[]): Promise<Map<string, DailyIssue[]>> {
  const out = new Map<string, DailyIssue[]>(blocks.map(b => [b.id, []]))
  const vehicleIds = [...new Set(blocks.map(b => b.vehicleId).filter((id): id is string => !!id))]
  const lineIds    = [...new Set(blocks.flatMap(b => b.lineIds))]
  const date = toDbDate(day)
  const [vehicles, lines] = await Promise.all([
    prisma.vehicle.findMany({
      where:  { id: { in: vehicleIds } },
      select: {
        id: true, status: true, branchId: true, vehicleType: true,
        unavailabilities: { where: { startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] }, select: { id: true } },
      },
    }),
    prisma.transitLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, vehicleTypes: true } }),
  ])
  const vehicleById = new Map(vehicles.map(v => [v.id, v]))
  const allowedByLine = new Map(lines.map(l => {
    const vt = lineVehicleTypesSchema.safeParse(l.vehicleTypes ?? {})
    return [l.id, vt.success ? vt.data.allowed : []]
  }))

  for (const b of blocks) {
    const issues = out.get(b.id)!
    if (b.uncoveredMinutes > 0) issues.push({ code: 'BLOCK_NO_CREW', severity: 'error', value: b.uncoveredMinutes })
    if (!b.vehicleId) { issues.push({ code: 'BLOCK_NO_VEHICLE', severity: 'error' }); continue }
    const v = vehicleById.get(b.vehicleId)
    if (!v) continue
    if (v.status !== 'ACTIVE' || v.unavailabilities.length) issues.push({ code: 'VEHICLE_UNAVAILABLE', severity: 'error' })
    if (b.branchId && v.branchId !== b.branchId) issues.push({ code: 'VEHICLE_BRANCH_MISMATCH', severity: 'warning' })
    const typeOk = b.lineIds.every(l => { const a = allowedByLine.get(l) ?? []; return !a.length || a.includes(v.vehicleType) })
      && b.requiredTypes.every(t => t === v.vehicleType)
    if (!typeOk) issues.push({ code: 'VEHICLE_TYPE_MISMATCH', severity: 'error' })
  }

  // the same vehicle on blocks whose windows overlap
  const byVehicle = new Map<string, BlockFacts[]>()
  for (const b of blocks) if (b.vehicleId && b.window) byVehicle.set(b.vehicleId, [...(byVehicle.get(b.vehicleId) ?? []), b])
  for (const list of byVehicle.values()) {
    for (const a of list) {
      if (list.some(o => o !== a && o.window!.startMinutes < a.window!.endMinutes && o.window!.endMinutes > a.window!.startMinutes)) {
        out.get(a.id)!.push({ code: 'VEHICLE_DOUBLE', severity: 'error' })
      }
    }
  }
  return out
}

// 05:30 — minutes past midnight, 24h+ wrapped
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
