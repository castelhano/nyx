import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import {
  checkServiceRequirements,
  routeStopFractions,
  serviceRequirementWindowText,
  type RouteStopLike,
} from '@nyx/schemas'
import { useLineServiceRequirements, type ServiceRequirementRecord } from '../../use-line-service-requirements'

export interface ScheduleRequirementsResult {
  // departure id → "Saída E.E. Fulano (17:00–17:15)" for each Marco it covers
  departureLabels: Map<string, string[]>
  uncovered:       ServiceRequirementRecord[]
  isLoading:       boolean
}

const EMPTY: ScheduleRequirementsResult = { departureLabels: new Map(), uncovered: [], isLoading: false }

/** The OSO's departures (as edited, deleted ones left out) against the line's Marcos for the
 *  OSO's day type — notification only, never blocks saving/approving.
 *  A departure has no arrival of its own: estimated from the route's legs (sum of
 *  deltaMinutes), same as LineScheduleService.approve. */
export function useScheduleRequirements(
  lineId:     string | null | undefined,
  dayTypeId:  string | null | undefined,
  departures: { id: string; routeId: string; departureMinutes: number }[],
  routes:     { id: string; direction: string }[],
): ScheduleRequirementsResult {
  const reqQuery = useLineServiceRequirements(dayTypeId)
  const requirements = useMemo(
    () => (reqQuery.data ?? []).filter(r => r.lineId === lineId),
    [reqQuery.data, lineId],
  )

  // every route is needed (not only for Marcos pinned to a stop) — the arrival estimate
  const routeIds = useMemo(() => (requirements.length ? routes.map(r => r.id).sort() : []), [requirements, routes])
  const stopQueries = useQueries({
    queries: routeIds.map(routeId => ({
      queryKey: ['transit', 'route-locality', 'by-route', routeId],
      queryFn:  async (): Promise<RouteStopLike[]> => {
        const res = await apiFetch(`/transit/route-locality?routeId=${routeId}&pageSize=999`)
        if (!res.ok) return []
        return (await res.json()).data ?? []
      },
    })),
  })

  const isLoading   = reqQuery.isLoading || stopQueries.some(q => q.isLoading)
  const stopsSignal = stopQueries.map(q => q.dataUpdatedAt ?? 0).join(':')

  return useMemo(() => {
    if (!lineId || !dayTypeId) return EMPTY
    if (isLoading) return { ...EMPTY, isLoading: true }
    if (requirements.length === 0) return EMPTY

    const stops        = new Map(routeIds.map((id, i) => [id, stopQueries[i].data ?? []]))
    const stopsByRoute = new Map([...stops].map(([id, list]) => [id, routeStopFractions(list)]))
    const duration     = (routeId: string) => (stops.get(routeId) ?? []).reduce((sum, s) => sum + (s.deltaMinutes ?? 0), 0)
    const directionOf  = new Map(routes.map(r => [r.id, r.direction]))

    const trips = departures.map(d => ({
      id:               d.id,
      lineId,
      direction:        directionOf.get(d.routeId) ?? '',
      routeId:          d.routeId,
      departureMinutes: d.departureMinutes,
      arrivalMinutes:   d.departureMinutes + duration(d.routeId),
    }))
    const { coveredBy, tripRequirements } = checkServiceRequirements(requirements, trips, stopsByRoute)

    const byId = new Map(requirements.map(r => [r.id, r]))
    const departureLabels = new Map<string, string[]>()
    for (const [depId, reqIds] of tripRequirements) {
      departureLabels.set(depId, reqIds.map(id => `${byId.get(id)!.label} (${serviceRequirementWindowText(byId.get(id)!)})`))
    }
    const uncovered = requirements.filter(r => (coveredBy.get(r.id) ?? []).length === 0)
    return { departureLabels, uncovered, isLoading: false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopQueries is re-created each render; stopsSignal proxies its contents
  }, [lineId, dayTypeId, isLoading, requirements, departures, routes, routeIds, stopsSignal])
}
