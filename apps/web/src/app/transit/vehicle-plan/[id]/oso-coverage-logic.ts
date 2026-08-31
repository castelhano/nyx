// Pure computation for comparing a line's current plan trips against its pinned
// OSO/LineSchedule's approved LineDeparture rows — same value-based match
// (routeId + departureMinutes) as apps/api's recomputeLineDrift (see
// trip-mutation.utils.ts), just also keeping which side matched/missed instead
// of collapsing straight to a boolean, so the UI can point at what's off.

export interface OsoDepartureLike {
  routeId:          string
  departureMinutes: number
}

export interface OsoCoverageTrip extends OsoDepartureLike {
  id: string
}

export interface OsoCoverageResult<D extends OsoDepartureLike> {
  matchedTripIds: Set<string>
  extraTripIds:   Set<string>
  missing:        D[]
}

function key(x: OsoDepartureLike): string {
  return `${x.routeId}:${x.departureMinutes}`
}

/** `departures` = the OSO's approved LineDeparture rows. `trips` = the line's
 *  current trips in the plan (as rendered, pending edits included). */
export function computeOsoCoverage<D extends OsoDepartureLike>(
  departures: D[],
  trips:      OsoCoverageTrip[],
): OsoCoverageResult<D> {
  const matchedTripIds = new Set<string>()
  const extraTripIds   = new Set<string>()
  const coveredKeys    = new Set<string>()

  for (const t of trips) {
    const k = key(t)
    if (departures.some(d => key(d) === k)) {
      matchedTripIds.add(t.id)
      coveredKeys.add(k)
    } else {
      extraTripIds.add(t.id)
    }
  }

  const missing = departures.filter(d => !coveredKeys.has(key(d)))

  return { matchedTripIds, extraTripIds, missing }
}
