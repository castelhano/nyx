import { PrismaService } from '../../../../../prisma/prisma.service'
import type { OsoAssembled, OsoDirection } from './oso-assembler'

// Layer 4 of the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) — recomputes in
// TS the RESUMO aggregates the legacy spreadsheet did with Excel formulas (COUNT, MAX-MIN,
// SUMIF...). Takes the assembler's per-family view model plus a couple of plan-wide lookups
// (extension km, deadhead km) that live outside a single family's scope.

export interface OsoOperatorSummary {
  operatorLabel:    string
  // "Viagens Programadas" counts round-trip cycles, not one-way legs — confirmed against a
  // real OSO (A22B): 54 one-way BlockTrips printed as V=27,0, and a carro with a single
  // unpaired leg (a single-trip reinforcement carro) printed as V=0,5. Can be fractional.
  trips:            number
  fleet:            number // distinct carros for this operator
  operatingMinutes: number // sum, per carro, of (last trip arrival - first trip departure)
  km:               number // revenue km (per-trip extensionKm by direction) + deadhead km (fleet x plan average)
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
  // rule 9 — plan-wide average, not per line (accepted imprecision, see the plan doc)
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

async function computeExtensionOciosaKm(prisma: PrismaService, vehiclePlanId: string): Promise<number> {
  const db = prisma as any

  const deadruns = await db.blockDeadrun.findMany({
    where:  { type: { in: ['ACCESS', 'RETURN'] }, vehicleBlock: { vehiclePlanId } },
    select: { vehicleBlockId: true, originLocalityId: true, destinationLocalityId: true },
  })
  if (deadruns.length === 0) return 0

  const pairs = new Set<string>()
  for (const d of deadruns) pairs.add(`${d.originLocalityId}:${d.destinationLocalityId}`)

  const matrix = await db.travelTimeMatrix.findMany({
    where:  { OR: [...pairs].map(p => { const [originId, destinationId] = p.split(':'); return { originId, destinationId } }) },
    select: { originId: true, destinationId: true, distanceKm: true },
  })
  const kmByPair = new Map<string, number>(matrix.map((m: any) => [`${m.originId}:${m.destinationId}`, m.distanceKm]))

  let totalKm = 0
  const blocksWithDeadrun = new Set<string>()
  for (const d of deadruns) {
    totalKm += kmByPair.get(`${d.originLocalityId}:${d.destinationLocalityId}`) ?? 0
    blocksWithDeadrun.add(d.vehicleBlockId)
  }

  return blocksWithDeadrun.size > 0 ? totalKm / blocksWithDeadrun.size : 0
}

export async function computeOsoSummary(
  prisma:    PrismaService,
  assembled: OsoAssembled,
): Promise<OsoSummary> {
  const db = prisma as any

  const [rootLine, extensionOciosaKm] = await Promise.all([
    db.transitLine.findUnique({ where: { id: assembled.family[0].id }, select: { metrics: true } }),
    computeExtensionOciosaKm(prisma, assembled.vehiclePlanId),
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
