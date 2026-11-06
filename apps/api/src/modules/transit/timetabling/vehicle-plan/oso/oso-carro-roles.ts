import type { OsoCarro, OsoEvent, OsoTripEvent } from './oso-assembler'

// What a block means on the OSO, which isn't always "one block = one carro" — applied by the
// assembler after numbering order is settled, purely from the trips themselves:
//   - continuation: a block picking up the line right where another one left it is the same
//     carro on paper, even though the plan splits them (usually for a crew reason). Either
//     straight away, or after a pause when one block goes off to another line in the morning
//     and the other comes from another line in the afternoon
//   - REFORÇO: a carro with a single one-way trip of the line is reinforcement. It still prints
//     and counts its trip and hours, but takes no ordinal and is out of the fleet

// tolerance between the arrival and the next departure — the plan's usual layover
const CONTINUATION_MAX_GAP_MINUTES = 5

function tripsOf(carro: OsoCarro): OsoTripEvent[] {
  return carro.events.filter((e): e is OsoTripEvent => e.kind === 'trip')
}

// a line running several routes the same way (F01) has no shared terminal to pause at, nor a
// frequency of its own to read
export function hasSeveralRoutesPerDirection(carros: OsoCarro[]): boolean {
  const routesByDirection = new Map<string, Set<string>>()
  for (const trip of carros.flatMap(tripsOf)) {
    const key = `${trip.lineId}:${trip.direction}`
    if (!routesByDirection.has(key)) routesByDirection.set(key, new Set())
    routesByDirection.get(key)!.add(trip.routeId)
  }
  return [...routesByDirection.values()].some(routes => routes.size > 1)
}

function continuationGap(from: OsoCarro, to: OsoCarro, allowPause: boolean): number | null {
  if (from.operatorLabel !== to.operatorLabel) return null
  const last  = tripsOf(from).at(-1)
  const first = tripsOf(to)[0]
  if (!last || !first || last.destinationLocalityId !== first.originLocalityId) return null
  const gap = first.departureMinutes - last.arrivalMinutes
  if (gap < 0) return null
  if (gap <= CONTINUATION_MAX_GAP_MINUTES) return gap

  const swapsLines = from.leavesForOtherLine && to.comesFromOtherLine
  const bothRealCarros = tripsOf(from).length >= 2 && tripsOf(to).length >= 2
  return allowPause && swapsLines && bothRealCarros ? gap : null
}

// straight on, the head's closing RECO/INTERV and the tail's positioning before its first trip
// go away: on paper the carro just keeps running. Across a pause it stops for that time, so
// the join reads as a RECO — the spacer and the H both follow from it
function joinCarros(head: OsoCarro, tail: OsoCarro, gap: number): OsoCarro {
  const last      = tripsOf(head).at(-1)!
  const firstTrip = tail.events.findIndex(e => e.kind === 'trip')
  const kept      = head.events.slice(0, head.events.lastIndexOf(last) + 1)
  const pause: OsoEvent[] = gap > CONTINUATION_MAX_GAP_MINUTES
    ? [{ kind: 'deadrun', id: `pause-${head.blockId}-${tail.blockId}`, type: 'RETURN', departureMinutes: last.arrivalMinutes, arrivalMinutes: last.arrivalMinutes }]
    : []
  return { ...head, leavesForOtherLine: tail.leavesForOtherLine, events: [...kept, ...pause, ...tail.events.slice(firstTrip)] }
}

// expects carros in chronological order — a continuation always starts after its head, so
// every head is reached before anything that could join it
export function mergeContinuations(carros: OsoCarro[]): OsoCarro[] {
  const allowPause = !hasSeveralRoutesPerDirection(carros)
  const absorbed = new Set<string>()
  const merged: OsoCarro[] = []

  for (const carro of carros) {
    if (absorbed.has(carro.blockId)) continue

    let head = carro
    for (;;) {
      const next = carros
        .filter(c => c !== carro && !absorbed.has(c.blockId))
        .map(c => ({ carro: c, gap: continuationGap(head, c, allowPause) }))
        .filter((c): c is { carro: OsoCarro; gap: number } => c.gap !== null)
        .sort((a, b) => a.gap - b.gap)[0]
      if (!next) break
      absorbed.add(next.carro.blockId)
      head = joinCarros(head, next.carro, next.gap)
    }
    merged.push(head)
  }

  return merged
}

// the H of a carro: what the sheet shows of it, period by period — a RECO or an INTERV stops the
// clock at the time printed beside it and the next trip restarts it. A contraflow return counts,
// the sheet closes the period where it arrives. A stretch on another line with no RECO keeps
// running, since the sheet shows those trips in sequence
export function operatingMinutes(carro: OsoCarro): number {
  let total = 0
  let start: number | null = null
  let end = 0

  for (const e of carro.events) {
    if (e.kind === 'trip') {
      start ??= e.departureMinutes
      end = Math.max(end, e.arrivalMinutes)
    } else if (e.kind === 'deadrun' && e.type === 'DISPLACEMENT') {
      end = Math.max(end, e.arrivalMinutes)
    } else if (start !== null) {
      total += end - start
      start = null
    }
  }
  return start === null ? total : total + end - start
}

export function assignOrdinals(carros: OsoCarro[]): OsoCarro[] {
  let next = 1
  return carros.map(carro => ({ ...carro, ordinal: tripsOf(carro).length === 1 ? null : next++ }))
}
