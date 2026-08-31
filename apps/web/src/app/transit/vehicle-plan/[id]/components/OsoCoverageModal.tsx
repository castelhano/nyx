'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { useShortcutContext } from '@/lib/keywatch'
import { DIRECTION_LABELS } from '../views/vehicles.view'
import type { GanttBlock } from '../views/vehicles.view'
import type { OsoLineCoverage } from '../hooks/useOsoCoverage'

interface RouteRow {
  id:                    string
  direction:             string
  originLocalityId:      string
  destinationLocalityId: string
}

interface LocalityRow {
  id:   string
  name: string
}

interface Props {
  lineId:    string
  lineCode:  string
  lineName:  string
  coverage:  OsoLineCoverage | undefined
  isLoading: boolean
  blocks:    GanttBlock[]
  onClose:   () => void
}

function formatMinute(m: number): string {
  const h   = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function OsoCoverageModal({ lineId, lineCode, lineName, coverage, isLoading, blocks, onClose }: Props) {
  useShortcutContext('oso_coverage_md')

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const { data: routes = [] } = useQuery<RouteRow[]>({
    queryKey: ['transit', 'transit-route', 'by-line', lineId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/transit-route?f_lineId=${lineId}&pageSize=999`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })

  const { data: localities = [] } = useQuery<LocalityRow[]>({
    queryKey: ['transit', 'transit-locality', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/transit-locality?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })

  const routeById    = new Map(routes.map(r => [r.id, r]))
  const localityById = new Map(localities.map(l => [l.id, l.name]))

  function describeRoute(routeId: string): string {
    const route = routeById.get(routeId)
    if (!route) return ''
    const dir   = DIRECTION_LABELS[route.direction] ?? route.direction
    const from  = localityById.get(route.originLocalityId)      ?? '?'
    const to    = localityById.get(route.destinationLocalityId) ?? '?'
    return `${dir} · ${from} → ${to}`
  }

  const extraTrips = coverage
    ? blocks
        .flatMap(b => b.blockTrips.map(bt => ({ ...bt, blockNumber: b.blockNumber })))
        .filter(bt => coverage.extraTripIds.has(bt.trip.id))
        .sort((a, b) => a.trip.departureMinutes - b.trip.departureMinutes)
    : []

  const missing = (coverage?.missing ?? []).slice().sort((a, b) => a.departureMinutes - b.departureMinutes)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Divergências da OSO</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono font-medium">{lineCode}</span> — {lineName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
          ) : (
            <>
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Fora da OSO ({extraTrips.length})
                </h3>
                {extraTrips.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma viagem fora da OSO vigente.</p>
                ) : (
                  <ul className="space-y-1">
                    {extraTrips.map(bt => (
                      <li key={bt.trip.id} className="flex items-center gap-2 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                        <span className="font-medium">{formatMinute(bt.trip.departureMinutes)}</span>
                        <span className="text-muted-foreground truncate">
                          {DIRECTION_LABELS[bt.trip.route.direction] ?? bt.trip.route.direction}
                          {' · '}{bt.trip.route.originLocality.name} → {bt.trip.route.destinationLocality.name}
                        </span>
                        <span className="text-muted-foreground/70 ms-auto shrink-0">Bloco {bt.blockNumber}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Faltando ({missing.length})
                </h3>
                {missing.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Todas as partidas aprovadas estão cobertas.</p>
                ) : (
                  <ul className="space-y-1">
                    {missing.map(d => (
                      <li key={d.id} className="flex items-center gap-2 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                        <span className="font-medium">{formatMinute(d.departureMinutes)}</span>
                        <span className="text-muted-foreground truncate">{describeRoute(d.routeId)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
