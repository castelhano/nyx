import { findIntervalIdsAnchoredToTrips } from '../vehicle-plan/block-interval.utils'

// Core trip-mutation side effects (isStale marking, LineSchedule drift flagging,
// anchored-interval/empty-block cleanup on delete) shared between TripService (the
// standalone generic-resource path) and VehiclePlanService.applyDiff (the Gantt batch
// path). Plain functions taking a db/tx client so applyDiff can run them inside its
// own transaction without depending on TripService (which itself depends on
// VehiclePlanService — importing it here would cycle). See docs/proposal/
// vehicle-plan-summary-score-consolidation.md §2.4.

// Marks isDrifted on every VehiclePlanLine (across whatever plans currently use this
// trip's blocks) for the given line — signals that formalizing a new LineSchedule
// version may be warranted.
async function flagDrift(db: any, tripId: string, lineId: string): Promise<void> {
  const rows = await db.blockTrip.findMany({
    where:  { tripId },
    select: { vehicleBlock: { select: { vehiclePlanId: true } } },
  })
  const planIds = [...new Set(rows.map((r: any) => r.vehicleBlock.vehiclePlanId).filter(Boolean))] as string[]
  if (planIds.length === 0) return

  await db.vehiclePlanLine.updateMany({
    where: { vehiclePlanId: { in: planIds }, lineId },
    data:  { isDrifted: true },
  })
}

// Two-step so the caller's own update() write (sanitizeDto'd generic update, or a
// narrow direct Prisma update from applyDiff) sits between them — the side effects
// depend on both the pre-update lineDepartureId and the post-update result.
export async function beforeTripUpdate(db: any, id: string): Promise<{ lineDepartureId: string | null; route: { lineId: string } } | null> {
  return db.transitTrip.findUnique({
    where:  { id },
    select: { lineDepartureId: true, route: { select: { lineId: true } } },
  })
}

export async function afterTripUpdate(
  db: any, id: string,
  existing: { lineDepartureId: string | null; route: { lineId: string } } | null,
  patch:    { departureMinutes?: number; arrivalMinutes?: number },
  result:   { departureMinutes: number },
): Promise<void> {
  const timeFieldsChanged = patch.departureMinutes !== undefined || patch.arrivalMinutes !== undefined
  if (timeFieldsChanged) {
    await db.vehicleBlock.updateMany({
      where: { blockTrips: { some: { tripId: id } } },
      data:  { isStale: true },
    })
  }

  // Only the departure minute is part of what the órgão gestor approves (LineDeparture
  // has no arrival) — so drift is judged against departureMinutes only.
  if (patch.departureMinutes !== undefined && existing?.lineDepartureId) {
    const departure = await db.lineDeparture.findUnique({
      where:  { id: existing.lineDepartureId },
      select: { departureMinutes: true },
    })
    if (departure && result.departureMinutes !== departure.departureMinutes) {
      await flagDrift(db, id, existing.route.lineId)
    }
  }
}

export async function applyTripRemoval(db: any, id: string): Promise<{ affectedPlanIds: string[] }> {
  const existing = await db.transitTrip.findUnique({
    where:  { id },
    select: { lineDepartureId: true, route: { select: { lineId: true } } },
  })

  const rows: { vehicleBlockId: string; vehicleBlock: { vehiclePlanId: string | null } }[] =
    await db.blockTrip.findMany({
      where:  { tripId: id },
      select: { vehicleBlockId: true, vehicleBlock: { select: { vehiclePlanId: true } } },
    })
  const blockIds = rows.map(r => r.vehicleBlockId)
  const planIds  = [...new Set(rows.map(r => r.vehicleBlock.vehiclePlanId).filter(Boolean) as string[])]

  // Removing a departure that was tracked against an approved LineDeparture is a
  // divergence too — the OS specified a trip that no longer exists in this plan.
  if (existing?.lineDepartureId && planIds.length > 0) {
    await db.vehiclePlanLine.updateMany({
      where: { vehiclePlanId: { in: planIds }, lineId: existing.route.lineId },
      data:  { isDrifted: true },
    })
  }

  // Intervals live attached to the trip that precedes them (positional, no FK —
  // see block-interval.utils.ts). Removing that trip removes the interval too.
  const anchoredIntervalIds = (
    await Promise.all(blockIds.map(vehicleBlockId => findIntervalIdsAnchoredToTrips(db, vehicleBlockId, [id])))
  ).flat()

  await db.transitTrip.delete({ where: { id } })  // cascades BlockTrip

  if (anchoredIntervalIds.length > 0) {
    await db.blockInterval.deleteMany({ where: { id: { in: anchoredIntervalIds } } })
  }

  if (blockIds.length > 0) {
    // Delete every block that is now completely empty (no trips left)
    await db.vehicleBlock.deleteMany({ where: { id: { in: blockIds }, blockTrips: { none: {} } } })
    // Mark remaining (non-empty) blocks as stale so recalculate() updates their summaries
    await db.vehicleBlock.updateMany({ where: { id: { in: blockIds } }, data: { isStale: true } })
  }

  return { affectedPlanIds: planIds }
}
