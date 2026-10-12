import { BadRequestException, NotFoundException } from '@nestjs/common'
import { mealPolicy, restPatternWorks, type CrewSettings, type DayTypePattern, type ShiftWindow, type VehiclePlanConstraints } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { insideBundle, loadBlockRelief } from '../crew-plan/relief-points'
import { loadCrewWalk } from '../crew-plan/crew-walk'
import { loadCrewBranchRules } from '../crew-plan/crew-branch-rules'
import type { CrewCalcDuty } from '../crew-plan/crew-scoring.calc'
import type { CrewCapacity, CrewPin, CrewSolverInput, SolverBlock } from './crew-solver.calc'

// Everything solveCrewPlan needs for one crew plan, in a few queries: its VehiclePlan's
// blocks (relief points, trips, deadruns), its locked duties, the meal break type and meal
// stops, and the crew walking distances among the relief points' localities. limitToCrew: also
// the empresas' active crew per shift (CrewCapacity).
export async function loadCrewSolverInput(prisma: PrismaService, crewPlanId: string, settings: CrewSettings, options: { limitToCrew?: boolean } = {}): Promise<CrewSolverInput> {
  // the meal type only matters when meal breaks are placed (continuous form, allowed or required)
  const breaks = mealPolicy(settings.mealRule).breaks
  const mealTypeId = breaks ? settings.mealBreakIntervalTypeId : null
  if (breaks && !mealTypeId) {
    throw new BadRequestException('Defina o tipo de intervalo de refeição nas configurações da escala')
  }
  const [plan, mealType] = await Promise.all([
    prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { vehiclePlanId: true, vehiclePlan: { select: { constraints: true, dayType: { select: { pattern: true } } } } } }),
    mealTypeId
      ? prisma.intervalType.findUnique({ where: { id: mealTypeId }, select: { minMinutes: true, maxMinutes: true, isPaid: true } })
      : Promise.resolve(null),
  ])
  if (!plan) throw new NotFoundException('crewPlan not found')
  if (mealTypeId && !mealType) throw new BadRequestException('Tipo de intervalo de refeição não encontrado')

  const [blockRows, lockedRows, mealStops, branchRules] = await Promise.all([
    prisma.vehicleBlock.findMany({ where: { vehiclePlanId: plan.vehiclePlanId }, select: { id: true } }),
    prisma.duty.findMany({
      where:  { crewPlanId, constraints: { path: ['locked'], equals: true } },
      select: {
        id: true, role: true, kind: true, branchId: true, shiftId: true, shiftPinned: true,
        pieces:     { where: { isStale: false }, select: { id: true, vehicleBlockId: true, startMinutes: true, endMinutes: true, startLocalityId: true, endLocalityId: true } },
        activities: { select: { id: true, type: true, intervalTypeId: true, startMinutes: true, endMinutes: true, intervalType: { select: { isPaid: true } } } },
      },
    }),
    prisma.routeLocality.findMany({ where: { allowsMealBreak: true, localityId: { not: null } }, select: { routeId: true, localityId: true } }),
    loadCrewBranchRules(prisma, { vehiclePlanId: plan.vehiclePlanId }),
  ])
  const relief = await loadBlockRelief(prisma, blockRows.map(b => b.id))

  // no relief point inside a trip group: every cut, split or meal gap the solver can pick sits on
  // one, so a group always stays with one driver and nothing is placed inside it
  const blocks: SolverBlock[] = [...relief.entries()].map(([id, r]) => ({
    id, branchId: r.branchId, window: r.window, serviceSpans: r.serviceSpans, trips: r.trips, deadruns: r.deadruns, bundles: r.bundles,
    points: r.points.filter(p => !insideBundle(r.bundles, p.minutes)),
  }))

  const localityIds = [...new Set(blocks.flatMap(b => b.points.map(p => p.localityId)))]
  const [walk, crew, pins] = await Promise.all([
    loadCrewWalk(prisma, localityIds),
    options.limitToCrew
      ? loadCrewCapacity(prisma, branchRules.shifts, [...new Set(blocks.flatMap(b => b.branchId ?? []))], dayTypeWeekdays(plan.vehiclePlan.dayType.pattern as DayTypePattern | null))
      : undefined,
    loadCrewPins(prisma, blocks, (plan.vehiclePlan.constraints as VehiclePlanConstraints | null)?.bundleCrew ?? {}),
  ])

  const locked: CrewCalcDuty[] = lockedRows.map(d => ({
    id: d.id, role: d.role, kind: d.kind, branchId: d.branchId, shiftId: d.shiftId, shiftPinned: d.shiftPinned, pieces: d.pieces,
    activities: d.activities.map(a => ({
      id: a.id, type: a.type, intervalTypeId: a.intervalTypeId, startMinutes: a.startMinutes, endMinutes: a.endMinutes,
      isPaidBreak: a.type === 'BREAK' && !!a.intervalType?.isPaid,
    })),
  }))

  return {
    blocks, locked, settings,
    meal: mealTypeId && mealType ? {
      intervalTypeId: mealTypeId,
      // the type's own range; the CCT meal criterion only scores
      minMinutes: mealType.minMinutes ?? settings.range.mealBreak.floor,
      maxMinutes: mealType.maxMinutes ?? settings.range.mealBreak.ceiling,
      isPaid:     mealType.isPaid,
    } : null,
    mealStops:     new Set(mealStops.map(s => `${s.routeId}:${s.localityId}`)),
    walk,
    shifts:        branchRules.shifts,
    lineOperators: branchRules.lineOperators,
    crew,
    pins,
  }
}

// The trip groups with crew members (VehiclePlan.constraints.bundleCrew) on the plan's blocks,
// each with its first crew member's shift today — a group whose first one has no shift isn't pinned
async function loadCrewPins(prisma: PrismaService, blocks: SolverBlock[], bundleCrew: Record<string, string[]>): Promise<CrewPin[]> {
  const firsts = [...new Set(Object.values(bundleCrew).flatMap(ids => ids.slice(0, 1)))]
  if (!firsts.length) return []
  const today = new Date(new Date().toISOString().slice(0, 10))
  const rows = await prisma.crewMemberShift.findMany({
    where:  { crewMemberId: { in: firsts }, validFrom: { lte: today }, OR: [{ validTo: null }, { validTo: { gte: today } }] },
    select: {
      crewMemberId: true,
      shift: { select: { id: true, priority: true, allowSplit: true, startFloor: true, startIdealMin: true, startIdealMax: true, startCeiling: true, endFloor: true, endIdealMin: true, endIdealMax: true, endCeiling: true } },
    },
  })
  const windowOf = new Map<string, ShiftWindow>(rows.map(r => [r.crewMemberId, r.shift]))
  return blocks.flatMap(b => (b.bundles ?? []).flatMap(w => {
    const window = w.id ? windowOf.get(bundleCrew[w.id]?.[0] ?? '') : undefined
    return window && w.id ? [{ blockId: b.id, bundleId: w.id, startMinutes: w.startMinutes, endMinutes: w.endMinutes, window }] : []
  }))
}

// The ISO weekdays (1–7) a day type runs on — all of them when it has no weekday pattern
function dayTypeWeekdays(pattern: DayTypePattern | null): number[] {
  const days = pattern?.type === 'weekdays' ? pattern.days : pattern?.type === 'month_window' ? pattern.baseWeekdays : undefined
  return days?.length ? days : [1, 2, 3, 4, 5, 6, 7]
}

// The empresas' active crew (DRIVER, rosterable, employee ACTIVE) on a day of the plan, per
// shift: each crew member bound to one of the empresa's shifts today counts the share of the
// weekday it works over its rest cycle (its own pattern and group, else the shift's pattern;
// none: every day) — on the day type's worst weekday (a weekday plan doesn't lose the crew off
// on weekends). An empresa without one is left out (not limited); the others list all their
// shifts, empty ones at 0.
// TODO: crew members on vacation in the plan's validity are out too, once vacations exist.
async function loadCrewCapacity(prisma: PrismaService, shifts: Map<string, ShiftWindow[]>, branchIds: string[], weekdays: number[]): Promise<CrewCapacity> {
  const today = new Date(new Date().toISOString().slice(0, 10))
  const [members, shiftRows, branches] = await Promise.all([
    prisma.crewMember.findMany({
      where:  { role: 'DRIVER', isRosterable: true, employee: { status: 'ACTIVE', branchId: { in: branchIds } } },
      select: {
        employee:    { select: { branchId: true } },
        restOffset:  true,
        restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } },
        shifts: {
          where:  { validFrom: { lte: today }, OR: [{ validTo: null }, { validTo: { gte: today } }] },
          select: { shiftId: true, shift: { select: { restPattern: { select: { pattern: true, anchorDate: true, offOnHolidays: true } } } } },
          take:   1,
        },
      },
    }),
    prisma.crewShift.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
    prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }),
  ])
  const code = new Map(shiftRows.map(s => [s.id, s.code]))
  // per weekday, the share of those days the crew member works over a whole cycle × week
  type Cycle = { pattern: string; anchorDate: Date; offOnHolidays: boolean }
  const shares = (cycle: Cycle | null, offset: number): number[] => {
    if (!cycle?.pattern.length) return weekdays.map(() => 1)
    const worked = new Map<number, [number, number]>()
    const start = Date.parse(today.toISOString().slice(0, 10))
    for (let i = 0; i < cycle.pattern.length * 7; i++) {
      const date = new Date(start + i * 86_400_000)
      const wd = date.getUTCDay() || 7
      const [t, n] = worked.get(wd) ?? [0, 0]
      worked.set(wd, [t + (restPatternWorks(cycle, offset, date.toISOString().slice(0, 10)) ? 1 : 0), n + 1])
    }
    return weekdays.map(wd => { const [t, n] = worked.get(wd)!; return t / n })
  }

  // `${branchId}|${shiftId}` → crew working on each of the day type's weekdays
  const crew = new Map<string, number[]>()
  for (const m of members) {
    const bound = m.shifts[0]
    const { branchId } = m.employee
    if (!bound || !(shifts.get(branchId) ?? []).some(s => s.id === bound.shiftId)) continue
    const key = `${branchId}|${bound.shiftId}`
    const mine = shares(m.restPattern ?? bound.shift.restPattern, m.restOffset)
    crew.set(key, (crew.get(key) ?? weekdays.map(() => 0)).map((n, i) => n + mine[i]))
  }
  const limited = new Set([...crew.keys()].map(k => k.split('|')[0]))
  return {
    shifts: branches.filter(b => limited.has(b.id)).flatMap(b => (shifts.get(b.id) ?? []).map(s => ({
      ...s, branchId: b.id, branchName: b.name, code: code.get(s.id) ?? '',
      capacity: Math.floor(Math.min(...(crew.get(`${b.id}|${s.id}`) ?? [0])) + 1e-9),
    }))),
  }
}
