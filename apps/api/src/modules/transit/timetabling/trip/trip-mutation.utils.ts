import { findIntervalIdsAnchoredToTrips } from '../vehicle-plan/block-interval.utils'
import { findDeadrunIdsAnchoredToTrips } from '../vehicle-plan/block-deadrun.utils'

// Core trip-mutation side effects (isStale marking, LineSchedule drift recomputation,
// anchored-interval/anchored-deadrun/empty-block cleanup on delete) shared between
// TripService (the standalone generic-resource path) and VehiclePlanService.applyDiff
// (the Gantt batch path). Plain functions taking a db/tx client so applyDiff can run
// them inside its own transaction without depending on TripService (which itself
// depends on VehiclePlanService — importing it here would cycle). See docs/proposal/
// vehicle-plan-summary-score-consolidation.md §2.4.

// Recomputes VehiclePlanLine.isDrifted for one line in one plan from scratch: not
// drifted iff the plan's current trips for this line, by {routeId, departureMinutes},
// exactly match its pinned LineSchedule's departures — no LineSchedule pinned means
// nothing to diverge from. Value-based (no reliance on any per-trip identity link to
// the LineDeparture it may have originated from) — safe to call redundantly, since it
// always derives the correct value fresh instead of accumulating state. Same match
// VehiclePlanService's reviseLineSchedule/activateNewLineSchedule already use.
export async function recomputeLineDrift(db: any, planId: string, lineId: string): Promise<void> {
  const [line, plan] = await Promise.all([
    db.vehiclePlanLine.findUnique({
      where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
      select: { lineScheduleId: true },
    }),
    db.vehiclePlan.findUnique({ where: { id: planId }, select: { dayTypeId: true } }),
  ])
  if (!line || !plan) return

  if (!line.lineScheduleId) {
    await db.vehiclePlanLine.update({
      where: { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
      data:  { isDrifted: false },
    })
    return
  }

  const [departures, currentTrips] = await Promise.all([
    db.lineDeparture.findMany({ where: { lineScheduleId: line.lineScheduleId }, select: { routeId: true, departureMinutes: true } }),
    db.transitTrip.findMany({
      where:  { dayTypeId: plan.dayTypeId, route: { lineId }, blockTrips: { some: { vehicleBlock: { vehiclePlanId: planId } } } },
      select: { routeId: true, departureMinutes: true },
    }),
  ])

  const departureKeys = new Set(departures.map((d: any) => `${d.routeId}:${d.departureMinutes}`))
  const tripKeys       = new Set(currentTrips.map((t: any) => `${t.routeId}:${t.departureMinutes}`))
  const covered = departureKeys.size === tripKeys.size && [...departureKeys].every(k => tripKeys.has(k))

  await db.vehiclePlanLine.update({
    where: { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
    data:  { isDrifted: !covered },
  })
}

// Trigger point after a single trip's own update/removal: recomputes drift (see
// above) for the given line, across every plan that currently uses `tripId` in one
// of its blocks. The trip's own mutation might not itself change the line's
// coverage, but recomputeLineDrift derives the correct answer regardless.
async function recomputeDriftForTrip(db: any, tripId: string, lineId: string): Promise<void> {
  const rows = await db.blockTrip.findMany({
    where:  { tripId },
    select: { vehicleBlock: { select: { vehiclePlanId: true } } },
  })
  const planIds = [...new Set(rows.map((r: any) => r.vehicleBlock.vehiclePlanId).filter(Boolean))] as string[]
  for (const planId of planIds) await recomputeLineDrift(db, planId, lineId)
}

// Two-step so the caller's own update() write (sanitizeDto'd generic update, or a
// narrow direct Prisma update from applyDiff) sits between them.
export async function beforeTripUpdate(db: any, id: string): Promise<{ route: { lineId: string } } | null> {
  return db.transitTrip.findUnique({
    where:  { id },
    select: { route: { select: { lineId: true } } },
  })
}

export async function afterTripUpdate(
  db: any, id: string,
  existing: { route: { lineId: string } } | null,
  patch:    { departureMinutes?: number; arrivalMinutes?: number },
  _result:  { departureMinutes: number },
): Promise<void> {
  const timeFieldsChanged = patch.departureMinutes !== undefined || patch.arrivalMinutes !== undefined
  if (timeFieldsChanged) {
    await db.vehicleBlock.updateMany({
      where: { blockTrips: { some: { tripId: id } } },
      data:  { isStale: true },
    })
  }

  // Only the departure minute is part of what the transit authority approves (a
  // LineDeparture has no arrival) — so coverage is only re-derived when it changes.
  if (patch.departureMinutes !== undefined && existing) {
    await recomputeDriftForTrip(db, id, existing.route.lineId)
  }
}

export async function applyTripRemoval(db: any, id: string): Promise<{ affectedPlanIds: string[] }> {
  const existing = await db.transitTrip.findUnique({
    where:  { id },
    select: { route: { select: { lineId: true } } },
  })

  const rows: { vehicleBlockId: string; vehicleBlock: { vehiclePlanId: string | null } }[] =
    await db.blockTrip.findMany({
      where:  { tripId: id },
      select: { vehicleBlockId: true, vehicleBlock: { select: { vehiclePlanId: true } } },
    })
  const blockIds = rows.map(r => r.vehicleBlockId)
  const planIds  = [...new Set(rows.map(r => r.vehicleBlock.vehiclePlanId).filter(Boolean) as string[])]

  // Intervals live attached to the trip that precedes them (positional, no FK —
  // see block-interval.utils.ts). Removing that trip removes the interval too.
  // Deadruns are anchored the same way, no FK either (block-deadrun.utils.ts) —
  // ACCESS/RETURN to the block's first/last trip, DISPLACEMENT to the nearest
  // preceding trip.
  const anchoredIntervalIds = (
    await Promise.all(blockIds.map(vehicleBlockId => findIntervalIdsAnchoredToTrips(db, vehicleBlockId, [id])))
  ).flat()
  const anchoredDeadrunIds = (
    await Promise.all(blockIds.map(vehicleBlockId => findDeadrunIdsAnchoredToTrips(db, vehicleBlockId, [id])))
  ).flat()

  await db.transitTrip.delete({ where: { id } })  // cascades BlockTrip

  // Removing a departure this line was covering is itself a possible divergence
  // from an approved OSO — recompute now that the trip is actually gone.
  if (existing && planIds.length > 0) {
    for (const planId of planIds) await recomputeLineDrift(db, planId, existing.route.lineId)
  }

  if (anchoredIntervalIds.length > 0) {
    await db.blockInterval.deleteMany({ where: { id: { in: anchoredIntervalIds } } })
  }
  if (anchoredDeadrunIds.length > 0) {
    await db.blockDeadrun.deleteMany({ where: { id: { in: anchoredDeadrunIds } } })
  }

  if (blockIds.length > 0) {
    // Delete every block that is now completely empty (no trips left)
    await db.vehicleBlock.deleteMany({ where: { id: { in: blockIds }, blockTrips: { none: {} } } })
    // Mark remaining (non-empty) blocks as stale so recalculate() updates their summaries
    await db.vehicleBlock.updateMany({ where: { id: { in: blockIds } }, data: { isStale: true } })
  }

  return { affectedPlanIds: planIds }
}
