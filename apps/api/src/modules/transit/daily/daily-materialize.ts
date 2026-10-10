import { randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { DailySource } from '@nyx/schemas'
import type { PrismaService } from '../../../prisma/prisma.service'
import type { DayTypeService } from '../timetabling/day-type/day-type.service'
import { findActivePlan, inForce, parseDay } from '../timetabling/dop/dop-resolution'
import { toDbDate, type Day } from '../timetabling/plan-validity'

// Copies the plans in force on `day` into a new DailyOperation — no adjustment at all (the day
// shows its issues; fixing them is the user's call).
//
// Each active line of the Scope runs the VehiclePlan of the DayType it resolves to on the date
// (resolveDayType: pattern + LineCalendarException). A normal day has one plan. A mixed day
// (lines under different day types) copies, from each plan, the blocks holding trips of its own
// lines, keeping only those trips; the duties touching a copied block come along, a piece on a
// block that didn't come is stale. Blocks/duties of the secondary plans are renumbered after the
// primary's (the plan of the date's own day type).
export async function materializeDay(prisma: PrismaService, dayTypes: DayTypeService, scopeId: string, day: Day): Promise<string> {
  const date = parseDay(day)!
  const [lines, plans, base] = await Promise.all([
    prisma.transitLine.findMany({ where: { scopeId, isActive: true }, select: { id: true } }),
    prisma.vehiclePlan.findMany({
      where:  { scopeId, status: { in: ['ACTIVE', 'SUPERSEDED'] } },
      select: {
        id: true, dayTypeId: true, validFrom: true, validTo: true,
        lines:     { select: { lineId: true } },
        crewPlans: { where: { status: { in: ['ACTIVE', 'SUPERSEDED'] } }, select: { id: true, validFrom: true, validTo: true } },
      },
    }),
    dayTypes.resolveByPattern(date).catch(() => { throw new BadRequestException('Nenhum tipo de dia cobre a data') }),
  ])

  // lines per plan in force
  const byPlan = new Map<string, { plan: (typeof plans)[number]; dayTypeId: string; lineIds: string[] }>()
  for (const line of lines) {
    const dt   = await dayTypes.resolveDayType(date, line.id)
    const plan = findActivePlan(plans, dt.id, line.id, date)
    if (!plan) continue
    const entry = byPlan.get(plan.id) ?? { plan, dayTypeId: dt.id, lineIds: [] }
    entry.lineIds.push(line.id)
    byPlan.set(plan.id, entry)
  }
  if (!byPlan.size) throw new BadRequestException('Nenhum planejamento em vigor na data para as linhas do escopo')

  // the primary plan first: the date's own day type, then the one with most lines
  const groups = [...byPlan.values()].sort((a, b) =>
    Number(b.dayTypeId === base.id) - Number(a.dayTypeId === base.id) || b.lineIds.length - a.lineIds.length)

  const sources: DailySource[] = groups.map(g => ({
    vehiclePlanId: g.plan.id,
    crewPlanId:    g.plan.crewPlans.find(c => inForce(c, date))?.id ?? null,
    dayTypeId:     g.dayTypeId,
    lineIds:       g.lineIds,
  }))

  const operationId = randomUUID()
  const blocks:     Prisma.DailyBlockCreateManyInput[]        = []
  const events:     Prisma.DailyBlockEventCreateManyInput[]   = []
  const duties:     Prisma.DailyDutyCreateManyInput[]         = []
  const pieces:     Prisma.DailyDutyPieceCreateManyInput[]    = []
  const activities: Prisma.DailyDutyActivityCreateManyInput[] = []
  let blockOffset = 0
  const dutyOffset = new Map<string, number>()

  for (const source of sources) {
    const lineIds = new Set(source.lineIds)
    const [planBlocks, looseTrips, planDuties] = await Promise.all([
      prisma.vehicleBlock.findMany({
        where:   { vehiclePlanId: source.vehiclePlanId },
        orderBy: { blockNumber: 'asc' },
        select: {
          id: true, blockNumber: true, branchId: true, depotId: true, vehicleType: true,
          blockTrips:     { select: { trip: { select: tripSelect } } },
          blockDeadruns:  { select: { id: true, type: true, originLocalityId: true, destinationLocalityId: true, departureMinutes: true, arrivalMinutes: true, bundleId: true } },
          blockIntervals: { select: { id: true, intervalTypeId: true, departureMinutes: true, arrivalMinutes: true, bundleId: true } },
        },
      }),
      // trips of the day's lines the plan never put on a vehicle
      prisma.transitTrip.findMany({
        where:  { vehiclePlanId: source.vehiclePlanId, blockTrips: { none: {} }, route: { lineId: { in: source.lineIds } } },
        select: tripSelect,
      }),
      source.crewPlanId
        ? prisma.duty.findMany({ where: { crewPlanId: source.crewPlanId }, include: { pieces: true, activities: true } })
        : Promise.resolve([]),
    ])

    const blockIdBySource = new Map<string, string>()
    let maxNumber = 0
    for (const b of planBlocks) {
      const trips = b.blockTrips.map(bt => bt.trip).filter(t => lineIds.has(t.route.lineId))
      if (!trips.length) continue
      const id = randomUUID()
      blockIdBySource.set(b.id, id)
      maxNumber = Math.max(maxNumber, b.blockNumber)
      blocks.push({
        id, dailyOperationId: operationId, sourceBlockId: b.id, blockNumber: b.blockNumber + blockOffset,
        branchId: b.branchId, depotId: b.depotId, vehicleType: b.vehicleType,
      })
      for (const t of trips) events.push(tripEvent(operationId, id, t))
      for (const d of b.blockDeadruns) {
        events.push({
          dailyOperationId: operationId, dailyBlockId: id, kind: 'DEADRUN', sourceId: d.id, deadrunType: d.type,
          originLocalityId: d.originLocalityId, destinationLocalityId: d.destinationLocalityId,
          startMinutes: d.departureMinutes, endMinutes: d.arrivalMinutes, bundleId: d.bundleId,
        })
      }
      for (const i of b.blockIntervals) {
        events.push({
          dailyOperationId: operationId, dailyBlockId: id, kind: 'INTERVAL', sourceId: i.id, intervalTypeId: i.intervalTypeId,
          startMinutes: i.departureMinutes, endMinutes: i.arrivalMinutes, bundleId: i.bundleId,
        })
      }
    }
    for (const t of looseTrips) events.push(tripEvent(operationId, null, t))
    blockOffset += maxNumber

    const maxByRole = new Map<string, number>()
    for (const d of planDuties) {
      if (!d.pieces.some(p => p.vehicleBlockId && blockIdBySource.has(p.vehicleBlockId)) && d.kind !== 'STANDBY') continue
      const id = randomUUID()
      const offset = dutyOffset.get(d.role) ?? 0
      maxByRole.set(d.role, Math.max(maxByRole.get(d.role) ?? 0, d.dutyNumber))
      duties.push({
        id, dailyOperationId: operationId, sourceDutyId: d.id, role: d.role, dutyNumber: d.dutyNumber + offset,
        kind: d.kind, branchId: d.branchId, shiftId: d.shiftId,
      })
      for (const p of d.pieces) {
        const blockId = p.vehicleBlockId ? blockIdBySource.get(p.vehicleBlockId) ?? null : null
        pieces.push({
          dailyDutyId: id, dailyBlockId: blockId, sequence: p.sequence, startMinutes: p.startMinutes, endMinutes: p.endMinutes,
          startLocalityId: p.startLocalityId, endLocalityId: p.endLocalityId,
          isStale: !blockId, staleReason: blockId ? null : 'BLOCK_REMOVED',
        })
      }
      for (const a of d.activities) {
        activities.push({
          dailyDutyId: id, type: a.type, intervalTypeId: a.intervalTypeId, startMinutes: a.startMinutes, endMinutes: a.endMinutes,
          originLocalityId: a.originLocalityId, destinationLocalityId: a.destinationLocalityId,
        })
      }
    }
    for (const [role, max] of maxByRole) dutyOffset.set(role, (dutyOffset.get(role) ?? 0) + max)
  }

  await prisma.$transaction([
    prisma.dailyOperation.create({
      data: { id: operationId, scopeId, date: toDbDate(day), dayTypeId: base.id, sources: sources as unknown as Prisma.InputJsonValue },
    }),
    prisma.dailyBlock.createMany({ data: blocks }),
    prisma.dailyBlockEvent.createMany({ data: events }),
    prisma.dailyDuty.createMany({ data: duties }),
    prisma.dailyDutyPiece.createMany({ data: pieces }),
    prisma.dailyDutyActivity.createMany({ data: activities }),
  ], { timeout: 60_000 })
  return operationId
}

const tripSelect = {
  id: true, departureMinutes: true, arrivalMinutes: true, requiredVehicleType: true, bundleId: true, routeId: true,
  route: { select: { lineId: true, originLocalityId: true, destinationLocalityId: true } },
} as const

type TripRow = {
  id: string; departureMinutes: number; arrivalMinutes: number; requiredVehicleType: Prisma.DailyBlockEventCreateManyInput['requiredVehicleType']
  bundleId: string | null; routeId: string; route: { lineId: string; originLocalityId: string; destinationLocalityId: string }
}

function tripEvent(dailyOperationId: string, dailyBlockId: string | null, t: TripRow): Prisma.DailyBlockEventCreateManyInput {
  return {
    dailyOperationId, dailyBlockId, kind: 'TRIP', sourceId: t.id, lineId: t.route.lineId, routeId: t.routeId,
    originLocalityId: t.route.originLocalityId, destinationLocalityId: t.route.destinationLocalityId,
    startMinutes: t.departureMinutes, endMinutes: t.arrivalMinutes, requiredVehicleType: t.requiredVehicleType, bundleId: t.bundleId,
  }
}
