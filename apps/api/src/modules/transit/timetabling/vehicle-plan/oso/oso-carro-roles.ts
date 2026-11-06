import type { OsoCarro, OsoTripEvent } from './oso-assembler'

// What a block means on the OSO, which isn't always "one block = one carro" — applied by the
// assembler after numbering order is settled, purely from the trips themselves:
//   - continuation: a block picking up the line right where another one left it is the same
//     carro on paper, even though the plan splits them (usually for a crew reason)
//   - REFORÇO: a carro with a single one-way trip of the line is reinforcement. It still prints
//     and counts its trip and hours, but takes no ordinal and is out of the fleet

// tolerance between the arrival and the next departure — the plan's usual layover
const CONTINUATION_MAX_GAP_MINUTES = 5

function tripsOf(carro: OsoCarro): OsoTripEvent[] {
  return carro.events.filter((e): e is OsoTripEvent => e.kind === 'trip')
}

function continuationGap(from: OsoCarro, to: OsoCarro): number | null {
  if (from.operatorLabel !== to.operatorLabel) return null
  const last  = tripsOf(from).at(-1)
  const first = tripsOf(to)[0]
  if (!last || !first || last.destinationLocalityId !== first.originLocalityId) return null
  const gap = first.departureMinutes - last.arrivalMinutes
  return gap >= 0 && gap <= CONTINUATION_MAX_GAP_MINUTES ? gap : null
}

// the head's closing RECO/INTERV and the tail's positioning before its first trip go away:
// on paper the carro just keeps running
function joinCarros(head: OsoCarro, tail: OsoCarro): OsoCarro {
  const lastTrip  = head.events.lastIndexOf(tripsOf(head).at(-1)!)
  const firstTrip = tail.events.findIndex(e => e.kind === 'trip')
  return { ...head, events: [...head.events.slice(0, lastTrip + 1), ...tail.events.slice(firstTrip)] }
}

// expects carros in chronological order — a continuation always starts after its head, so
// every head is reached before anything that could join it
export function mergeContinuations(carros: OsoCarro[]): OsoCarro[] {
  const absorbed = new Set<string>()
  const merged: OsoCarro[] = []

  for (const carro of carros) {
    if (absorbed.has(carro.blockId)) continue

    let head = carro
    for (;;) {
      const next = carros
        .filter(c => c !== carro && !absorbed.has(c.blockId))
        .map(c => ({ carro: c, gap: continuationGap(head, c) }))
        .filter((c): c is { carro: OsoCarro; gap: number } => c.gap !== null)
        .sort((a, b) => a.gap - b.gap)[0]
      if (!next) break
      absorbed.add(next.carro.blockId)
      head = joinCarros(head, next.carro)
    }
    merged.push(head)
  }

  return merged
}

// the H of a carro: what the sheet shows of it, period by period — a RECO stops the clock and
// the next trip restarts it, so time in the garage never counts. An INTERV doesn't stop it (the
// carro is still out) and neither does a stretch on another line, which the sheet doesn't show
export function operatingMinutes(carro: OsoCarro): number {
  let total = 0
  let start: number | null = null
  let end = 0

  for (const e of carro.events) {
    if (e.kind === 'trip') {
      start ??= e.departureMinutes
      end = Math.max(end, e.arrivalMinutes)
    } else if (e.kind === 'deadrun' && e.type === 'RETURN' && start !== null) {
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
