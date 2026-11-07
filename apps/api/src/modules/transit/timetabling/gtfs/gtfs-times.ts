export interface TimedStop {
  isLocality:   boolean
  // minutes from the previous entry of the route; waypoints count, localities are what's left
  deltaMinutes: number | null
}

// docs/architecture/transit/gtfs-export.md (Times) — the trip's departure and arrival are authoritative.
// Deltas are free-flow OSRM times, so they only give each locality's share of the trip: walking
// them and forcing the arrival would pile the whole difference on the last leg.
// Returns the seconds of each locality, in route order; null when the deltas are all zero.
export function localityTimes(stops: TimedStop[], departureMinutes: number, arrivalMinutes: number): number[] | null {
  const cumulative: number[] = []
  let elapsed = 0
  stops.forEach((stop, i) => {
    if (i > 0) elapsed += stop.deltaMinutes ?? 0
    if (stop.isLocality) cumulative.push(elapsed)
  })

  const span = cumulative[cumulative.length - 1] - cumulative[0]
  if (!(span > 0)) return null

  const departure = departureMinutes * 60
  const duration  = (arrivalMinutes - departureMinutes) * 60
  return cumulative.map(c => departure + Math.round(((c - cumulative[0]) / span) * duration))
}

export function gtfsTime(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}
