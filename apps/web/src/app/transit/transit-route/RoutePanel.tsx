'use client'

import { useState } from 'react'
import { useQuery }  from '@tanstack/react-query'
import { Icons }     from '@/lib/icons'
import { apiFetch }  from '@/lib/auth'
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown'
import { DIR_LABEL, DIR_COLOR, type TransitRoute, type RouteLocality } from './types'

interface Props {
  routes:          TransitRoute[]
  selectedRouteId: string | null
  onSelect:        (id: string) => void
  onAddRoute:      () => void
  onEdit:          (route: TransitRoute) => void
  onTogglePrimary: (route: TransitRoute) => void
  onToggleActive:  (route: TransitRoute) => void
}

export function RoutePanel({ routes, selectedRouteId, onSelect, onAddRoute, onEdit, onTogglePrimary, onToggleActive }: Props) {
  const activeRoutes   = routes.filter((r) => r.isActive)
  const inactiveRoutes = routes.filter((r) => !r.isActive)

  return (
    <aside className="w-56 shrink-0 border-r border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sentidos</span>
        <button
          type="button"
          onClick={onAddRoute}
          className="h-6 w-6 rounded-sm flex items-center justify-center hover:bg-muted transition-colors"
          title="Novo sentido"
        >
          <Icons.Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {routes.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            Nenhum sentido cadastrado
          </div>
        ) : (
          <>
            {activeRoutes.map((route) => (
              <RouteRow
                key={route.id}
                route={route}
                selected={route.id === selectedRouteId}
                onSelect={onSelect}
                onEdit={onEdit}
                onTogglePrimary={onTogglePrimary}
                onToggleActive={onToggleActive}
              />
            ))}

            {inactiveRoutes.length > 0 && (
              <div className="px-3 py-1.5 flex items-center gap-2">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Inativos</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}

            {inactiveRoutes.map((route) => (
              <RouteRow
                key={route.id}
                route={route}
                selected={route.id === selectedRouteId}
                muted
                onSelect={onSelect}
                onEdit={onEdit}
                onTogglePrimary={onTogglePrimary}
                onToggleActive={onToggleActive}
              />
            ))}
          </>
        )}
      </div>
    </aside>
  )
}

interface RouteRowProps {
  route:           TransitRoute
  selected:        boolean
  muted?:          boolean
  onSelect:        (id: string) => void
  onEdit:          (route: TransitRoute) => void
  onTogglePrimary: (route: TransitRoute) => void
  onToggleActive:  (route: TransitRoute) => void
}

function RouteRow({ route, selected, muted, onSelect, onEdit, onTogglePrimary, onToggleActive }: RouteRowProps) {
  const [detailsLoaded, setDetailsLoaded] = useState(false)

  const { data: localities } = useQuery<RouteLocality[]>({
    queryKey: ['transit', 'trajectory', route.id],
    queryFn:  () => apiFetch(`/transit/transit-route/${route.id}/trajectory`).then((r) => r.json()),
    enabled:  detailsLoaded,
    staleTime: 30_000,
  })

  const totalPoints = localities?.length
  const extensionKm = localities?.reduce((sum, rl) => sum + (rl.deltaKm ?? 0), 0)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(route.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(route.id) } }}
      className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-muted cursor-pointer ${
        selected ? 'bg-muted' : ''
      } ${muted ? 'opacity-50' : ''}`}
    >
      <span
        className="mt-1 w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: DIR_COLOR[route.direction] }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {DIR_LABEL[route.direction]}
          {route.isPrimary && (
            <span title="Sentido principal" className="shrink-0 leading-none">
              <Icons.CheckCheck className="w-3 h-3 text-amber-500" />
            </span>
          )}
        </div>
        <div className="text-sm truncate">{route.name}</div>
      </div>

      <div onClick={(e) => e.stopPropagation()} className="-mt-0.5 -mr-1 shrink-0">
        <Dropdown
          side="right"
          align="start"
          trigger={
            <button
              type="button"
              onClick={() => setDetailsLoaded(true)}
              title="Opções do sentido"
              className="p-1.5 rounded-sm hover:bg-background/80"
            >
              <Icons.EllipsisVertical className="w-3.5 h-3.5 text-muted-foreground/60" />
            </button>
          }
        >
          <DropdownLabel>
            <div className="space-y-0.5">
              <div className="font-medium text-foreground">{route.name}</div>
              <div>
                {totalPoints != null ? `${totalPoints} pontos` : 'Carregando…'}
                {extensionKm != null ? ` · ${extensionKm.toFixed(1)} km` : ''}
              </div>
            </div>
          </DropdownLabel>
          <DropdownSeparator />
          <DropdownItem onClick={() => onEdit(route)}>
            <Icons.Pencil className="w-3.5 h-3.5" />
            Editar
          </DropdownItem>
          <DropdownItem onClick={() => onTogglePrimary(route)}>
            <Icons.CheckCheck className={`w-3.5 h-3.5 ${route.isPrimary ? 'text-amber-500' : ''}`} />
            Principal
          </DropdownItem>
          <DropdownItem onClick={() => onToggleActive(route)}>
            {route.isActive ? <Icons.Ban className="w-3.5 h-3.5" /> : <Icons.CheckCircle className="w-3.5 h-3.5" />}
            {route.isActive ? 'Inativar' : 'Ativar'}
          </DropdownItem>
        </Dropdown>
      </div>
    </div>
  )
}
