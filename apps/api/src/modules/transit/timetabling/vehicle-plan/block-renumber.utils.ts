/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Prisma transaction client (tx: any), same as block-mutation.utils */
// Renumbers a plan's blocks ("carro X") by line, then by the car's start:
//   - a car belongs to the line family (parent line + its children) with most of its trips;
//     a tie goes to the family of its first trip of the day
//   - families in natural code order (031, 206, 206B, 309, A06B…)
//   - within a family, by the departure of the car's first trip (access not counted)
//   - one sequence across the whole plan; cars with no trip go last, in their old order

export interface RenumberBlock {
  id:          string
  blockNumber: number
  trips:       Array<{ lineId: string; departureMinutes: number }>
}

export interface RenumberLine {
  id:           string
  code:         string
  parentLineId: string | null
}

export function renumberOrder(blocks: RenumberBlock[], lines: RenumberLine[]): string[] {
  const lineById = new Map(lines.map(l => [l.id, l]))
  const rootOf   = (id: string) => lineById.get(id)?.parentLineId ?? id
  const codeOf   = (id: string) => lineById.get(id)?.code ?? ''

  const keyed = blocks.map(b => {
    if (b.trips.length === 0) return { b, root: null as string | null, start: Infinity }
    const sorted = [...b.trips].sort((x, y) => x.departureMinutes - y.departureMinutes)
    const counts = new Map<string, number>()
    for (const t of sorted) counts.set(rootOf(t.lineId), (counts.get(rootOf(t.lineId)) ?? 0) + 1)
    const max  = Math.max(...counts.values())
    // first trip of the day among the most frequent families — breaks a tie
    const root = rootOf(sorted.find(t => counts.get(rootOf(t.lineId)) === max)!.lineId)
    return { b, root, start: sorted[0].departureMinutes }
  })

  keyed.sort((x, y) => {
    if (x.root === null || y.root === null) {
      if (x.root !== y.root) return x.root === null ? 1 : -1
      return x.b.blockNumber - y.b.blockNumber
    }
    if (x.root !== y.root) {
      const byCode = codeOf(x.root).localeCompare(codeOf(y.root), undefined, { numeric: true })
      if (byCode !== 0) return byCode
    }
    return x.start - y.start || x.b.blockNumber - y.b.blockNumber
  })

  return keyed.map(k => k.b.id)
}

// Rewrites blockNumber 1..N in the order above. Two passes because of the
// @@unique([vehiclePlanId, blockNumber]): first out of the way (negatives), then final.
export async function renumberBlocks(tx: any, planId: string): Promise<void> {
  const blocks = await tx.vehicleBlock.findMany({
    where:  { vehiclePlanId: planId },
    select: {
      id: true, blockNumber: true,
      blockTrips: { select: { trip: { select: { departureMinutes: true, route: { select: { lineId: true } } } } } },
    },
  })
  if (blocks.length === 0) return

  const lineIds = [...new Set<string>(blocks.flatMap((b: any) => b.blockTrips.map((bt: any) => bt.trip.route.lineId)))]
  const lines   = await tx.transitLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, code: true, parentLineId: true } })
  // parents named only through a child's parentLineId still need their code for sorting
  const parentIds = [...new Set<string>(lines.map((l: RenumberLine) => l.parentLineId).filter((id: string | null): id is string => !!id && !lineIds.includes(id)))]
  const parents   = parentIds.length > 0
    ? await tx.transitLine.findMany({ where: { id: { in: parentIds } }, select: { id: true, code: true, parentLineId: true } })
    : []

  const order = renumberOrder(
    blocks.map((b: any) => ({
      id:          b.id,
      blockNumber: b.blockNumber,
      trips:       b.blockTrips.map((bt: any) => ({ lineId: bt.trip.route.lineId, departureMinutes: bt.trip.departureMinutes })),
    })),
    [...lines, ...parents],
  )

  const current = new Map<string, number>(blocks.map((b: any) => [b.id, b.blockNumber]))
  if (order.every((id, i) => current.get(id) === i + 1)) return

  const nums = order.map((_, i) => i + 1)
  await tx.$executeRaw`
    UPDATE transit_vehicle_blocks SET "blockNumber" = -"blockNumber" WHERE "vehiclePlanId" = ${planId}`
  await tx.$executeRaw`
    UPDATE transit_vehicle_blocks AS b SET "blockNumber" = v.n
    FROM unnest(${order}::text[], ${nums}::int[]) AS v(id, n)
    WHERE b.id = v.id`
}
