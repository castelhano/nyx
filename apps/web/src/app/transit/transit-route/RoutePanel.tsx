'use client'

import { Icons }    from '@/lib/icons'
import { DIR_LABEL, DIR_COLOR, type TransitRoute } from './types'

interface Props {
  routes:          TransitRoute[]
  selectedRouteId: string | null
  onSelect:        (id: string) => void
  onAddRoute:      () => void
  onTogglePrimary: (route: TransitRoute) => void
}

export function RoutePanel({ routes, selectedRouteId, onSelect, onAddRoute, onTogglePrimary }: Props) {
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
          routes.map((route) => (
            <div
              key={route.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(route.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(route.id) } }}
              className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-muted cursor-pointer ${
                route.id === selectedRouteId ? 'bg-muted' : ''
              }`}
            >
              <span
                className="mt-1 w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: DIR_COLOR[route.direction] }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-muted-foreground">{DIR_LABEL[route.direction]}</div>
                <div className="text-sm truncate">{route.name}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onTogglePrimary(route) }}
                title={route.isPrimary ? 'Sentido principal — extensão oficial da linha' : 'Definir como sentido principal'}
                className="mt-0.5 shrink-0 p-0.5 rounded-sm hover:bg-background/80"
              >
                <Icons.Star
                  className={`w-3.5 h-3.5 ${route.isPrimary ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40'}`}
                />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
