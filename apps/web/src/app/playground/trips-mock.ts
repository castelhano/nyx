// Mock per-line, per-direction trip departures for the running-schedule table
// prototype (see TripsGridPrototype.tsx). Derived from each line's windows so
// headway roughly tracks cycle intensity per band — not a real generation
// algorithm, just enough shape to prototype the table/headway/navigation UX.

import { MOCK_LINE, MOCK_LINE_2, type CycleWindow, type MockLine } from './mock-data'

export interface MockTrip {
  id:  string
  dep: number // minutes from midnight
}

export interface LineTrips {
  code:     string
  name:     string
  outbound: MockTrip[]
  inbound:  MockTrip[]
}

function directionTrips(windows: CycleWindow[], prefix: string): MockTrip[] {
  const trips: MockTrip[] = []
  let seq = 0
  for (const w of windows) {
    const headway = Math.max(6, Math.min(20, Math.round(w.minutes / 6)))
    for (let m = Math.round(w.from * 60); m < Math.round(w.to * 60); m += headway) {
      trips.push({ id: `${prefix}-${seq++}`, dep: m })
    }
  }
  return trips
}

function tripsForLine(line: MockLine): LineTrips {
  return {
    code:     line.code,
    name:     line.name,
    outbound: directionTrips(line.windows.OUTBOUND ?? [], `${line.code}-out`),
    inbound:  directionTrips(line.windows.INBOUND  ?? [], `${line.code}-in`),
  }
}

export const MOCK_LINES: LineTrips[] = [MOCK_LINE, MOCK_LINE_2].map(tripsForLine)
