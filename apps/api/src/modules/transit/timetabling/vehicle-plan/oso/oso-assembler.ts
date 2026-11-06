import { PrismaService } from '../../../../../prisma/prisma.service'
import { findDeadrunIdsAnchoredToTrips } from '../block-deadrun.utils'
import { findIntervalIdsAnchoredToTrips } from '../block-interval.utils'
import { assignOrdinals, mergeContinuations } from './oso-carro-roles'
import type { TripMarking } from '@nyx/schemas'

// Fixed constant, never persisted — regra 6 of docs/proposal/plan_trip_markings_v1.md.
// Styles the DISPLACEMENT's own reserved slot in the grid (oso-workbook.renderer.ts) and
// feeds the OBSERVAÇÃO legend (oso-observations.ts) whenever one is anchored in the recorte.
export const DISPLACEMENT_MARKING: TripMarking = {
  legendText: 'Retorna reservado no contrafluxo',
  fontStyle:  'ITALIC',
  bgColor:    'CINZA',
}

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
  // the side of the sheet it prints on — the trip's own direction, unless it's a variant
  // running the base line's way under the opposite label (A22C's volta leaves from the
  // A22B's ida terminal)
  sheetDirection:   OsoDirection
  departureMinutes: number
  arrivalMinutes:   number
  originLocalityId:      string
  destinationLocalityId: string
  // the variant's code when this isn't the base line — highlighted and named in the legend
  childLineCode?:   string
  // TransitTrip.markings, raw (regra 3/4 of plan_trip_markings_v1.md) — un-collapsed, the
  // renderer resolves per-channel winner for the cell, oso-observations.ts flattens every
  // entry's legendText regardless of which one won a channel
  markings?:        TripMarking[]
}

// ACCESS is still excluded (rule 7, plan_oso_export_v1.md): the grid always starts at a
// block's first productive trip. RETURN and DISPLACEMENT both appear now — DISPLACEMENT
// closes rule 7's supersession in plan_trip_markings_v1.md (regra 8): shown with its real
// departure time, styled by the fixed constant above, instead of being discarded
export interface OsoDeadrunEvent {
  kind:             'deadrun'
  id:                string
  type:             'RETURN' | 'DISPLACEMENT'
  departureMinutes: number
  arrivalMinutes:   number
  // only ever [DISPLACEMENT_MARKING] for type 'DISPLACEMENT' — RETURN carries none (its own
  // cell keeps the plain 'RECO' treatment, unaffected by markings)
  markings?:        TripMarking[]
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
  // the first block, when more than one continues into this carro (oso-carro-roles.ts)
  blockId:       string
  blockNumber:   number
  // position in the header, null on a REFORÇO — which is also out of the fleet
  ordinal:       number | null
  // ScopeOperator.abbr for this block's branch within the plan's scope (fallback:
  // Branch.name) — printed as the "E" row. null when the block has no branch assigned.
  operatorLabel:    string | null
  // Company.legalName (via Branch.companyId) — printed once in the header's "Operadora:"
  // line, distinct from the abbreviated operatorLabel used throughout the grid/RESUMO
  operatorFullName: string | null
  // does the block run another line after / before this family's trips (oso-carro-roles.ts)
  leavesForOtherLine: boolean
  comesFromOtherLine: boolean
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
  // the family member the sheet is built around: the parent, or a variant running on its own
  // (A22C on weekends) — null when nothing runs
  baseLineId:    string | null
  // in the order of each carro's first productive trip (rule 6) — ordinal holds the printed number
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

// tags what isn't the base line and places it on the sheet — a variant whose trip leaves from
// the base line's terminal of the opposite direction prints on that side
async function markVariantTrips(db: any, carros: OsoCarro[], family: OsoLineFamilyMember[], baseLineId: string | null): Promise<void> {
  if (!baseLineId || family.length === 1) return

  const baseRoutes = await db.transitRoute.findMany({
    where:   { lineId: baseLineId, direction: { in: ['OUTBOUND', 'INBOUND'] } },
    orderBy: { isPrimary: 'asc' },
    select:  { direction: true, originLocalityId: true },
  })
  const baseOrigin = new Map<OsoDirection, string>(baseRoutes.map((r: any) => [r.direction, r.originLocalityId]))
  const codeByLine = new Map(family.map(l => [l.id, l.code]))

  for (const e of carros.flatMap(c => c.events)) {
    if (e.kind !== 'trip' || e.lineId === baseLineId) continue
    e.childLineCode = codeByLine.get(e.lineId)
    const opposite: OsoDirection = e.direction === 'OUTBOUND' ? 'INBOUND' : 'OUTBOUND'
    if (e.direction !== 'CIRCULAR' && baseOrigin.get(e.direction) !== e.originLocalityId && baseOrigin.get(opposite) === e.originLocalityId) {
      e.sheetDirection = opposite
    }
  }
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
              markings:         true,
              route:            { select: { id: true, lineId: true, direction: true, originLocalityId: true, destinationLocalityId: true } },
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
      ? db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true, company: { select: { legalName: true } } } })
      : Promise.resolve([]),
  ])
  const abbrByBranch     = new Map<string, string>(scopeOperators.map((o: any) => [o.branchId, o.abbr]))
  const nameByBranch     = new Map<string, string>(branches.map((b: any) => [b.id, b.name]))
  const legalNameByBranch = new Map<string, string>(branches.map((b: any) => [b.id, b.company.legalName]))

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
        sheetDirection:   bt.trip.route.direction,
        departureMinutes: bt.trip.departureMinutes,
        arrivalMinutes:   bt.trip.arrivalMinutes,
        originLocalityId:      bt.trip.route.originLocalityId,
        destinationLocalityId: bt.trip.route.destinationLocalityId,
        markings:         bt.trip.markings ?? undefined,
      })
    }

    const chronological = [...(block.blockTrips as any[])].sort((a, b) => a.trip.departureMinutes - b.trip.departureMinutes)

    // the block's own true last trip of this family, chronologically — once it arrives, this
    // family is recolhida in this block (real or synthetic RETURN below marks that same point).
    // A DISPLACEMENT anchored at/after that arrival isn't repositioning within this family's
    // service anymore, it's the block heading off into another line entirely, so it's not part
    // of this OSO — only a DISPLACEMENT that still has a family trip ahead of it belongs here.
    const lastFamilyBlockTripForAnchor = chronological.filter(bt => familyLineIds.has(bt.trip.route.lineId)).at(-1)
    const familyClosesAt = lastFamilyBlockTripForAnchor?.trip.arrivalMinutes as number | undefined

    // a RECO belongs to this sheet only right after one of its trips — not the positional anchor
    // of findDeadrunIdsAnchoredToTrips, which ties every RETURN to the block's last trip
    const returnsFromFamilyTrip = (dr: any) => {
      const previous = chronological.filter(bt => bt.trip.arrivalMinutes <= dr.departureMinutes).at(-1)
      return previous !== undefined && familyLineIds.has(previous.trip.route.lineId)
    }

    for (const dr of block.blockDeadruns as any[]) {
      if (dr.type !== 'RETURN' && dr.type !== 'DISPLACEMENT') continue
      if (dr.type === 'RETURN' ? !returnsFromFamilyTrip(dr) : !anchoredDeadrunIdSet.has(dr.id)) continue
      if (dr.type === 'DISPLACEMENT' && familyClosesAt !== undefined && dr.departureMinutes >= familyClosesAt) continue
      events.push({
        kind:             'deadrun',
        id:                dr.id,
        type:             dr.type,
        departureMinutes: dr.departureMinutes,
        arrivalMinutes:   dr.arrivalMinutes,
        markings:         dr.type === 'DISPLACEMENT' ? [DISPLACEMENT_MARKING] : undefined,
      })
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

    // a family trip that isn't the block's own true last trip never gets a real RETURN
    // anchored to it (findDeadrunIdsAnchoredToTrips anchors RETURN only to the block's actual
    // last trip, regardless of line) — the block simply keeps running other lines afterward.
    // From this line's own OSO there's no more of it left in the block, so that's exactly
    // "recolhida" as far as this sheet is concerned: a synthetic RETURN closes the family's
    // event stream here instead of leaving its last trip open-ended with no volta/RECO at all.
    const lastBlockTripId    = chronological.at(-1)?.trip.id as string | undefined
    const lastFamilyBlockTrip = lastFamilyBlockTripForAnchor
    const alreadyClosed = events.some(e => e.kind !== 'trip' && e.departureMinutes >= (familyClosesAt ?? Infinity))
    if (lastFamilyBlockTrip && lastFamilyBlockTrip.trip.id !== lastBlockTripId && !alreadyClosed) {
      events.push({
        kind:             'deadrun',
        id:                `synthetic-reco-${block.id}-${lastFamilyBlockTrip.trip.id}`,
        type:             'RETURN',
        departureMinutes: lastFamilyBlockTrip.trip.arrivalMinutes,
        arrivalMinutes:   lastFamilyBlockTrip.trip.arrivalMinutes,
      })
    }

    events.sort((a, b) => a.departureMinutes - b.departureMinutes)
    // productive -> RECO -> interval shows the RECO alone: the carro is already in the garage
    const shownEvents = events.filter((e, i) => !(e.kind === 'interval' && events[i - 1]?.kind === 'deadrun' && (events[i - 1] as OsoDeadrunEvent).type === 'RETURN'))

    const familyTrips = chronological.filter(bt => familyLineIds.has(bt.trip.route.lineId))
    const otherTrips  = chronological.filter(bt => !familyLineIds.has(bt.trip.route.lineId))

    const branchId = block.branchId as string | null
    carros.push({
      blockId:       block.id,
      blockNumber:   block.blockNumber,
      ordinal:       null,
      operatorLabel:    branchId ? (abbrByBranch.get(branchId) ?? nameByBranch.get(branchId) ?? null) : null,
      operatorFullName: branchId ? (legalNameByBranch.get(branchId) ?? null) : null,
      leavesForOtherLine: otherTrips.some(bt => bt.trip.departureMinutes >= (familyClosesAt ?? Infinity)),
      comesFromOtherLine: otherTrips.some(bt => bt.trip.arrivalMinutes <= familyTrips[0].trip.departureMinutes),
      events: shownEvents,
    })
  }

  // rule 6 — numbered by first productive trip, not by blockNumber
  carros.sort((a, b) => {
    const aFirst = a.events.find(e => e.kind === 'trip')?.departureMinutes ?? Infinity
    const bFirst = b.events.find(e => e.kind === 'trip')?.departureMinutes ?? Infinity
    return aFirst - bFirst
  })

  const lineIdsRunning = new Set(carros.flatMap(c => c.events).flatMap(e => (e.kind === 'trip' ? [e.lineId] : [])))
  const baseLineId = family.find(l => lineIdsRunning.has(l.id))?.id ?? null
  await markVariantTrips(db, carros, family, baseLineId)

  return { vehiclePlanId, scopeId: plan.scopeId, family, baseLineId, carros: assignOrdinals(mergeContinuations(carros)) }
}
