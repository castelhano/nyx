import { validateBlock, type BlockValidationInput, type VehicleBlockIssue } from '@nyx/schemas'
import type { TransitGeneralConfigService } from '../../settings/transit-general-config.service'

// VehicleBlock.issues (packages/schemas/transit/block-validation.ts) — computed by
// VehiclePlanService.recalculate for the whole plan.

// LONG_STAND threshold: the default IntervalType's max — the same one Finalizar Plano/import use
// to turn gaps into intervals; longer gaps are left for review
export async function defaultIntervalMaxMinutes(db: any, generalConfig: TransitGeneralConfigService): Promise<number | null> {
  const { defaultIntervalTypeId } = await generalConfig.get()
  if (!defaultIntervalTypeId) return null
  const type = await db.intervalType.findUnique({ where: { id: defaultIntervalTypeId }, select: { maxMinutes: true } })
  return type?.maxMinutes ?? null
}

// STAND_NOT_ALLOWED: a stop of the default IntervalType's min or more (120 without one — the vehicle
// solver's default) only where a route lets the vehicle stand (RouteLocality.allowsVehicleStand)
export async function vehicleStandRule(db: any, generalConfig: TransitGeneralConfigService): Promise<NonNullable<BlockValidationInput['stand']>> {
  const { defaultIntervalTypeId } = await generalConfig.get()
  const [type, points] = await Promise.all([
    defaultIntervalTypeId ? db.intervalType.findUnique({ where: { id: defaultIntervalTypeId }, select: { minMinutes: true } }) : null,
    db.routeLocality.findMany({ where: { allowsVehicleStand: true, localityId: { not: null } }, select: { routeId: true, localityId: true } }),
  ])
  const allowed = new Set((points as { routeId: string; localityId: string }[]).map(p => `${p.routeId}:${p.localityId}`))
  return { minMinutes: type?.minMinutes ?? 120, allowed: (routeId, localityId) => allowed.has(`${routeId}:${localityId}`) }
}

// DEADRUN_TOO_SHORT: the matrix's minutes rounded as block-mutation.utils builds the deadruns
export function travelMinutesOf(matrix: { originId: string; destinationId: string; baseMinutes: number; speedRatio: number }[]): BlockValidationInput['travelMinutes'] {
  const minutes = new Map(matrix.map(m => [`${m.originId}:${m.destinationId}`, Math.round(m.baseMinutes * m.speedRatio)]))
  return (from, to) => minutes.get(`${from}:${to}`)
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

// lineId → branchIds operating it (LineOperator) for the plan's lines — LINE_NOT_OPERATED
export async function planLineOperators(db: any, planId: string): Promise<Map<string, string[]>> {
  const rows: { lineId: string; branchId: string }[] = await db.lineOperator.findMany({
    where:  { line: { planLines: { some: { vehiclePlanId: planId } } } },
    select: { lineId: true, branchId: true },
  })
  const map = new Map<string, string[]>()
  for (const r of rows) map.set(r.lineId, [...(map.get(r.lineId) ?? []), r.branchId])
  return map
}

export interface IssueBlockRow {
  depotId:        string
  branchId:       string | null
  blockTrips:     { trip: { departureMinutes: number; arrivalMinutes: number; bundleId?: string | null; routeId?: string; route: { lineId?: string; originLocalityId: string; destinationLocalityId: string } } }[]
  blockDeadruns:  { type: string; departureMinutes: number; arrivalMinutes: number; originLocalityId: string; destinationLocalityId: string; bundleId?: string | null }[]
  blockIntervals: { departureMinutes: number; arrivalMinutes: number; bundleId?: string | null }[]
}

// the optional checks: absent ones are skipped
export type BlockIssueRules = Pick<BlockValidationInput, 'bundleSizes' | 'lineOperators' | 'travelMinutes' | 'stand'>

export function blockIssues(block: IssueBlockRow, maxStandMinutes: number | null, rules: BlockIssueRules = {}): VehicleBlockIssue[] {
  return validateBlock({
    depotId:  block.depotId,
    branchId: block.branchId,
    trips:   block.blockTrips.map(({ trip }) => ({
      departureMinutes: trip.departureMinutes, arrivalMinutes: trip.arrivalMinutes,
      originLocalityId: trip.route.originLocalityId, destinationLocalityId: trip.route.destinationLocalityId,
      bundleId: trip.bundleId, lineId: trip.route.lineId, routeId: trip.routeId,
    })),
    deadruns:  block.blockDeadruns,
    intervals: block.blockIntervals,
    maxStandMinutes,
    ...rules,
  })
}
