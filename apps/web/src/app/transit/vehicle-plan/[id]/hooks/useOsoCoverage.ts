import { useQueries } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import { computeOsoCoverage, type OsoDepartureLike } from '../oso-coverage-logic'
import type { VehiclePlanGanttData } from '../views/vehicles.view'

export interface OsoLineDeparture extends OsoDepartureLike {
  id:                   string
  requiredVehicleType?: string | null
}

export interface OsoLineCoverage {
  lineId:     string
  departures: OsoLineDeparture[]
  matchedTripIds: Set<string>
  extraTripIds:   Set<string>
  missing:        OsoLineDeparture[]
}

interface UseOsoCoverageResult {
  offScheduleTripIds: Set<string>
  coverageByLine:     Map<string, OsoLineCoverage>
  isLoading:          boolean
}

const EMPTY: UseOsoCoverageResult = {
  offScheduleTripIds: new Set(),
  coverageByLine:     new Map(),
  isLoading:          false,
}

/** Fetches OSO/LineSchedule departures only for lines currently flagged
 *  isDrifted, and compares them against the line's current trips in `data` to
 *  derive per-trip/per-line coverage — gated to drifted lines since that's the
 *  only case where the comparison can disagree with what's on screen. */
export function useOsoCoverage(data: VehiclePlanGanttData | null): UseOsoCoverageResult {
  const driftedLines = (data?.plan.lines ?? []).filter(l => l.isDrifted && l.lineScheduleId)

  const queries = useQueries({
    queries: driftedLines.map(l => ({
      queryKey: ['transit', 'line-departure', 'by-schedule', l.lineScheduleId],
      queryFn:  async (): Promise<OsoLineDeparture[]> => {
        const res = await apiFetch(`/transit/line-departure?lineScheduleId=${l.lineScheduleId}&pageSize=999`)
        if (!res.ok) return []
        const json = await res.json()
        return json.data ?? []
      },
      staleTime: 30_000,
    })),
  })

  if (!data || driftedLines.length === 0) return EMPTY

  const offScheduleTripIds = new Set<string>()
  const coverageByLine     = new Map<string, OsoLineCoverage>()

  driftedLines.forEach((line, i) => {
    const departures = queries[i].data
    if (!departures) return

    const trips = data.blocks
      .flatMap(b => b.blockTrips)
      .filter(bt => bt.trip.route.line.id === line.lineId)
      .map(bt => ({ id: bt.trip.id, routeId: bt.trip.routeId, departureMinutes: bt.trip.departureMinutes }))

    const { matchedTripIds, extraTripIds, missing } = computeOsoCoverage(departures, trips)
    for (const id of extraTripIds) offScheduleTripIds.add(id)

    coverageByLine.set(line.lineId, { lineId: line.lineId, departures, matchedTripIds, extraTripIds, missing })
  })

  return {
    offScheduleTripIds,
    coverageByLine,
    isLoading: queries.some(q => q.isLoading),
  }
}
