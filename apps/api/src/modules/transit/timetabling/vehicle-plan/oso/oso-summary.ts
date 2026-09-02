import { PrismaService } from '../../../../../prisma/prisma.service'
import type { OsoAssembled, OsoDirection } from './oso-assembler'

// Layer 4 of the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) — recomputes in
// TS the RESUMO aggregates the legacy spreadsheet did with Excel formulas (COUNT, MAX-MIN,
// SUMIF...). Takes the assembler's per-family view model plus a couple of extra lookups
// (TransitLine.metrics, TravelTimeMatrix, VehicleBlock.depotId) needed for extension km.

export interface OsoOperatorSummary {
  operatorLabel:    string
  // "Viagens Programadas" counts round-trip cycles, not one-way legs — confirmed against a
  // real OSO (A22B): 54 one-way BlockTrips printed as V=27,0, and a carro with a single
  // unpaired leg (a single-trip reinforcement carro) printed as V=0,5. Can be fractional.
  trips:            number
  fleet:            number // distinct carros for this operator
  operatingMinutes: number // sum, per carro, of (last trip arrival - first trip departure)
  km:               number // revenue km (per-trip extensionKm by direction) + deadhead km (fleet x line's own average)
}

export interface OsoSummary {
  operators: OsoOperatorSummary[]
  totals:    { trips: number; fleet: number; operatingMinutes: number; km: number }
  // rule 10 — at most 6 values: one per distinct route (origin+destination+direction) actually
  // run by the family, using that route's most common (mode) cycle duration; routes beyond 6
  // are dropped, keeping the ones with the most trips
  cycleTimesMinutes: number[]
  // TransitLine.metrics.extensionKm of the family's root line, as-is (no field new needed —
  // see "What already exists" in the plan doc)
  extensionUtilKm: Partial<Record<OsoDirection, number>>
  // rule 9 — average deadhead km per carro of THIS line's family, modeled from each carro's
  // own depot and the canonical terminal of whichever direction it starts/ends on within the
  // recorte — not a sum of the family's actual BlockDeadrun rows (rule 8: those are anchored
  // to the block's whole day, which may belong to another line on an aproveitamento block)
  extensionOciosaKm: number
}

const NO_OPERATOR = 'SEM OPERADORA'

function mode(values: number[]): number {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
}

// rule 9 — modeled, not measured: for each carro, the ACCESS leg is depot -> origin of
// whichever direction the carro's FIRST trip within the recorte runs, and the RETURN leg is
// destination of whichever direction its LAST trip runs -> depot. Averaged over the family's
// carros. Deliberately ignores the block's actual BlockDeadrun rows, which are anchored to
// the block's whole-day first/last trip (possibly a different line on an aproveitamento
// block) rather than to this line's own recorte.
async function computeExtensionOciosaKm(prisma: PrismaService, assembled: OsoAssembled): Promise<number> {
  const db = prisma as any
  if (assembled.carros.length === 0) return 0

  const [routes, blocks] = await Promise.all([
    db.transitRoute.findMany({
      where:  { lineId: { in: assembled.family.map(l => l.id) } },
      select: { direction: true, originLocalityId: true, destinationLocalityId: true },
    }),
    db.vehicleBlock.findMany({
      where:  { id: { in: assembled.carros.map(c => c.blockId) } },
      select: { id: true, depotId: true },
    }),
  ])
  // one representative route per direction — good enough for a modeled average, this isn't
  // trying to match the exact route variant each trip used
  const routeByDirection = new Map<OsoDirection, { originLocalityId: string; destinationLocalityId: string }>()
  for (const r of routes) if (!routeByDirection.has(r.direction)) routeByDirection.set(r.direction, r)
  const depotByBlock = new Map<string, string>(blocks.map((b: any) => [b.id, b.depotId]))

  const legs: { depotId: string; accessOriginId: string; returnDestId: string }[] = []
  for (const carro of assembled.carros) {
    const tripEvents = carro.events.filter(e => e.kind === 'trip')
    const depotId = depotByBlock.get(carro.blockId)
    if (tripEvents.length === 0 || !depotId) continue

    const accessRoute = routeByDirection.get(tripEvents[0].direction)
    const returnRoute  = routeByDirection.get(tripEvents[tripEvents.length - 1].direction)
    if (!accessRoute || !returnRoute) continue

    legs.push({ depotId, accessOriginId: accessRoute.originLocalityId, returnDestId: returnRoute.destinationLocalityId })
  }
  if (legs.length === 0) return 0

  const pairs = new Set<string>()
  for (const l of legs) {
    pairs.add(`${l.depotId}:${l.accessOriginId}`)
    pairs.add(`${l.returnDestId}:${l.depotId}`)
  }
  const matrix = await db.travelTimeMatrix.findMany({
    where:  { OR: [...pairs].map(p => { const [originId, destinationId] = p.split(':'); return { originId, destinationId } }) },
    select: { originId: true, destinationId: true, distanceKm: true },
  })
  const kmByPair = new Map<string, number>(matrix.map((m: any) => [`${m.originId}:${m.destinationId}`, m.distanceKm]))

  let totalKm = 0
  for (const l of legs) {
    totalKm += kmByPair.get(`${l.depotId}:${l.accessOriginId}`) ?? 0
    totalKm += kmByPair.get(`${l.returnDestId}:${l.depotId}`) ?? 0
  }
  return totalKm / legs.length
}

export async function computeOsoSummary(
  prisma:    PrismaService,
  assembled: OsoAssembled,
): Promise<OsoSummary> {
  const db = prisma as any

  const [rootLine, extensionOciosaKm] = await Promise.all([
    db.transitLine.findUnique({ where: { id: assembled.family[0].id }, select: { metrics: true } }),
    computeExtensionOciosaKm(prisma, assembled),
  ])
  const extensionUtilKm = (rootLine?.metrics as any)?.extensionKm ?? {}

  const byOperator = new Map<string, typeof assembled.carros>()
  for (const carro of assembled.carros) {
    const key = carro.operatorLabel ?? NO_OPERATOR
    if (!byOperator.has(key)) byOperator.set(key, [])
    byOperator.get(key)!.push(carro)
  }

  const operators: OsoOperatorSummary[] = []
  for (const [operatorLabel, carros] of byOperator) {
    let trips = 0
    let operatingMinutes = 0
    let km = 0

    for (const carro of carros) {
      const tripEvents = carro.events.filter(e => e.kind === 'trip')
      trips += tripEvents.length / 2
      if (tripEvents.length > 0) {
        const first = Math.min(...tripEvents.map(e => e.departureMinutes))
        const last  = Math.max(...tripEvents.map(e => e.arrivalMinutes))
        operatingMinutes += last - first
      }
      for (const e of tripEvents) km += extensionUtilKm[e.direction] ?? 0
    }
    km += carros.length * extensionOciosaKm

    operators.push({ operatorLabel, trips, fleet: carros.length, operatingMinutes, km })
  }

  const totals = operators.reduce(
    (acc, o) => ({
      trips:            acc.trips + o.trips,
      fleet:            acc.fleet + o.fleet,
      operatingMinutes: acc.operatingMinutes + o.operatingMinutes,
      km:               acc.km + o.km,
    }),
    { trips: 0, fleet: 0, operatingMinutes: 0, km: 0 },
  )

  // rule 10 — one duration per route (origin+destination+direction), moda of its trips'
  // durations, keeping the 6 routes with the most trips
  const byRoute = new Map<string, number[]>()
  for (const carro of assembled.carros) {
    for (const e of carro.events) {
      if (e.kind !== 'trip') continue
      if (!byRoute.has(e.routeId)) byRoute.set(e.routeId, [])
      byRoute.get(e.routeId)!.push(e.arrivalMinutes - e.departureMinutes)
    }
  }
  const cycleTimesMinutes = [...byRoute.values()]
    .sort((a, b) => b.length - a.length)
    .slice(0, 6)
    .map(durations => mode(durations))
    .sort((a, b) => a - b)

  return { operators, totals, cycleTimesMinutes, extensionUtilKm, extensionOciosaKm }
}
