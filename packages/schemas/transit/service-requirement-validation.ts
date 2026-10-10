// Checks which trips cover each LineServiceRequirement — pure, shared by the vehicle plan screen
// and (later) the API's notifications. See docs/proposal/plan_line_service_requirement_v1.md.

export interface ServiceRequirementLike {
  id:              string
  lineId:          string
  direction:       string
  kind:            'BOARDING' | 'ALIGHTING'
  localityId?:     string | null
  earliestMinutes: number
  latestMinutes:   number
}

export interface ServiceRequirementTrip {
  id:               string
  lineId:           string
  direction:        string
  routeId:          string
  departureMinutes: number
  arrivalMinutes:   number
}

export interface RouteStopLike {
  localityId:   string | null
  sequence:     number
  deltaMinutes: number | null
  deltaKm:      number | null
}

// Where along the trip each stop is reached, as a fraction of the trip's duration (0 = origin,
// 1 = destination). Proportional to the legs' deltaMinutes, so it follows the trip's own
// duration (which varies by time band) instead of adding raw deltas to the departure. Falls
// back to deltaKm, then to an even split, when a leg has no value. Waypoints are dropped.
export function routeStopFractions(stops: RouteStopLike[]): { localityId: string; fraction: number }[] {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence)
  const legs   = sorted.slice(1)
  const weigh  = (pick: (s: RouteStopLike) => number | null) =>
    legs.every(s => pick(s) != null) && legs.some(s => (pick(s) ?? 0) > 0) ? legs.map(s => pick(s)!) : null
  const weights = weigh(s => s.deltaMinutes) ?? weigh(s => s.deltaKm) ?? legs.map(() => 1)
  const total   = weights.reduce((a, b) => a + b, 0)

  let acc = 0
  const result: { localityId: string; fraction: number }[] = []
  sorted.forEach((stop, i) => {
    if (i > 0) acc += weights[i - 1]
    if (stop.localityId) result.push({ localityId: stop.localityId, fraction: total > 0 ? acc / total : 0 })
  })
  return result
}

// The trip's time(s) at the requirement's reference point — the passing time at the locality
// (more than one when the route visits it twice), else the departure (BOARDING) or the arrival
// (ALIGHTING). Null when the route's stops aren't known yet; [] when the route doesn't pass there.
export function tripTimesAtRequirement(
  req:       ServiceRequirementLike,
  trip:      ServiceRequirementTrip,
  stopsByRoute: Map<string, { localityId: string; fraction: number }[]>,
): number[] | null {
  if (!req.localityId) return [req.kind === 'BOARDING' ? trip.departureMinutes : trip.arrivalMinutes]
  const stops = stopsByRoute.get(trip.routeId)
  if (!stops) return null
  const duration = trip.arrivalMinutes - trip.departureMinutes
  return stops
    .filter(s => s.localityId === req.localityId)
    .map(s => Math.round(trip.departureMinutes + s.fraction * duration))
}

export interface ServiceRequirementCoverage {
  // requirement id → ids of the trips covering it ([] = uncovered)
  coveredBy:        Map<string, string[]>
  // trip id → ids of the requirements it covers
  tripRequirements: Map<string, string[]>
}

export function checkServiceRequirements(
  requirements: ServiceRequirementLike[],
  trips:        ServiceRequirementTrip[],
  stopsByRoute: Map<string, { localityId: string; fraction: number }[]>,
): ServiceRequirementCoverage {
  const coveredBy        = new Map<string, string[]>()
  const tripRequirements = new Map<string, string[]>()

  for (const req of requirements) {
    const covering = trips.filter(t => {
      if (t.lineId !== req.lineId || t.direction !== req.direction) return false
      const times = tripTimesAtRequirement(req, t, stopsByRoute)
      return !!times?.some(m => m >= req.earliestMinutes && m <= req.latestMinutes)
    })
    coveredBy.set(req.id, covering.map(t => t.id))
    for (const t of covering) tripRequirements.set(t.id, [...(tripRequirements.get(t.id) ?? []), req.id])
  }

  return { coveredBy, tripRequirements }
}

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// "17:00–17:15" (a single time when both ends match)
export function serviceRequirementWindowText(req: { earliestMinutes: number; latestMinutes: number }): string {
  return req.earliestMinutes === req.latestMinutes
    ? clock(req.earliestMinutes)
    : `${clock(req.earliestMinutes)}–${clock(req.latestMinutes)}`
}
