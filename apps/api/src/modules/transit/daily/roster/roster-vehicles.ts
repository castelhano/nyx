import { lineVehicleTypesSchema, type VehicleTypeValue } from '@nyx/schemas'
import type { PrismaService } from '../../../../prisma/prisma.service'
import { addDays, dayOf, toDbDate } from '../../timetabling/plan-validity'
import { hungarian } from './hungarian'

// Redoes the vehicles of the empresa's blocks on the given (editable) days (plan §5.5 step 5) —
// like the crew, a generation starts over: every block's car is released first. The block's anchor is the crew member of its earliest DRIVER piece; the
// car goes, in this order, to: the anchor's preferred vehicle → another crew member's preferred
// one → the anchor's habitual car (most driven in the last `habitualDays`) → another crew member's
// habitual car → any eligible one.
// Eligible: the empresa's, active, available on the date, of a type every line and trip of the
// block accepts, not on another block of the date. One minimum-cost matching per date.
// An explicit preference outranks a habit: another holder's preferred car beats the anchor's
// habitual one.

const BLOCKED  = 1e9
const NO_CAR   = 1000
const COST = { preferred: 0, otherPreferred: 1, habitual: 2, otherHabitual: 3, any: 10 }

export async function assignVehicles(prisma: PrismaService, branchId: string, operationIds: string[], habitualDays: number): Promise<number> {
  await prisma.dailyBlock.updateMany({ where: { dailyOperationId: { in: operationIds }, branchId }, data: { vehicleId: null } })
  const blocks = await prisma.dailyBlock.findMany({
    where:  { dailyOperationId: { in: operationIds }, branchId, vehicleId: null },
    select: {
      id: true,
      operation: { select: { date: true } },
      events:    { where: { kind: 'TRIP', isCancelled: false }, select: { lineId: true, requiredVehicleType: true } },
      pieces:    {
        where:  { isStale: false, duty: { role: 'DRIVER' } },
        select: { startMinutes: true, duty: { select: { rosterEntries: { select: { crewMemberId: true } } } } },
      },
    },
  })
  if (!blocks.length) return 0

  const dates = [...new Set(blocks.map(b => dayOf(b.operation.date)))].sort()
  const crewIds = [...new Set(blocks.flatMap(b => b.pieces.flatMap(p => p.duty.rosterEntries.map(e => e.crewMemberId))))]
  const lineIds = [...new Set(blocks.flatMap(b => b.events.flatMap(e => e.lineId ?? [])))]

  const [vehicles, used, lines, crew, history] = await Promise.all([
    prisma.vehicle.findMany({
      where:  { branchId, status: 'ACTIVE' },
      select: {
        id: true, vehicleType: true,
        unavailabilities: {
          where:  { startDate: { lte: toDbDate(dates[dates.length - 1]) }, OR: [{ endDate: null }, { endDate: { gte: toDbDate(dates[0]) } }] },
          select: { startDate: true, endDate: true },
        },
      },
    }),
    prisma.dailyBlock.findMany({
      where:  { vehicleId: { not: null }, operation: { date: { in: dates.map(toDbDate) } } },
      select: { vehicleId: true, operation: { select: { date: true } } },
    }),
    prisma.transitLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, vehicleTypes: true } }),
    prisma.crewMember.findMany({ where: { id: { in: crewIds } }, select: { id: true, preferredVehicleId: true } }),
    // the cars each crew member drove before the first date
    prisma.rosterEntry.findMany({
      where:  { crewMemberId: { in: crewIds }, date: { gte: toDbDate(addDays(dates[0], -habitualDays)), lt: toDbDate(dates[0]) }, dailyDutyId: { not: null } },
      select: { crewMemberId: true, dailyDuty: { select: { pieces: { select: { block: { select: { vehicleId: true } } } } } } },
    }),
  ])

  const allowedByLine = new Map(lines.map(l => {
    const vt = lineVehicleTypesSchema.safeParse(l.vehicleTypes ?? {})
    return [l.id, vt.success ? vt.data.allowed : []]
  }))
  const preferred = new Map(crew.map(c => [c.id, c.preferredVehicleId]))
  const habitual = new Map<string, string>()
  const counts = new Map<string, Map<string, number>>()
  for (const e of history) {
    const c = counts.get(e.crewMemberId) ?? new Map<string, number>()
    counts.set(e.crewMemberId, c)
    for (const p of e.dailyDuty?.pieces ?? []) if (p.block?.vehicleId) c.set(p.block.vehicleId, (c.get(p.block.vehicleId) ?? 0) + 1)
  }
  for (const [crewId, c] of counts) {
    const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top) habitual.set(crewId, top[0])
  }

  let assigned = 0
  for (const date of dates) {
    const busy = new Set(used.filter(u => dayOf(u.operation.date) === date).map(u => u.vehicleId!))
    const pool = vehicles.filter(v => !busy.has(v.id) && !v.unavailabilities.some(u => dayOf(u.startDate) <= date && (!u.endDate || dayOf(u.endDate) >= date)))
    const rows = blocks.filter(b => dayOf(b.operation.date) === date)
    if (!pool.length || !rows.length) continue

    const cols = pool.length + rows.length
    const cost = rows.map((b, r) => {
      const pieces = [...b.pieces].sort((x, y) => x.startMinutes - y.startMinutes)
      const holders = pieces.map(p => p.duty.rosterEntries[0]?.crewMemberId).filter((x): x is string => !!x)
      const anchor = holders[0]
      const required = [...new Set(b.events.map(e => e.requiredVehicleType).filter((t): t is VehicleTypeValue => !!t))]
      const line = new Array<number>(cols).fill(BLOCKED)
      line[pool.length + r] = NO_CAR
      pool.forEach((v, c) => {
        const typeOk = b.events.every(e => { const a = (e.lineId && allowedByLine.get(e.lineId)) || []; return !a.length || a.includes(v.vehicleType) })
          && required.every(t => t === v.vehicleType)
        if (!typeOk) return
        line[c] = anchor && preferred.get(anchor) === v.id ? COST.preferred
          : holders.some(h => preferred.get(h) === v.id) ? COST.otherPreferred
          : anchor && habitual.get(anchor) === v.id ? COST.habitual
          : holders.some(h => habitual.get(h) === v.id) ? COST.otherHabitual
          : COST.any
      })
      return line
    })
    const chosen = hungarian(cost, cols)
    for (let r = 0; r < rows.length; r++) {
      const c = chosen[r]
      if (c < 0 || c >= pool.length || cost[r][c] >= BLOCKED) continue
      await prisma.dailyBlock.update({ where: { id: rows[r].id }, data: { vehicleId: pool[c].id } })
      assigned++
    }
  }
  return assigned
}
