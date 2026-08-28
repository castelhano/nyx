// Shared block-level aggregate consumed by scoreFromAggregates (plan-scoring.calc.ts).
// buildAggregateFromPersisted is the only builder today — it reads real BlockTrip/
// BlockDeadrun/BlockInterval rows, so it respects manual edits to vazio/intervalo
// timing that a matrix-based estimate can't know about. A second builder deriving
// this same shape from hypothetical solver candidates belongs to the solver's own
// future revision (see docs/proposal/vehicle-plan-summary-score-consolidation.md §2.1)
// — until then the solver keeps its own internal scoring path.
export interface BlockAggregate {
  vehicleType:       string
  tripCount:          number
  productiveKm:       number
  productiveMinutes:  number
  deadrunKm:          number
  deadrunMinutes:     number
  intervalMinutes:    number
  totalMinutes:       number   // productiveMinutes + deadrunMinutes + intervalMinutes — see §2.1
  lineTransfers:      number
  avgLayover:         number
  intervalCount:      number
  specialTripCount:   number   // trips whose requiredVehicleType is unmet by this block's vehicleType
}

export interface PersistedBlockTripInput {
  trip: {
    departureMinutes:    number
    arrivalMinutes:      number
    requiredVehicleType: string | null
    route: {
      lineId:                string
      originLocalityId:      string
      destinationLocalityId: string
      direction:             string
      line: { metrics: unknown }
    }
  }
}

export interface PersistedBlockInput {
  vehicleType:    string
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
  let specialTripCount   = 0
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
    if (bt.trip.requiredVehicleType !== null && bt.trip.requiredVehicleType !== block.vehicleType) specialTripCount++
  }

  let deadrunKm      = 0
  let deadrunMinutes = 0
  for (const dr of block.blockDeadruns) {
    deadrunMinutes += dr.arrivalMinutes - dr.departureMinutes
    deadrunKm      += matrixKm[`${dr.originLocalityId}:${dr.destinationLocalityId}`] ?? 0
  }

  let intervalMinutes = 0
  for (const bi of block.blockIntervals) intervalMinutes += bi.arrivalMinutes - bi.departureMinutes
  const intervalCount = block.blockIntervals.length
  const avgLayover    = intervalCount > 0 ? intervalMinutes / intervalCount : 0

  return {
    vehicleType: block.vehicleType,
    tripCount:         block.blockTrips.length,
    productiveKm:      r2(productiveKm),
    productiveMinutes,
    deadrunKm:         r2(deadrunKm),
    deadrunMinutes,
    intervalMinutes,
    totalMinutes:      productiveMinutes + deadrunMinutes + intervalMinutes,
    lineTransfers,
    avgLayover:        r2(avgLayover),
    intervalCount,
    specialTripCount,
  }
}
