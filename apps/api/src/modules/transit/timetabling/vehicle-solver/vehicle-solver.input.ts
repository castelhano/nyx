import { BadRequestException, NotFoundException } from '@nestjs/common'
import { depotConfigSchema, lineVehicleTypesSchema, type PlanningSettings, type VehicleTypeValue } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import type { TransitGeneralConfigService } from '../../settings/transit-general-config.service'
import { buildAggregateFromPersisted } from '../vehicle-plan/scoring/block-aggregate'
import { operatorShares } from '../vehicle-plan/scoring/plan-scoring.calc'
import { DEADRUN_GAP, summarizeBlocks, type LockedBlock, type Rows, type SeedBlock, type SolverDepot, type SolverTrip, type VehicleSolverInput } from './vehicle-solver.calc'
import type { VehicleSolverParams, VehicleSolverSummary } from './vehicle-solver.types'

// a stop this long is an interval (only where the vehicle may stand) when no default interval
// type (or no min on it) is configured
// (or no max on it) is configured
const DEFAULT_STAND_THRESHOLD = 120

// Everything the vehicle solver needs for one plan, in a few queries: its trips (with their
// line's vehicle types and whether the vehicle may stand at their ends), its blocks (locked ones fixed, the rest
// as a possible starting point), the matrix, the depots and the Scope's operators/shares.
// Also the plan as it is, summarized the way a proposal is (`baseline`).
export async function loadVehicleSolverInput(
  prisma:        PrismaService,
  generalConfig: TransitGeneralConfigService,
  planId:        string,
  // the plan's settings (reported) and the ones the search optimizes (reweighted by direction)
  reportSettings: PlanningSettings,
  settings:       PlanningSettings,
  params:         VehicleSolverParams,
): Promise<{ input: VehicleSolverInput; baseline: VehicleSolverSummary }> {
  const plan = await prisma.vehiclePlan.findUnique({
    where:  { id: planId },
    select: { scope: { select: { operators: { select: { branchId: true, share: true } } } } },
  })
  if (!plan) throw new NotFoundException('VehiclePlan not found')

  const general = await generalConfig.get()
  const lineSelect = { select: { code: true, metrics: true, vehicleTypes: true } } as const
  const [tripRows, blockRows, matrixRows, depotRows, standRows, intervalType] = await Promise.all([
    prisma.transitTrip.findMany({
      where:  { vehiclePlanId: planId },
      select: {
        id: true, departureMinutes: true, arrivalMinutes: true, requiredVehicleType: true,
        routeId: true, bundleId: true,
        route: { select: { lineId: true, originLocalityId: true, destinationLocalityId: true, direction: true, line: lineSelect } },
      },
    }),
    prisma.vehicleBlock.findMany({
      where:  { vehiclePlanId: planId },
      select: {
        depotId: true, branchId: true, vehicleType: true, constraints: true, hasIssues: true,
        blockTrips: {
          orderBy: { sequence: 'asc' },
          select: {
            tripId: true,
            trip: {
              select: {
                departureMinutes: true, arrivalMinutes: true,
                route: { select: { lineId: true, originLocalityId: true, destinationLocalityId: true, direction: true, line: lineSelect } },
              },
            },
          },
        },
        blockDeadruns:  { select: { type: true, originLocalityId: true, destinationLocalityId: true, departureMinutes: true, arrivalMinutes: true } },
        blockIntervals: { select: { intervalTypeId: true, departureMinutes: true, arrivalMinutes: true } },
      },
    }),
    prisma.travelTimeMatrix.findMany({ select: { originId: true, destinationId: true, baseMinutes: true, speedRatio: true, distanceKm: true } }),
    prisma.transitLocality.findMany({ where: { isDepot: true }, select: { id: true, depot: true } }),
    prisma.routeLocality.findMany({ where: { allowsVehicleStand: true, localityId: { not: null } }, select: { routeId: true, localityId: true } }),
    general.defaultIntervalTypeId
      ? prisma.intervalType.findUnique({ where: { id: general.defaultIntervalTypeId }, select: { minMinutes: true, maxMinutes: true } })
      : Promise.resolve(null),
  ])
  if (!tripRows.length) throw new BadRequestException('O planejamento não tem viagens')

  const matrix: VehicleSolverInput['matrix'] = {}
  const matrixKm: Record<string, number> = {}
  for (const m of matrixRows) {
    const key = `${m.originId}:${m.destinationId}`
    matrix[key]   = { minutes: Math.ceil(m.baseMinutes * m.speedRatio), km: m.distanceKm }
    matrixKm[key] = m.distanceKm
  }

  const depots: SolverDepot[] = depotRows.map(d => {
    const cfg = depotConfigSchema.safeParse(d.depot ?? {})
    return { id: d.id, operators: cfg.success ? cfg.data.operators : [], capacity: cfg.success ? cfg.data.capacity : [] }
  })

  const withTrips = blockRows.filter(b => b.blockTrips.length > 0)
  const aggregateOf = (b: (typeof blockRows)[number]) => buildAggregateFromPersisted({
    vehicleType: b.vehicleType, branchId: b.branchId,
    blockTrips: b.blockTrips, blockDeadruns: b.blockDeadruns, blockIntervals: b.blockIntervals,
  }, matrixKm)
  const isLocked = (b: (typeof blockRows)[number]) => params.base === 'complete' && !!(b.constraints as { locked?: boolean } | null)?.locked

  const locked: LockedBlock[] = withTrips.filter(isLocked).map(b => ({
    depotId: b.depotId, branchId: b.branchId, vehicleType: b.vehicleType, hasIssues: b.hasIssues, aggregate: aggregateOf(b),
  }))
  const lockedTripIds = new Set(withTrips.filter(isLocked).flatMap(b => b.blockTrips.map(bt => bt.tripId)))
  const seed: SeedBlock[] = withTrips.filter(b => !isLocked(b)).map(b => ({
    depotId: b.depotId, branchId: b.branchId, vehicleType: b.vehicleType, tripIds: b.blockTrips.map(bt => bt.tripId),
  }))

  const standPoints = new Set(standRows.map(r => `${r.routeId}:${r.localityId}`))
  const free: SolverTrip[] = tripRows.filter(t => !lockedTripIds.has(t.id)).map(t => {
    const vt = lineVehicleTypesSchema.safeParse(t.route.line.vehicleTypes ?? {})
    const lineTypes = vt.success ? vt.data : { allowed: [], preferred: null }
    return {
      id: t.id, lineId: t.route.lineId, lineCode: t.route.line.code, origin: t.route.originLocalityId, dest: t.route.destinationLocalityId,
      dep: t.departureMinutes, arr: t.arrivalMinutes, direction: t.route.direction, line: t.route.line,
      allowed:   t.requiredVehicleType ? [t.requiredVehicleType] : lineTypes.allowed.length ? lineTypes.allowed : null,
      preferred: lineTypes.preferred,
      standAtOrigin: standPoints.has(`${t.routeId}:${t.route.originLocalityId}`),
      standAtDest:   standPoints.has(`${t.routeId}:${t.route.destinationLocalityId}`),
    }
  })
  const trips = bundleUnits(free, tripRows, withTrips, lockedTripIds, matrix)

  const shares = operatorShares(plan.scope.operators)
  const planTrips = tripRows.map(t => ({ departureMinutes: t.departureMinutes, arrivalMinutes: t.arrivalMinutes }))
  const input: VehicleSolverInput = {
    settings, reportSettings, trips, locked, seed, planTrips, matrix, depots,
    operators: plan.scope.operators.map(o => o.branchId),
    shares,
    interval:        intervalType ? { min: intervalType.minMinutes ?? 0, max: intervalType.maxMinutes ?? Infinity } : null,
    standThreshold:  intervalType?.minMinutes ?? DEFAULT_STAND_THRESHOLD,
    maxStandMinutes: intervalType?.maxMinutes ?? null,
  }

  const baseline = summarizeBlocks(reportSettings, planTrips, shares, withTrips.map(b => ({
    depotId: b.depotId, branchId: b.branchId, vehicleType: b.vehicleType, hasIssues: b.hasIssues, aggregate: aggregateOf(b),
  })))
  return { input, baseline }
}

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// Each trip group (TransitTrip.bundleId) becomes one unit (SolverTrip.bundle). Its inside — the
// deadruns and intervals between its first departure and last arrival — comes from the block that
// holds the whole group, as it is; a group not yet together gets just the displacements its
// trips need. A group of one trip is a plain trip.
function bundleUnits(
  free:      SolverTrip[],
  tripRows:  { id: string; bundleId: string | null; departureMinutes: number }[],
  blocks:    { blockTrips: { tripId: string }[]; blockDeadruns: Rows['deadruns']; blockIntervals: Rows['intervals'] }[],
  locked:    Set<string>,
  matrix:    VehicleSolverInput['matrix'],
): SolverTrip[] {
  const members = new Map<string, string[]>()
  for (const t of tripRows) if (t.bundleId) members.set(t.bundleId, [...(members.get(t.bundleId) ?? []), t.id])
  const byId = new Map(free.map(t => [t.id, t]))
  const grouped = new Set<string>()
  const units: SolverTrip[] = []

  for (const ids of members.values()) {
    if (ids.length < 2) continue
    const trips = ids.map(id => byId.get(id)).filter((t): t is SolverTrip => !!t).sort((a, b) => a.dep - b.dep)
    if (trips.length === 0) continue
    if (trips.length !== ids.length) {
      // part of it in a locked block: only a locked block holding the whole group keeps it whole
      const start = Math.min(...tripRows.filter(t => ids.includes(t.id)).map(t => t.departureMinutes))
      throw new BadRequestException(`Grupo de viagens das ${clock(start)} dividido entre um carro travado e outro — trave ou destrave o grupo inteiro`)
    }
    const last = trips[trips.length - 1]

    let allowed: VehicleTypeValue[] | null = null
    for (const t of trips) if (t.allowed) allowed = allowed ? t.allowed.filter(v => allowed!.includes(v)) : [...t.allowed]
    if (allowed && !allowed.length) throw new BadRequestException(`Grupo de viagens das ${clock(trips[0].dep)}: as viagens não têm um tipo de veículo em comum`)

    const home = blocks.find(b => ids.every(id => b.blockTrips.some(bt => bt.tripId === id)))
    const inside = (r: { departureMinutes: number; arrivalMinutes: number }) => r.departureMinutes >= trips[0].dep && r.arrivalMinutes <= last.arr
    const rows: Rows = home
      ? { deadruns: home.blockDeadruns.filter(inside), intervals: home.blockIntervals.filter(inside) }
      : { deadruns: displacements(trips, matrix), intervals: [] }

    units.push({
      ...trips[0],
      id:        `bundle:${trips[0].id}`,
      dest:      last.dest,
      arr:       last.arr,
      allowed,
      preferred: trips.find(t => t.preferred)?.preferred ?? null,
      standAtDest: last.standAtDest,
      bundle: {
        trips: trips.map(t => ({ id: t.id, lineId: t.lineId, lineCode: t.lineCode, origin: t.origin, dest: t.dest, dep: t.dep, arr: t.arr, direction: t.direction, line: t.line })),
        rows,
      },
    })
    for (const t of trips) grouped.add(t.id)
  }
  return [...free.filter(t => !grouped.has(t.id)), ...units]
}

// right after each trip that ends elsewhere than where the next one starts
function displacements(trips: SolverTrip[], matrix: VehicleSolverInput['matrix']): Rows['deadruns'] {
  const out: Rows['deadruns'] = []
  for (let i = 1; i < trips.length; i++) {
    const prev = trips[i - 1], cur = trips[i]
    const e = prev.dest !== cur.origin ? matrix[`${prev.dest}:${cur.origin}`] : null
    if (!e) continue
    out.push({
      type: 'DISPLACEMENT', originLocalityId: prev.dest, destinationLocalityId: cur.origin,
      departureMinutes: prev.arr + DEADRUN_GAP, arrivalMinutes: Math.min(prev.arr + DEADRUN_GAP + e.minutes, cur.dep - DEADRUN_GAP),
    })
  }
  return out
}
