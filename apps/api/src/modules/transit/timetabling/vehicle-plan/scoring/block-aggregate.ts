// Shared block-level aggregate consumed by PlanScoreState / scoreFromAggregates
// (plan-scoring.calc.ts). buildAggregateFromPersisted is the only builder: it reads
// BlockTrip/BlockDeadrun/BlockInterval rows, so it respects manual edits to vazio/intervalo
// timing. The vehicle solver materializes its candidate blocks into this same input shape
// (the rows it would persist) — one builder, one score, whether persisted or proposed
// (docs/proposal/plan_vehicle_solver_v2.md, "O solver otimiza o que a tela mostra").
export interface BlockAggregate {
  vehicleType:       string
  branchId:          string | null
  tripCount:          number
  productiveKm:       number
  productiveMinutes:  number
  deadrunKm:          number
  deadrunMinutes:     number
  intervalMinutes:    number
  totalMinutes:       number   // productiveMinutes + deadrunMinutes + intervalMinutes — see §2.1
  lineTransfers:      number
  preferredTripCount: number   // trips of lines with a preferred vehicle type
  preferredMissCount: number   // ...running in another type
}

export interface PersistedBlockTripInput {
  trip: {
    departureMinutes:    number
    arrivalMinutes:      number
    route: {
      lineId:                string
      originLocalityId:      string
      destinationLocalityId: string
      direction:             string
      // vehicleTypes: LineVehicleTypes (packages/schemas/transit/line.schema.ts)
      line: { metrics: unknown; vehicleTypes?: unknown }
    }
  }
}

export interface PersistedBlockInput {
  vehicleType:    string
  branchId:       string | null
  blockTrips:     PersistedBlockTripInput[]   // must already be ordered chronologically (sequence asc)
  blockDeadruns:  { originLocalityId: string; destinationLocalityId: string; departureMinutes: number; arrivalMinutes: number }[]
  blockIntervals: { departureMinutes: number; arrivalMinutes: number }[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function buildAggregateFromPersisted(
  block:    PersistedBlockInput,
  matrixKm: Record<string, number>,
): BlockAggregate {
  let productiveKm      = 0
  let productiveMinutes = 0
  let lineTransfers      = 0
  let preferredTripCount = 0
  let preferredMissCount = 0
  let lastLineId: string | null = null

  for (const bt of block.blockTrips) {
    const route      = bt.trip.route
    const extMetrics = route.line.metrics as { extensionKm?: Record<string, number> } | null
    const tripKm     = extMetrics?.extensionKm?.[route.direction]
      ?? matrixKm[`${route.originLocalityId}:${route.destinationLocalityId}`]
      ?? 0

    productiveKm      += tripKm
    productiveMinutes += bt.trip.arrivalMinutes - bt.trip.departureMinutes
    if (lastLineId !== null && lastLineId !== route.lineId) lineTransfers++
    lastLineId = route.lineId
    const preferred = (route.line.vehicleTypes as { preferred?: string | null } | null | undefined)?.preferred
    if (preferred) {
      preferredTripCount++
      if (preferred !== block.vehicleType) preferredMissCount++
    }
  }

  let deadrunKm      = 0
  let deadrunMinutes = 0
  for (const dr of block.blockDeadruns) {
    deadrunMinutes += dr.arrivalMinutes - dr.departureMinutes
    deadrunKm      += matrixKm[`${dr.originLocalityId}:${dr.destinationLocalityId}`] ?? 0
  }

  let intervalMinutes = 0
  for (const bi of block.blockIntervals) intervalMinutes += bi.arrivalMinutes - bi.departureMinutes

  return {
    vehicleType:       block.vehicleType,
    branchId:          block.branchId,
    tripCount:         block.blockTrips.length,
    productiveKm:      r2(productiveKm),
    productiveMinutes,
    deadrunKm:         r2(deadrunKm),
    deadrunMinutes,
    intervalMinutes,
    totalMinutes:      productiveMinutes + deadrunMinutes + intervalMinutes,
    lineTransfers,
    preferredTripCount,
    preferredMissCount,
  }
}
