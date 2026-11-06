import type { OsoAssembled, OsoDirection, OsoTripEvent } from './oso-assembler'
import { hasSeveralRoutesPerDirection } from './oso-carro-roles'

// The running timetable beside the sheet: one panel per service (the base line, then each
// variant), each direction sorted on its own. Only productive trips, reinforcements included.

export interface OsoFrequencyColumn {
  direction:  OsoDirection
  // ascending, past midnight kept above 1440 so the night stays at the end
  departures: number[]
}

export interface OsoFrequencyPanel {
  // the variant's code, null on the base line
  title:   string | null
  columns: OsoFrequencyColumn[]
  // V, same count as the sheet's RESUMO
  trips:   number
}

const DIRECTIONS: OsoDirection[] = ['OUTBOUND', 'INBOUND', 'CIRCULAR']

export function buildFrequencyPanels(assembled: OsoAssembled): OsoFrequencyPanel[] {
  if (hasSeveralRoutesPerDirection(assembled.carros)) return []

  const trips = assembled.carros.flatMap(c => c.events).filter((e): e is OsoTripEvent => e.kind === 'trip')
  const ordered = [
    ...assembled.family.filter(l => l.id === assembled.baseLineId),
    ...assembled.family.filter(l => l.id !== assembled.baseLineId),
  ]

  return ordered.flatMap(line => {
    const lineTrips = trips.filter(t => t.lineId === line.id)
    if (lineTrips.length === 0) return []

    const columns = DIRECTIONS.flatMap(direction => {
      const departures = lineTrips.filter(t => t.direction === direction).map(t => t.departureMinutes).sort((a, b) => a - b)
      return departures.length > 0 ? [{ direction, departures }] : []
    })
    return [{ title: line.id === assembled.baseLineId ? null : line.code, columns, trips: lineTrips.length / 2 }]
  })
}
