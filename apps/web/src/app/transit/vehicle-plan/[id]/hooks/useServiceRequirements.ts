import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import {
  checkServiceRequirements,
  routeStopFractions,
  serviceRequirementWindowText,
  type RouteStopLike,
  type ServiceRequirementLike,
  type ServiceRequirementTrip,
} from '@nyx/schemas'
import type { VehiclePlanGanttData } from '../views/vehicles.view'

export interface ServiceRequirementRecord extends ServiceRequirementLike {
  label:    string
  locality: { id: string; name: string } | null
}

export interface UncoveredRequirement {
  requirement: ServiceRequirementRecord
  lineCode:    string
}

interface UseServiceRequirementsResult {
  // trip id → "Saída E.E. Fulano (17:00–17:15)" for each requirement the trip covers
  tripLabels: Map<string, string[]>
  uncovered:  UncoveredRequirement[]
  isLoading:  boolean
}

const EMPTY_LABELS = new Map<string, string[]>()

/** Checks the plan's lines against their LineServiceRequirements for the plan's day type
 *  (docs/proposal/plan_line_service_requirement_v1.md). Covers the whole plan, not just the
 *  lines plotted in "Linhas": plotted lines are read from `merged` (pending edits included),
 *  every other line from the persisted `ganttData`. */
export function useServiceRequirements(
  ganttData:       VehiclePlanGanttData | null | undefined,
  merged:          VehiclePlanGanttData | null,
  selectedLineIds: Set<string>,
): UseServiceRequirementsResult {
  const dayTypeId = ganttData?.plan.dayType?.id ?? null

  const reqQuery = useQuery({
    queryKey: ['transit', 'line-service-requirement', 'by-day-type', dayTypeId],
    queryFn:  async (): Promise<ServiceRequirementRecord[]> => {
      const res = await apiFetch(`/transit/line-service-requirement?dayTypeId=${dayTypeId}&pageSize=999`)
      if (!res.ok) return []
      return (await res.json()).data ?? []
    },
    enabled:   !!dayTypeId,
    staleTime: 30_000,
  })

  const planLines = useMemo(
    () => new Map((ganttData?.plan.lines ?? []).filter(l => l.inPlan).map(l => [l.lineId, l.line.code])),
    [ganttData],
  )

  const requirements = useMemo(
    () => (reqQuery.data ?? []).filter(r => planLines.has(r.lineId)),
    [reqQuery.data, planLines],
  )

  const trips = useMemo<ServiceRequirementTrip[]>(() => {
    const toTrip = (bt: VehiclePlanGanttData['blocks'][number]['blockTrips'][number]): ServiceRequirementTrip => ({
      id:               bt.trip.id,
      lineId:           bt.trip.route.line.id,
      direction:        bt.trip.route.direction,
      routeId:          bt.trip.routeId,
      departureMinutes: bt.trip.departureMinutes,
      arrivalMinutes:   bt.trip.arrivalMinutes,
    })
    const plotted = (merged?.blocks ?? []).flatMap(b => b.blockTrips).filter(bt => selectedLineIds.has(bt.trip.route.line.id))
    const others  = (ganttData?.blocks ?? []).flatMap(b => b.blockTrips).filter(bt => !selectedLineIds.has(bt.trip.route.line.id))
    return [...plotted, ...others].map(toTrip)
  }, [ganttData, merged, selectedLineIds])

  // stops are only needed for requirements pinned to a locality, and only for the routes
  // actually run in that line+direction
  const routeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of requirements) {
      if (!r.localityId) continue
      for (const t of trips) if (t.lineId === r.lineId && t.direction === r.direction) ids.add(t.routeId)
    }
    return [...ids].sort()
  }, [requirements, trips])

  const stopQueries = useQueries({
    queries: routeIds.map(routeId => ({
      // same key as useDeltaGroups — shared cache
      queryKey: ['transit', 'route-locality', 'by-route', routeId],
      queryFn:  async (): Promise<RouteStopLike[]> => {
        const res = await apiFetch(`/transit/route-locality?routeId=${routeId}&pageSize=999`)
        if (!res.ok) return []
        return (await res.json()).data ?? []
      },
    })),
  })

  const isLoading = reqQuery.isLoading || stopQueries.some(q => q.isLoading)
  // see useOsoCoverage — keeps the memo (and its Map's identity) stable across renders that
  // don't change any of the fetched data
  const stopsSignal = stopQueries.map(q => q.dataUpdatedAt ?? 0).join(':')

  return useMemo(() => {
    if (!dayTypeId) return { tripLabels: EMPTY_LABELS, uncovered: [], isLoading: false }
    if (isLoading)  return { tripLabels: EMPTY_LABELS, uncovered: [], isLoading: true }

    const stopsByRoute = new Map(routeIds.map((id, i) => [id, routeStopFractions(stopQueries[i].data ?? [])]))
    const { coveredBy, tripRequirements } = checkServiceRequirements(requirements, trips, stopsByRoute)

    const byId = new Map(requirements.map(r => [r.id, r]))
    const tripLabels = new Map<string, string[]>()
    for (const [tripId, reqIds] of tripRequirements) {
      tripLabels.set(tripId, reqIds.map(id => {
        const r = byId.get(id)!
        return `${r.label} (${serviceRequirementWindowText(r)})`
      }))
    }

    const uncovered = requirements
      .filter(r => (coveredBy.get(r.id) ?? []).length === 0)
      .sort((a, b) => a.earliestMinutes - b.earliestMinutes)
      .map(r => ({ requirement: r, lineCode: planLines.get(r.lineId) ?? '' }))

    return { tripLabels, uncovered, isLoading: false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopQueries is re-created each render; stopsSignal proxies its contents
  }, [dayTypeId, isLoading, requirements, trips, routeIds, stopsSignal, planLines])
}
