import { PrismaService } from '../../../../../prisma/prisma.service'
import type { OsoAssembled, OsoDirection } from './oso-assembler'

// Layer 2 of the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) — resolves, per
// carro (not per line, rule 3), which columns its table needs and whether it must "break"
// into a second block of the same columns to fit the band's row budget (rule 4). Structural
// only: it decides WHICH columns exist, not the per-trip values that go in them — that's the
// renderer's job (layer 6), using RouteLocality.deltaMinutes/TravelTimeMatrix per rule 2.

export interface OsoColumn {
  direction:       OsoDirection
  // the RouteLocality row this column shows a time for — either the route's own origin
  // (departure baseline, rule 1) or a RouteLocality flagged includeInOso (extra column,
  // rule 1/2), arrival endpoints included
  routeLocalityId: string
  timing?:         'DEPARTURE' | 'ARRIVAL' // set on the baseline departure and a flagged
                                            // destination; absent on a genuine intermediate
                                            // stop, which is always a single derived instant
}

export interface OsoCarroLayout {
  columns:     OsoColumn[]
  tripsPerRow: 1 | 2
}

// Row budget a band has for one carro's own cycles before it "breaks" into a second block of
// the same columns (rule 4) — placeholder matching what the legacy sheets used; revisit once
// the renderer (layer 6) fixes actual row height / page geometry.
const MAX_ROWS_PER_BAND = 20

interface RouteShape {
  originLocalityId:      string
  destinationLocalityId: string
  destinationFlagged:    boolean
  // includeInOso points that aren't the route's own destination, in sequence order
  midLocalityIds:        string[]
}

async function loadRouteShapes(prisma: PrismaService, routeIds: string[]): Promise<Map<string, RouteShape>> {
  const db = prisma as any
  if (routeIds.length === 0) return new Map()

  const rows = await db.routeLocality.findMany({
    where:   { routeId: { in: routeIds } },
    orderBy: { sequence: 'asc' },
    select:  { id: true, routeId: true, includeInOso: true },
  })

  const byRoute = new Map<string, typeof rows>()
  for (const r of rows) {
    if (!byRoute.has(r.routeId)) byRoute.set(r.routeId, [])
    byRoute.get(r.routeId)!.push(r)
  }

  const shapes = new Map<string, RouteShape>()
  for (const [routeId, routeRows] of byRoute) {
    const origin      = routeRows[0]
    const destination = routeRows[routeRows.length - 1]
    shapes.set(routeId, {
      originLocalityId:      origin.id,
      destinationLocalityId: destination.id,
      destinationFlagged:    Boolean(destination.includeInOso),
      midLocalityIds: routeRows
        .filter((r: any) => r.includeInOso && r.id !== destination.id)
        .map((r: any) => r.id as string),
    })
  }
  return shapes
}

function buildColumns(direction: OsoDirection, shape: RouteShape): OsoColumn[] {
  const columns: OsoColumn[] = [
    { direction, routeLocalityId: shape.originLocalityId, timing: 'DEPARTURE' },
    ...shape.midLocalityIds.map((routeLocalityId): OsoColumn => ({ direction, routeLocalityId })),
  ]
  if (shape.destinationFlagged) {
    columns.push({ direction, routeLocalityId: shape.destinationLocalityId, timing: 'ARRIVAL' })
  }
  return columns
}

const DIRECTION_ORDER: OsoDirection[] = ['OUTBOUND', 'INBOUND']
const OPPOSITE: Record<'OUTBOUND' | 'INBOUND', 'OUTBOUND' | 'INBOUND'> = { OUTBOUND: 'INBOUND', INBOUND: 'OUTBOUND' }

interface RouteMeta {
  id:                    string
  lineId:                string
  direction:             OsoDirection
  originLocalityId:      string
  destinationLocalityId: string
  isPrimary:             boolean
}

async function loadRouteMeta(prisma: PrismaService, lineIds: string[]): Promise<RouteMeta[]> {
  const db = prisma as any
  if (lineIds.length === 0) return []
  return db.transitRoute.findMany({
    where:  { lineId: { in: lineIds } },
    select: { id: true, lineId: true, direction: true, originLocalityId: true, destinationLocalityId: true, isPrimary: true },
  })
}

// A carro running only one leg of a round trip (a single-trip reinforcement) still shows both
// columns of its pair, blank on the untraveled side — confirmed against a real OSO (A22B):
// reinforcement carros print both "SUCURI" and "AMBEV" headers even though each only ever
// has data on one. Pairs by swapped origin/destination on the same line; prefers isPrimary.
function findPairedRoute(routes: RouteMeta[], route: RouteMeta): RouteMeta | null {
  if (route.direction === 'CIRCULAR') return null
  const wantDirection = OPPOSITE[route.direction]
  const candidates = routes.filter(r =>
    r.lineId === route.lineId &&
    r.direction === wantDirection &&
    r.originLocalityId === route.destinationLocalityId &&
    r.destinationLocalityId === route.originLocalityId,
  )
  return candidates.find(r => r.isPrimary) ?? candidates[0] ?? null
}

export async function resolveLayouts(
  prisma:    PrismaService,
  assembled: OsoAssembled,
): Promise<Map<string, OsoCarroLayout>> {
  const routeMeta = await loadRouteMeta(prisma, assembled.family.map(l => l.id))
  const routeMetaById = new Map(routeMeta.map(r => [r.id, r]))

  // pass 1 — per carro, the route to use per direction, filling in the missing leg of the
  // pair (if any) so a single-direction carro still resolves both columns; no DB calls here
  const routeByDirectionPerCarro = new Map<string, Map<OsoDirection, string>>()
  for (const carro of assembled.carros) {
    const routeByDirection = new Map<OsoDirection, string>()
    for (const e of carro.events) {
      if (e.kind === 'trip' && !routeByDirection.has(e.direction)) routeByDirection.set(e.direction, e.routeId)
    }

    if (!routeByDirection.has('CIRCULAR')) {
      for (const [direction, routeId] of [...routeByDirection]) {
        const missing = OPPOSITE[direction as 'OUTBOUND' | 'INBOUND']
        if (routeByDirection.has(missing)) continue
        const route = routeMetaById.get(routeId)
        const paired = route ? findPairedRoute(routeMeta, route) : null
        if (paired) routeByDirection.set(missing, paired.id)
      }
    }

    routeByDirectionPerCarro.set(carro.blockId, routeByDirection)
  }

  // one batched fetch for every route touched, trip-run or only paired-in
  const allRouteIds = [...new Set([...routeByDirectionPerCarro.values()].flatMap(m => [...m.values()]))]
  const shapes = await loadRouteShapes(prisma, allRouteIds)

  // pass 2 — build columns + packing per carro from the resolved routes/shapes
  const layouts = new Map<string, OsoCarroLayout>()
  for (const carro of assembled.carros) {
    const tripEvents = carro.events.filter(e => e.kind === 'trip')
    const routeByDirection = routeByDirectionPerCarro.get(carro.blockId)!
    const directions = routeByDirection.has('CIRCULAR')
      ? (['CIRCULAR'] as OsoDirection[])
      : DIRECTION_ORDER.filter(d => routeByDirection.has(d))

    const columns: OsoColumn[] = []
    for (const direction of directions) {
      const shape = shapes.get(routeByDirection.get(direction)!)
      if (shape) columns.push(...buildColumns(direction, shape))
    }

    // rule 4 — cycles run vs. the band's row budget decides if this carro alone needs a
    // second block of the same columns; approximated as the fullest direction's trip count
    const cycles = directions.length > 0
      ? Math.max(...directions.map(d => tripEvents.filter(e => e.direction === d).length))
      : 0
    const tripsPerRow: 1 | 2 = cycles > MAX_ROWS_PER_BAND ? 2 : 1

    layouts.set(carro.blockId, { columns, tripsPerRow })
  }

  return layouts
}
