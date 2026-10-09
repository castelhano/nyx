import { validateBlock, type VehicleBlockIssue } from '@nyx/schemas'
import type { TransitGeneralConfigService } from '../../settings/transit-general-config.service'

// VehicleBlock.issues (packages/schemas/transit/block-validation.ts) — computed by
// VehiclePlanService.recalculate for the whole plan, and here for one block when a PATCH
// changes something they depend on (depot, empresa) without going through recalculate.

// LONG_STAND threshold: the default IntervalType's max — the same one Finalizar Plano/import use
// to turn gaps into intervals; longer gaps are left for review
export async function defaultIntervalMaxMinutes(db: any, generalConfig: TransitGeneralConfigService): Promise<number | null> {
  const { defaultIntervalTypeId } = await generalConfig.get()
  if (!defaultIntervalTypeId) return null
  const type = await db.intervalType.findUnique({ where: { id: defaultIntervalTypeId }, select: { maxMinutes: true } })
  return type?.maxMinutes ?? null
}

// members per group (trips, deadruns, intervals sharing a bundleId) in the plan — BUNDLE_BROKEN
// needs the whole group
export async function planBundleSizes(db: any, planId: string): Promise<Map<string, number>> {
  type Row = { bundleId: string | null; _count: { _all: number } }
  const grouped = { by: ['bundleId'], _count: { _all: true } }
  const [trips, deadruns, intervals]: Row[][] = await Promise.all([
    db.transitTrip.groupBy({ ...grouped, where: { vehiclePlanId: planId, bundleId: { not: null } } }),
    db.blockDeadrun.groupBy({ ...grouped, where: { vehicleBlock: { vehiclePlanId: planId }, bundleId: { not: null } } }),
    db.blockInterval.groupBy({ ...grouped, where: { vehicleBlock: { vehiclePlanId: planId }, bundleId: { not: null } } }),
  ])
  const sizes = new Map<string, number>()
  for (const r of [...trips, ...deadruns, ...intervals]) sizes.set(r.bundleId!, (sizes.get(r.bundleId!) ?? 0) + r._count._all)
  return sizes
}

export interface IssueBlockRow {
  depotId:        string
  branchId:       string | null
  blockTrips:     { trip: { departureMinutes: number; arrivalMinutes: number; bundleId?: string | null; route: { originLocalityId: string; destinationLocalityId: string } } }[]
  blockDeadruns:  { type: string; departureMinutes: number; arrivalMinutes: number; originLocalityId: string; destinationLocalityId: string; bundleId?: string | null }[]
  blockIntervals: { departureMinutes: number; arrivalMinutes: number; bundleId?: string | null }[]
}

export function blockIssues(block: IssueBlockRow, maxStandMinutes: number | null, bundleSizes?: Map<string, number>): VehicleBlockIssue[] {
  return validateBlock({
    depotId:  block.depotId,
    branchId: block.branchId,
    trips:   block.blockTrips.map(({ trip }) => ({
      departureMinutes: trip.departureMinutes, arrivalMinutes: trip.arrivalMinutes,
      originLocalityId: trip.route.originLocalityId, destinationLocalityId: trip.route.destinationLocalityId,
      bundleId: trip.bundleId,
    })),
    deadruns:  block.blockDeadruns,
    intervals: block.blockIntervals,
    maxStandMinutes,
    bundleSizes,
  })
}

export async function refreshBlockIssues(db: any, blockId: string, generalConfig: TransitGeneralConfigService): Promise<void> {
  const [block, maxStand] = await Promise.all([
    db.vehicleBlock.findUnique({
      where:  { id: blockId },
      select: {
        vehiclePlanId:  true,
        depotId:        true,
        branchId:       true,
        blockTrips:     { select: { trip: { select: { departureMinutes: true, arrivalMinutes: true, bundleId: true, route: { select: { originLocalityId: true, destinationLocalityId: true } } } } } },
        blockDeadruns:  { select: { type: true, departureMinutes: true, arrivalMinutes: true, originLocalityId: true, destinationLocalityId: true, bundleId: true } },
        blockIntervals: { select: { departureMinutes: true, arrivalMinutes: true, bundleId: true } },
      },
    }),
    defaultIntervalMaxMinutes(db, generalConfig),
  ])
  if (!block) return
  const issues = blockIssues(block, maxStand, await planBundleSizes(db, block.vehiclePlanId))
  await db.vehicleBlock.update({ where: { id: blockId }, data: { issues, hasIssues: issues.length > 0 } })
}
