import { BadRequestException } from '@nestjs/common'
import { lineVehicleTypesSchema, type VehicleTypeValue } from '@nyx/schemas'

// Trip groups (TransitTrip.bundleId) — created from the vehicle plan Gantt through applyDiff's
// trip patches. A new group is checked once, when created; anything that breaks it later
// (a move, a time edit) is only flagged (BUNDLE_BROKEN), never blocked.

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hours = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`

export interface BundleLimits {
  // the vehicle block's maximum duration (planning range.minBlockDuration.ceiling)
  maxSpan:            number
  // one driver runs the whole group without a break (crew maxContinuousDrivingMinutes)
  maxContinuousDriving: number
}

// The groups the diff creates: at least two trips, all in one block, nothing else between them,
// a vehicle type every trip accepts, and within the block and continuous driving limits.
export async function validateNewBundles(db: any, planId: string, bundleIds: string[], limits: BundleLimits): Promise<void> {
  if (!bundleIds.length) return
  const trips: {
    id: string; bundleId: string; departureMinutes: number; arrivalMinutes: number; requiredVehicleType: VehicleTypeValue | null
    route: { line: { vehicleTypes: unknown } }
    blockTrips: { vehicleBlockId: string }[]
  }[] = await db.transitTrip.findMany({
    where:  { vehiclePlanId: planId, bundleId: { in: bundleIds } },
    select: {
      id: true, bundleId: true, departureMinutes: true, arrivalMinutes: true, requiredVehicleType: true,
      route:      { select: { line: { select: { vehicleTypes: true } } } },
      blockTrips: { select: { vehicleBlockId: true } },
    },
  })

  for (const bundleId of bundleIds) {
    const group = trips.filter(t => t.bundleId === bundleId).sort((a, b) => a.departureMinutes - b.departureMinutes)
    if (group.length < 2) throw new BadRequestException('Um grupo precisa de pelo menos duas viagens')
    const first = group[0], last = group[group.length - 1]
    const at = `Grupo das ${clock(first.departureMinutes)}`

    const blockIds = new Set(group.flatMap(t => t.blockTrips.map(bt => bt.vehicleBlockId)))
    if (blockIds.size !== 1 || group.some(t => t.blockTrips.length !== 1)) {
      throw new BadRequestException(`${at}: as viagens precisam estar no mesmo carro`)
    }
    const [blockId] = blockIds
    const between = await db.blockTrip.count({
      where: {
        vehicleBlockId: blockId,
        tripId:         { notIn: group.map(t => t.id) },
        trip:           { departureMinutes: { gte: first.departureMinutes, lte: last.arrivalMinutes } },
      },
    })
    if (between > 0) throw new BadRequestException(`${at}: há outra viagem entre as viagens do grupo`)

    const span = last.arrivalMinutes - first.departureMinutes
    if (span > limits.maxSpan) {
      throw new BadRequestException(`${at}: ${hours(span)} excede a duração máxima do bloco (${hours(limits.maxSpan)})`)
    }
    if (span > limits.maxContinuousDriving) {
      throw new BadRequestException(`${at}: ${hours(span)} excede a direção contínua do condutor (${hours(limits.maxContinuousDriving)})`)
    }

    let types: Set<VehicleTypeValue> | null = null
    for (const t of group) {
      const lineTypes = lineVehicleTypesSchema.safeParse(t.route.line.vehicleTypes ?? {})
      const allowed = t.requiredVehicleType ? [t.requiredVehicleType] : lineTypes.success && lineTypes.data.allowed.length ? lineTypes.data.allowed : null
      if (allowed) types = new Set(types ? allowed.filter(v => types!.has(v)) : allowed)
    }
    if (types && !types.size) throw new BadRequestException(`${at}: as viagens não têm um tipo de veículo em comum`)
  }
}
