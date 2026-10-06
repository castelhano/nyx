import {
  CREW_ROLE_LABEL, DUTY_ISSUE_LABEL, DUTY_KIND_LABEL, DUTY_PIECE_STALE_LABEL, ROUTE_DIRECTION_LABEL, VEHICLE_BLOCK_ISSUE_LABEL, VEHICLE_TYPE_LABELS,
  formatDutyNumber, type DutyIssue, type DutyPieceStaleReason, type DutySummary, type VehicleBlockIssue,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import type { BlockEvent, CsvBlock, CsvDuty } from './plan-csv.layouts'

// Loads a vehicle plan (and optionally one of its crew plans) for the CSV layouts, with
// localities, lines and labels resolved to names and km taken from the travel-time matrix
// (same source as VehiclePlanService.recalculate).

export interface PlanCsvData {
  // scope-dayType-description, for the file name
  name:   string
  blocks: CsvBlock[]
  duties: CsvDuty[]
}

export async function loadPlanCsv(prisma: PrismaService, vehiclePlanId: string, crewPlanId: string | null): Promise<PlanCsvData> {
  const plan = await prisma.vehiclePlan.findUniqueOrThrow({
    where:  { id: vehiclePlanId },
    select: { scopeId: true, description: true, scope: { select: { name: true } }, dayType: { select: { name: true } } },
  })

  const [blockRows, dutyRows, operators, crewPlan] = await Promise.all([
    prisma.vehicleBlock.findMany({
      where:   { vehiclePlanId },
      orderBy: { blockNumber: 'asc' },
      select: {
        id: true, blockNumber: true, branchId: true, vehicleType: true, issues: true,
        depot:      { select: { name: true } },
        blockTrips: {
          select: {
            trip: {
              select: {
                departureMinutes: true, arrivalMinutes: true,
                route: { select: { direction: true, originLocalityId: true, destinationLocalityId: true, line: { select: { code: true } } } },
              },
            },
          },
        },
        blockDeadruns:  { select: { type: true, departureMinutes: true, arrivalMinutes: true, originLocalityId: true, destinationLocalityId: true } },
        blockIntervals: { select: { departureMinutes: true, arrivalMinutes: true, intervalType: { select: { code: true, name: true } } } },
      },
    }),
    crewPlanId
      ? prisma.duty.findMany({
        where:   { crewPlanId },
        orderBy: [{ role: 'asc' }, { dutyNumber: 'asc' }],
        include: {
          pieces:     { orderBy: { sequence: 'asc' } },
          activities: { orderBy: { startMinutes: 'asc' }, include: { intervalType: { select: { code: true, name: true } } } },
        },
      })
      : Promise.resolve([]),
    prisma.scopeOperator.findMany({ where: { scopeId: plan.scopeId }, select: { branchId: true, abbr: true } }),
    crewPlanId ? prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { description: true } }) : Promise.resolve(null),
  ])

  const localityIds = new Set<string>()
  const pairs       = new Map<string, { originId: string; destinationId: string }>()
  const addPair     = (originId: string, destinationId: string) => {
    localityIds.add(originId); localityIds.add(destinationId)
    pairs.set(`${originId}:${destinationId}`, { originId, destinationId })
  }
  for (const b of blockRows) {
    for (const { trip } of b.blockTrips) addPair(trip.route.originLocalityId, trip.route.destinationLocalityId)
    for (const d of b.blockDeadruns) addPair(d.originLocalityId, d.destinationLocalityId)
  }
  for (const d of dutyRows) {
    for (const p of d.pieces) { localityIds.add(p.startLocalityId); localityIds.add(p.endLocalityId) }
    for (const a of d.activities) for (const id of [a.originLocalityId, a.destinationLocalityId]) if (id) localityIds.add(id)
  }

  const [localities, matrix] = await Promise.all([
    prisma.transitLocality.findMany({ where: { id: { in: [...localityIds] } }, select: { id: true, name: true } }),
    pairs.size
      ? prisma.travelTimeMatrix.findMany({ where: { OR: [...pairs.values()] }, select: { originId: true, destinationId: true, distanceKm: true } })
      : Promise.resolve([]),
  ])
  const place   = new Map(localities.map(l => [l.id, l.name]))
  const name    = (id: string | null) => id ? place.get(id) ?? '' : ''
  const kmOf    = new Map(matrix.map(m => [`${m.originId}:${m.destinationId}`, m.distanceKm]))
  const company = new Map(operators.map(o => [o.branchId, o.abbr]))

  const blocks: CsvBlock[] = blockRows.map(b => {
    const events: BlockEvent[] = [
      ...b.blockTrips.map(({ trip: t }): BlockEvent => ({
        kind:      'TRIP',
        start:     t.departureMinutes,
        end:       t.arrivalMinutes,
        from:      name(t.route.originLocalityId),
        to:        name(t.route.destinationLocalityId),
        line:      t.route.line.code,
        direction: ROUTE_DIRECTION_LABEL[t.route.direction] ?? t.route.direction,
        km:        kmOf.get(`${t.route.originLocalityId}:${t.route.destinationLocalityId}`) ?? null,
      })),
      ...b.blockDeadruns.map((d): BlockEvent => ({
        kind:  d.type,
        start: d.departureMinutes,
        end:   d.arrivalMinutes,
        from:  name(d.originLocalityId),
        to:    name(d.destinationLocalityId),
        km:    kmOf.get(`${d.originLocalityId}:${d.destinationLocalityId}`) ?? null,
      })),
      ...b.blockIntervals.map((i): BlockEvent => ({
        kind:  'INTERVAL',
        start: i.departureMinutes,
        end:   i.arrivalMinutes,
        from:  null,
        to:    null,
        code:  i.intervalType.code,
        name:  i.intervalType.name,
      })),
    ]
    const issues = (b.issues as VehicleBlockIssue[] | null) ?? []
    return {
      id:          b.id,
      blockNumber: b.blockNumber,
      company:     b.branchId ? company.get(b.branchId) ?? '' : '',
      depot:       b.depot.name,
      vehicleType: VEHICLE_TYPE_LABELS[b.vehicleType] ?? b.vehicleType,
      issues:      [...new Set(issues.map(i => VEHICLE_BLOCK_ISSUE_LABEL[i.code]))],
      events,
    }
  })

  const duties: CsvDuty[] = dutyRows.map(d => {
    const issues = (d.issues as DutyIssue[] | null) ?? []
    return {
      label:     formatDutyNumber(d.role, d.dutyNumber),
      role:      CREW_ROLE_LABEL[d.role],
      kind:      d.kind,
      kindLabel: DUTY_KIND_LABEL[d.kind],
      company:   d.branchId ? company.get(d.branchId) ?? '' : '',
      summary:   d.summary as DutySummary | null,
      issues:    [...(d.isStale ? ['Desatualizada'] : []), ...new Set(issues.map(i => DUTY_ISSUE_LABEL[i.code]))],
      pieces:    d.pieces.map(p => ({
        blockId: p.vehicleBlockId,
        start:   p.startMinutes,
        end:     p.endMinutes,
        from:    name(p.startLocalityId),
        to:      name(p.endLocalityId),
        stale:   p.isStale ? (p.staleReason ? DUTY_PIECE_STALE_LABEL[p.staleReason as DutyPieceStaleReason] : 'Desatualizado') : null,
      })),
      activities: d.activities.map(a => ({
        type:  a.type,
        start: a.startMinutes,
        end:   a.endMinutes,
        from:  a.originLocalityId ? name(a.originLocalityId) : null,
        to:    a.destinationLocalityId ? name(a.destinationLocalityId) : null,
        code:  a.intervalType?.code ?? null,
        name:  a.intervalType?.name ?? null,
      })),
    }
  })

  const nameParts = [plan.scope.name, plan.dayType.name, crewPlanId ? crewPlan?.description : plan.description]
  return { name: nameParts.filter(Boolean).join('-'), blocks, duties }
}
