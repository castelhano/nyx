import { PrismaService } from '../../../../../prisma/prisma.service'
import { findDeadrunIdsAnchoredToTrips } from '../block-deadrun.utils'
import { findIntervalIdsAnchoredToTrips } from '../block-interval.utils'

// Layer 1 of the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) — turns a
// VehiclePlan + a line into the raw "carros × eventos" view model the rest of the
// pipeline (layout resolver, banding, summary, renderer) builds on. Pure data shaping:
// no layout/shape decisions happen here.

export type OsoDirection = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'

export interface OsoTripEvent {
  kind:             'trip'
  tripId:           string
  routeId:          string
  lineId:           string
  direction:        OsoDirection
  departureMinutes: number
  arrivalMinutes:   number
}

// only DeadrunType.RETURN ever appears — ACCESS/DISPLACEMENT are excluded (rule 7,
// plan_oso_export_v1.md): the grid always starts at a block's first productive trip
export interface OsoDeadrunEvent {
  kind:             'deadrun'
  id:                string
  departureMinutes: number
  arrivalMinutes:   number
}

export interface OsoIntervalEvent {
  kind:             'interval'
  id:                string
  intervalTypeId:   string
  departureMinutes: number
  arrivalMinutes:   number
}

export type OsoEvent = OsoTripEvent | OsoDeadrunEvent | OsoIntervalEvent

export interface OsoCarro {
  blockId:       string
  blockNumber:   number
  // ScopeOperator.abbr for this block's branch within the plan's scope (fallback:
  // Branch.name) — printed as the "E" row. null when the block has no branch assigned.
  operatorLabel: string | null
  // chronological, filtered to events belonging to the line family (rule 6/8) — a
  // RETURN deadrun or interval only appears here when it's anchored (see
  // block-deadrun.utils.ts / block-interval.utils.ts) to one of this family's trips
  events:        OsoEvent[]
}

export interface OsoLineFamilyMember {
  id:   string
  code: string
}

export interface OsoAssembled {
  vehiclePlanId: string
  scopeId:       string
  // the requested line's family: its parent (or itself, if it has none) + all siblings
  // sharing that parent (TransitLine.parentLineId) — see "What already exists" in the plan doc
  family:        OsoLineFamilyMember[]
  // numbered by the order of each carro's first productive trip (rule 6) — index 0 is "1º"
  carros:        OsoCarro[]
}

export async function resolveLineFamily(prisma: PrismaService, lineId: string): Promise<OsoLineFamilyMember[]> {
  const db = prisma as any

  const line = await db.transitLine.findUniqueOrThrow({
    where:  { id: lineId },
    select: { id: true, code: true, parentLineId: true },
  })
  const rootId = line.parentLineId ?? line.id

  const [root, children] = await Promise.all([
    rootId === line.id
      ? Promise.resolve({ id: line.id, code: line.code })
      : db.transitLine.findUniqueOrThrow({ where: { id: rootId }, select: { id: true, code: true } }),
    db.transitLine.findMany({ where: { parentLineId: rootId }, select: { id: true, code: true } }),
  ])

  return [root, ...children.filter((c: OsoLineFamilyMember) => c.id !== root.id)]
}

export async function assembleOso(
  prisma:        PrismaService,
  vehiclePlanId: string,
  lineId:        string,
): Promise<OsoAssembled> {
  const db = prisma as any

  const [plan, family] = await Promise.all([
    db.vehiclePlan.findUniqueOrThrow({ where: { id: vehiclePlanId }, select: { scopeId: true } }),
    resolveLineFamily(prisma, lineId),
  ])
  const familyLineIds = new Set(family.map(l => l.id))

  const blocks = await db.vehicleBlock.findMany({
    where: {
      vehiclePlanId,
      blockTrips: { some: { trip: { route: { lineId: { in: [...familyLineIds] } } } } },
    },
    include: {
      blockTrips: {
        orderBy: { sequence: 'asc' },
        include: {
          trip: {
            select: {
              id:               true,
              departureMinutes: true,
              arrivalMinutes:   true,
              route:            { select: { id: true, lineId: true, direction: true } },
            },
          },
        },
      },
      blockDeadruns:  { select: { id: true, type: true, departureMinutes: true, arrivalMinutes: true } },
      blockIntervals: { select: { id: true, intervalTypeId: true, departureMinutes: true, arrivalMinutes: true } },
    },
  })

  const branchIds = [...new Set(blocks.map((b: any) => b.branchId).filter(Boolean))] as string[]
  const [scopeOperators, branches] = await Promise.all([
    branchIds.length > 0
      ? db.scopeOperator.findMany({
          where:  { scopeId: plan.scopeId, branchId: { in: branchIds } },
          select: { branchId: true, abbr: true },
        })
      : Promise.resolve([]),
    branchIds.length > 0
      ? db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ])
  const abbrByBranch = new Map<string, string>(scopeOperators.map((o: any) => [o.branchId, o.abbr]))
  const nameByBranch  = new Map<string, string>(branches.map((b: any) => [b.id, b.name]))

  const carros: OsoCarro[] = []

  for (const block of blocks) {
    const familyTripIds = (block.blockTrips as any[])
      .filter(bt => familyLineIds.has(bt.trip.route.lineId))
      .map(bt => bt.trip.id as string)

    if (familyTripIds.length === 0) continue

    const [anchoredDeadrunIds, anchoredIntervalIds] = await Promise.all([
      findDeadrunIdsAnchoredToTrips(prisma, block.id, familyTripIds),
      findIntervalIdsAnchoredToTrips(prisma, block.id, familyTripIds),
    ])
    const anchoredDeadrunIdSet  = new Set(anchoredDeadrunIds)
    const anchoredIntervalIdSet = new Set(anchoredIntervalIds)

    const events: OsoEvent[] = []

    for (const bt of block.blockTrips as any[]) {
      if (!familyLineIds.has(bt.trip.route.lineId)) continue
      events.push({
        kind:             'trip',
        tripId:           bt.trip.id,
        routeId:          bt.trip.route.id,
        lineId:           bt.trip.route.lineId,
        direction:        bt.trip.route.direction,
        departureMinutes: bt.trip.departureMinutes,
        arrivalMinutes:   bt.trip.arrivalMinutes,
      })
    }

    for (const dr of block.blockDeadruns as any[]) {
      if (dr.type !== 'RETURN' || !anchoredDeadrunIdSet.has(dr.id)) continue
      events.push({ kind: 'deadrun', id: dr.id, departureMinutes: dr.departureMinutes, arrivalMinutes: dr.arrivalMinutes })
    }

    for (const bi of block.blockIntervals as any[]) {
      if (!anchoredIntervalIdSet.has(bi.id)) continue
      events.push({
        kind:             'interval',
        id:                bi.id,
        intervalTypeId:   bi.intervalTypeId,
        departureMinutes: bi.departureMinutes,
        arrivalMinutes:   bi.arrivalMinutes,
      })
    }

    events.sort((a, b) => a.departureMinutes - b.departureMinutes)

    const branchId = block.branchId as string | null
    carros.push({
      blockId:       block.id,
      blockNumber:   block.blockNumber,
      operatorLabel: branchId ? (abbrByBranch.get(branchId) ?? nameByBranch.get(branchId) ?? null) : null,
      events,
    })
  }

  // rule 6 — numbered by first productive trip, not by blockNumber
  carros.sort((a, b) => {
    const aFirst = a.events.find(e => e.kind === 'trip')?.departureMinutes ?? Infinity
    const bFirst = b.events.find(e => e.kind === 'trip')?.departureMinutes ?? Infinity
    return aFirst - bFirst
  })

  return { vehiclePlanId, scopeId: plan.scopeId, family, carros }
}
