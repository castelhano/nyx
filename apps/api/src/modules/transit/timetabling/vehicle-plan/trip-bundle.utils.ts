import { BadRequestException } from '@nestjs/common'
import { lineVehicleTypesSchema, type VehicleTypeValue } from '@nyx/schemas'

// Trip groups (bundleId on TransitTrip, BlockDeadrun and BlockInterval) — created from the
// vehicle plan Gantt through applyDiff's patches. Members are explicit: the trips plus any
// deadrun/interval the user grouped with them (e.g. a whole block, its ACCESS and RETURN
// included). A new group is checked once, when created; anything that breaks it later (a
// time edit) is only flagged (BUNDLE_BROKEN), never blocked.

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hours = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`

export interface BundleLimits {
  // the vehicle block's maximum duration (planning range.minBlockDuration.ceiling)
  maxSpan:            number
  // one driver runs the whole group without a break (crew maxContinuousDrivingMinutes)
  maxContinuousDriving: number
}

type Span = { departureMinutes: number; arrivalMinutes: number }

// The groups the diff creates: at least one trip and two members, all in one block, nothing
// else between them, a vehicle type every trip accepts, and within the block and continuous
// driving limits.
export async function validateNewBundles(db: any, planId: string, bundleIds: string[], limits: BundleLimits): Promise<void> {
  if (!bundleIds.length) return
  const [trips, deadruns, intervals]: [
    {
      id: string; bundleId: string; departureMinutes: number; arrivalMinutes: number; requiredVehicleType: VehicleTypeValue | null
      route: { line: { vehicleTypes: unknown } }
      blockTrips: { vehicleBlockId: string }[]
    }[],
    (Span & { id: string; bundleId: string; vehicleBlockId: string })[],
    (Span & { id: string; bundleId: string; vehicleBlockId: string })[],
  ] = await Promise.all([
    db.transitTrip.findMany({
      where:  { vehiclePlanId: planId, bundleId: { in: bundleIds } },
      select: {
        id: true, bundleId: true, departureMinutes: true, arrivalMinutes: true, requiredVehicleType: true,
        route:      { select: { line: { select: { vehicleTypes: true } } } },
        blockTrips: { select: { vehicleBlockId: true } },
      },
    }),
    db.blockDeadrun.findMany({
      where:  { bundleId: { in: bundleIds }, vehicleBlock: { vehiclePlanId: planId } },
      select: { id: true, bundleId: true, vehicleBlockId: true, departureMinutes: true, arrivalMinutes: true },
    }),
    db.blockInterval.findMany({
      where:  { bundleId: { in: bundleIds }, vehicleBlock: { vehiclePlanId: planId } },
      select: { id: true, bundleId: true, vehicleBlockId: true, departureMinutes: true, arrivalMinutes: true },
    }),
  ])

  for (const bundleId of bundleIds) {
    const group = trips.filter(t => t.bundleId === bundleId).sort((a, b) => a.departureMinutes - b.departureMinutes)
    const rows  = [...deadruns, ...intervals].filter(r => r.bundleId === bundleId)
    if (group.length === 0) throw new BadRequestException('Um grupo precisa de pelo menos uma viagem')
    if (group.length + rows.length < 2) throw new BadRequestException('Um grupo precisa de pelo menos dois elementos')
    const members = [...group, ...rows]
    const start = Math.min(...members.map(m => m.departureMinutes))
    const end   = Math.max(...members.map(m => m.arrivalMinutes))
    const at = `Grupo das ${clock(start)}`

    const blockIds = new Set([...group.flatMap(t => t.blockTrips.map(bt => bt.vehicleBlockId)), ...rows.map(r => r.vehicleBlockId)])
    if (blockIds.size !== 1 || group.some(t => t.blockTrips.length !== 1)) {
      throw new BadRequestException(`${at}: os elementos precisam estar no mesmo carro`)
    }
    const [blockId] = blockIds
    // anything of the block within the group's span that isn't one of its members
    const within    = { departureMinutes: { gte: start }, arrivalMinutes: { lte: end } }
    const memberIds = rows.map(r => r.id)
    const [otherTrips, otherDeadruns, otherIntervals] = await Promise.all([
      db.blockTrip.count({ where: { vehicleBlockId: blockId, tripId: { notIn: group.map(t => t.id) }, trip: within } }),
      db.blockDeadrun.count({ where: { vehicleBlockId: blockId, id: { notIn: memberIds }, ...within } }),
      db.blockInterval.count({ where: { vehicleBlockId: blockId, id: { notIn: memberIds }, ...within } }),
    ])
    if (otherTrips > 0) throw new BadRequestException(`${at}: há outra viagem entre os elementos do grupo`)
    if (otherDeadruns + otherIntervals > 0) throw new BadRequestException(`${at}: há deslocamento ou intervalo fora do grupo entre os elementos dele`)

    const span = end - start
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

// the deadruns and intervals grouped with these trips, on their block — they travel with the
// group when its trips move to another block
export async function bundleRowsOf(db: any, blockId: string, tripIds: string[]): Promise<{ deadrunIds: string[]; intervalIds: string[] }> {
  const rows: { bundleId: string | null }[] = await db.transitTrip.findMany({
    where:  { id: { in: tripIds }, bundleId: { not: null } },
    select: { bundleId: true },
  })
  const bundleIds = [...new Set(rows.map(r => r.bundleId!))]
  if (!bundleIds.length) return { deadrunIds: [], intervalIds: [] }
  const [deadruns, intervals] = await Promise.all([
    db.blockDeadrun.findMany({ where: { vehicleBlockId: blockId, bundleId: { in: bundleIds } }, select: { id: true } }),
    db.blockInterval.findMany({ where: { vehicleBlockId: blockId, bundleId: { in: bundleIds } }, select: { id: true } }),
  ])
  return { deadrunIds: deadruns.map((d: { id: string }) => d.id), intervalIds: intervals.map((i: { id: string }) => i.id) }
}
