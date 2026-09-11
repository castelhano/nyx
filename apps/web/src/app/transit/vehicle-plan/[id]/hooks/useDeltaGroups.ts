import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import { getTravelTime } from '../travel-time'
import type { Direction } from '../line-generator-logic'
import { detectDeltaGroups, resolveGroupOffsets, type RouteLegRef, type DeltaGroup } from '../multiline-delta-logic'
import type { ResolvedDeltaGroup } from '../views/line-freq.view'

interface RouteRecord {
  id:                string
  direction:         Direction
  originLocalityId:  string
  isPrimary:         boolean
}

interface RouteLocalityRecord {
  localityId:   string | null
  sequence:     number
  deltaMinutes: number | null
  // BaseService auto-includes this relation (localityId's combobox widget has a
  // labelField) — free locality names, no extra fetch needed for the tooltip.
  locality?:    { id: string; name: string } | null
}

interface UseDeltaGroupsResult {
  groups:    ResolvedDeltaGroup[]
  isLoading: boolean
}

const EMPTY: UseDeltaGroupsResult = { groups: [], isLoading: false }

/** Resolves which delta groups (Fase 4) cover every one of the given lines —
 *  used by LineFreqPanel to decide whether a combined "Multilinha" view
 *  exists. A group only qualifies when its membership is the *entire* set of
 *  `lineIds`, never a subset — plotting one more unrelated line alongside a
 *  known pair drops the combined view rather than silently narrowing it. */
export function useDeltaGroups(lineIds: string[]): UseDeltaGroupsResult {
  const sortedIds = useMemo(() => [...lineIds].sort(), [lineIds])
  const enabled   = sortedIds.length >= 2

  const routesQueries = useQueries({
    queries: sortedIds.map(lineId => ({
      queryKey: ['transit', 'transit-route', 'by-line', lineId],
      queryFn:  async (): Promise<RouteRecord[]> => {
        const res = await apiFetch(`/transit/transit-route?f_lineId=${lineId}&pageSize=999`)
        if (!res.ok) return []
        const json = await res.json()
        return json.data ?? []
      },
      enabled,
    })),
  })

  // One primary route per direction per line (isPrimary preferred), same
  // convention LineScheduleGeneratorModal already relies on.
  const primaryRouteByLineDirection = useMemo(() => {
    const m = new Map<string, Map<Direction, RouteRecord>>()
    if (!enabled) return m
    routesQueries.forEach((q, i) => {
      const byDir = new Map<Direction, RouteRecord>()
      for (const r of q.data ?? []) {
        const existing = byDir.get(r.direction)
        if (!existing || (r.isPrimary && !existing.isPrimary)) byDir.set(r.direction, r)
      }
      m.set(sortedIds[i], byDir)
    })
    return m
  }, [enabled, sortedIds, routesQueries])

  const allRouteIds = useMemo(
    () => [...primaryRouteByLineDirection.values()].flatMap(byDir => [...byDir.values()].map(r => r.id)),
    [primaryRouteByLineDirection],
  )

  const routeLocalityQueries = useQueries({
    queries: allRouteIds.map(routeId => ({
      queryKey: ['transit', 'route-locality', 'by-route', routeId],
      queryFn:  async (): Promise<RouteLocalityRecord[]> => {
        // Bare `routeId=` — this field has no `filter: true` in route-locality.schema.ts
        // (it's the breadcrumb contextField instead), so `f_routeId=` is silently ignored.
        const res = await apiFetch(`/transit/route-locality?routeId=${routeId}&pageSize=999`)
        if (!res.ok) return []
        const json = await res.json()
        return json.data ?? []
      },
    })),
  })

  const localityNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const q of routeLocalityQueries) {
      for (const rl of q.data ?? []) {
        if (rl.localityId && rl.locality?.name) m.set(rl.localityId, rl.locality.name)
      }
    }
    return m
  }, [routeLocalityQueries])

  const legsByLineDirection = useMemo(() => {
    const legsByRouteId = new Map<string, RouteLegRef[]>()
    routeLocalityQueries.forEach((q, i) => {
      legsByRouteId.set(allRouteIds[i], (q.data ?? []).map(rl => ({
        localityId: rl.localityId, sequence: rl.sequence, deltaMinutes: rl.deltaMinutes,
      })))
    })

    const m = new Map<string, Partial<Record<Direction, RouteLegRef[]>>>()
    for (const lineId of sortedIds) {
      const perDir: Partial<Record<Direction, RouteLegRef[]>> = {}
      for (const [dir, route] of primaryRouteByLineDirection.get(lineId) ?? []) {
        const legs = legsByRouteId.get(route.id)
        if (legs) perDir[dir] = legs
      }
      m.set(lineId, perDir)
    }
    return m
  }, [sortedIds, primaryRouteByLineDirection, routeLocalityQueries, allRouteIds])

  const fullMembershipGroups = useMemo<DeltaGroup[]>(() => {
    if (!enabled) return []
    const wanted = new Set(sortedIds)
    return detectDeltaGroups(legsByLineDirection).filter(g =>
      g.lineIds.length === wanted.size && g.lineIds.every(id => wanted.has(id)),
    )
  }, [enabled, sortedIds, legsByLineDirection])

  const groupsKey = fullMembershipGroups.map(g => `${g.direction}:${g.deltaLocalityId}`).join('|')

  const offsetsQuery = useQuery({
    queryKey: ['transit', 'vehicle-plan', 'delta-group-offsets', groupsKey],
    queryFn:  async (): Promise<ResolvedDeltaGroup[]> => {
      const resolved: ResolvedDeltaGroup[] = []
      for (const group of fullMembershipGroups) {
        const offsetByLineId = await resolveGroupOffsets(
          group,
          legsByLineDirection,
          (lineId, direction) => primaryRouteByLineDirection.get(lineId)?.get(direction)?.originLocalityId ?? null,
          getTravelTime,
        )
        if (offsetByLineId.size === group.lineIds.length) {
          resolved.push({
            direction:         group.direction,
            lineIds:           group.lineIds,
            offsetByLineId,
            deltaLocalityId:   group.deltaLocalityId,
            deltaLocalityName: localityNameById.get(group.deltaLocalityId) ?? '?',
          })
        }
      }
      return resolved
    },
    enabled:   fullMembershipGroups.length > 0,
    staleTime: 60_000,
  })

  if (!enabled) return EMPTY
  return { groups: offsetsQuery.data ?? [], isLoading: offsetsQuery.isLoading }
}
