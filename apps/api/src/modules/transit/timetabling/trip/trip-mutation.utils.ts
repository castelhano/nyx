import { sameMarkings, type TripMarking } from '@nyx/schemas'
import { findIntervalIdsAnchoredToTrips } from '../vehicle-plan/block-interval.utils'
import { findDeadrunIdsAnchoredToTrips } from '../vehicle-plan/block-deadrun.utils'

// Core trip-mutation side effects (isStale marking, LineSchedule drift recomputation,
// anchored-interval/anchored-deadrun/empty-block cleanup on delete) shared between
// TripService (the standalone generic-resource path) and VehiclePlanService.applyDiff
// (the Gantt batch path). Plain functions taking a db/tx client so applyDiff can run
// them inside its own transaction without depending on TripService (which itself
// depends on VehiclePlanService — importing it here would cycle). See docs/proposal/
// vehicle-plan-summary-score-consolidation.md §2.4.

// Recomputes VehiclePlanLine.isDrifted and hasAttributeDrift for one line in one plan
// from scratch. isDrifted: the plan's current trips for this line, by {routeId,
// departureMinutes}, don't exactly match its pinned LineSchedule's departures.
// hasAttributeDrift: some trip matching a departure by that same key differs from it in
// requiredVehicleType, stopPattern or markings. No LineSchedule pinned means nothing to
// diverge from. Value-based (no reliance on any per-trip identity link to the
// LineDeparture it may have originated from) — safe to call redundantly, since it
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
      data:  { isDrifted: false, hasAttributeDrift: false },
    })
    return
  }

  const attrs = { routeId: true, departureMinutes: true, requiredVehicleType: true, stopPattern: true, markings: true }
  const [departures, currentTrips] = await Promise.all([
    db.lineDeparture.findMany({ where: { lineScheduleId: line.lineScheduleId }, select: attrs }),
    db.transitTrip.findMany({
      where:  { vehiclePlanId: planId, dayTypeId: plan.dayTypeId, route: { lineId } },
      select: attrs,
    }),
  ])

  const departureByKey = new Map<string, any>(departures.map((d: any) => [`${d.routeId}:${d.departureMinutes}`, d]))
  const tripKeys       = new Set(currentTrips.map((t: any) => `${t.routeId}:${t.departureMinutes}`))
  const covered = departureByKey.size === tripKeys.size && [...departureByKey.keys()].every(k => tripKeys.has(k))
  const hasAttributeDrift = currentTrips.some((t: any) => {
    const d = departureByKey.get(`${t.routeId}:${t.departureMinutes}`)
    return d != null && !sameTripAttributes(t, d)
  })

  await db.vehiclePlanLine.update({
    where: { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
    data:  { isDrifted: !covered, hasAttributeDrift },
  })
}

// Recomputes drift on every line, in every plan (but `exceptPlanId`, when given), pinned to
// one of `lineScheduleIds` — after those schedules' departures changed underneath them.
// Their trips are left alone (docs/proposal/plan_oso_attribute_sync_v1.md).
export async function recomputeDriftForSchedules(db: any, lineScheduleIds: string[], exceptPlanId?: string): Promise<void> {
  if (lineScheduleIds.length === 0) return
  const pinned = await db.vehiclePlanLine.findMany({
    where:  { lineScheduleId: { in: lineScheduleIds }, ...(exceptPlanId ? { vehiclePlanId: { not: exceptPlanId } } : {}) },
    select: { vehiclePlanId: true, lineId: true },
  })
  for (const p of pinned) await recomputeLineDrift(db, p.vehiclePlanId, p.lineId)
}

// The attributes kept in sync between a TransitTrip and the LineDeparture it matches
// (docs/proposal/plan_oso_attribute_sync_v1.md).
export function sameTripAttributes(
  a: { requiredVehicleType?: string | null; stopPattern?: string | null; markings?: unknown },
  b: { requiredVehicleType?: string | null; stopPattern?: string | null; markings?: unknown },
): boolean {
  return (a.requiredVehicleType ?? null) === (b.requiredVehicleType ?? null)
    && (a.stopPattern ?? 'LOCAL') === (b.stopPattern ?? 'LOCAL')
    && sameMarkings(a.markings as TripMarking[] | null, b.markings as TripMarking[] | null)
}

// Trigger point after a single trip's own update: recomputes drift (see above) for
// the given line, in the one plan that owns `tripId` (TransitTrip.vehiclePlanId).
// The trip's own mutation might not itself change the line's coverage, but
// recomputeLineDrift derives the correct answer regardless.
async function recomputeDriftForTrip(db: any, tripId: string, lineId: string): Promise<void> {
  const trip = await db.transitTrip.findUnique({ where: { id: tripId }, select: { vehiclePlanId: true } })
  if (trip) await recomputeLineDrift(db, trip.vehiclePlanId, lineId)
}

// Two-step so the caller's own update() write (sanitizeDto'd generic update, or a
// narrow direct Prisma update from applyDiff) sits between them.
export function beforeTripUpdate(db: any, id: string): Promise<{ route: { lineId: string } } | null> {
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
    select: { vehiclePlanId: true, route: { select: { lineId: true } } },
  })

  const rows: { vehicleBlockId: string }[] = await db.blockTrip.findMany({
    where:  { tripId: id },
    select: { vehicleBlockId: true },
  })
  const blockIds = rows.map(r => r.vehicleBlockId)
  const planIds  = existing ? [existing.vehiclePlanId] : []

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
