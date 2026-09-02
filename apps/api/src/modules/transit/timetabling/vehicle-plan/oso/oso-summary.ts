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
  // rule 10 — at most 6 values, deduped: full round-trip cycle time (ida+folga+volta+folga,
  // not one leg), the mode per pattern actually run by the family, keeping the 6 patterns
  // with the most cycles
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

const CLUSTER_GAP_MINUTES = 4
const CLUSTER_MIN_TRIPS   = 3

// density/seed clustering, not single-linkage chaining — a first version merged each value
// into the cluster of its immediate sorted neighbor, which chains transitively: a line whose
// cycle time drifts gradually through the day (84,84,84,84,88,92,92,96 - each step <=
// CLUSTER_GAP_MINUTES from the last) collapsed into one giant cluster dominated by 84,
// silently swallowing the real 92' peak even though it had enough samples on its own
// (confirmed against line 250: the peak-hour 92' cycle, 7 samples across 2 carros, vanished
// entirely). Seeding each cluster on the mode of what's left and absorbing only points within
// the gap of THAT seed (not of the previous point) keeps 84 and 92 apart since 92 is farther
// than CLUSTER_GAP_MINUTES from the 84 seed, even though the two are connected by intermediate
// values once those are removed from the pool.
function clusterDurations(durations: number[]): { value: number; count: number }[] {
  const pool     = [...durations]
  const clusters: { value: number; count: number }[] = []
  while (pool.length > 0) {
    const seed = mode(pool)
    const near = pool.filter(v => Math.abs(v - seed) <= CLUSTER_GAP_MINUTES)
    for (const v of near) pool.splice(pool.indexOf(v), 1)
    if (near.length >= CLUSTER_MIN_TRIPS) clusters.push({ value: mode(near), count: near.length })
  }
  return clusters
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

  // rule 10 — cycle time: ida departure -> the departure of the carro's next trip after its
  // volta (ida + folga + volta + folga antes da próxima partida). Two earlier attempts each
  // got half of this wrong: measuring the gap to the carro's own *next same-direction* trip
  // needs 2 trips in one direction from a single carro, so a carro doing exactly one round
  // trip in a window contributed zero samples despite running one real cycle (confirmed: line
  // 302 lost 4 of its real clusters this way); measuring ida-departure -> volta-arrival alone
  // fixed that but dropped the trailing folga, undercounting every sample by however long that
  // layover is (confirmed against line 250: 37' one-way leg, ~79' without the folga, ~85'-92'
  // real cycle). This version pairs each ida with the very next trip (so a lone round trip
  // still counts), then extends to the departure of whatever trip follows the volta when one
  // exists in this carro — only the carro's last cycle of the day (nothing scheduled after)
  // falls back to volta-arrival, since there's no next departure to measure against. CIRCULAR
  // has no separate legs, so its own trip duration already is the full cycle.
  //
  // A pattern isn't one number — a line can genuinely run more than one cycle time (peak vs.
  // off-peak, say), and the OSO is meant to show that (confirmed: a real RESUMO prints "84'
  // 92' 80'" for a single-pattern line). So within each pattern, durations are clustered by
  // proximity (gap <= CLUSTER_GAP_MINUTES — the kind of rounding noise a human curating this
  // by hand would merge on sight) instead of collapsed to one mode; a cluster under
  // CLUSTER_MIN_TRIPS is a stray outlier and is dropped, matching how the user does this by
  // hand today.
  const byPattern = new Map<string, number[]>()

  for (const carro of assembled.carros) {
    const tripEvents = carro.events.filter(e => e.kind === 'trip')

    for (const e of tripEvents.filter(e => e.direction === 'CIRCULAR')) {
      if (!byPattern.has(e.routeId)) byPattern.set(e.routeId, [])
      byPattern.get(e.routeId)!.push(e.arrivalMinutes - e.departureMinutes)
    }

    // one round trip per carro is enough to start (a lone-cycle carro still contributes),
    // starting the pair only from whichever direction this carro's day begins on
    const legs           = tripEvents.filter(e => e.direction !== 'CIRCULAR')
    const anchorDirection = legs.find(e => e.direction === 'OUTBOUND') ? 'OUTBOUND' : 'INBOUND'

    for (let i = 0; i < legs.length - 1; i++) {
      const a = legs[i]
      if (a.direction !== anchorDirection) continue
      const b = legs[i + 1]
      if (b.direction === anchorDirection) continue // two idas in a row, no volta between

      const next     = legs[i + 2]
      const cycleEnd = next ? next.departureMinutes : b.arrivalMinutes

      if (!byPattern.has(a.routeId)) byPattern.set(a.routeId, [])
      byPattern.get(a.routeId)!.push(cycleEnd - a.departureMinutes)
    }
  }

  const clusters = [...byPattern.values()].flatMap(clusterDurations)
  const cycleTimesMinutes = [...new Set(
    clusters
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map(c => c.value),
  )].sort((a, b) => a - b)

  return { operators, totals, cycleTimesMinutes, extensionUtilKm, extensionOciosaKm }
}
