'use client'

import { useMemo } from 'react'
import { DIR_COLOR, type RouteLocality, type TransitRoute } from './types'

interface Props {
  routes:          TransitRoute[]
  localities:      Record<string, RouteLocality[]>
  selectedRouteId: string | null
  onSelectRoute:   (id: string) => void
}

function RulerRow({ route, localities, isSelected, onClick }: {
  route: TransitRoute
  localities: RouteLocality[]
  isSelected: boolean
  onClick: () => void
}) {
  const color = DIR_COLOR[route.direction]
  const opacity = isSelected || !isSelected ? 1 : 0.4   // all fully visible in ruler

  // Only bus stops (localityId != null) appear in the ruler
  const stops = localities.filter((rl) => rl.localityId !== null)

  // compute cumulative km for proportional distribution
  const totalKm = stops.reduce((acc, rl) => acc + (rl.deltaKm ?? 0), 0)
  const hasRealDistances = totalKm > 0

  const positions: number[] = useMemo(() => {
    if (!hasRealDistances || stops.length === 0) {
      return stops.map((_, i) => (i / Math.max(stops.length - 1, 1)) * 100)
    }
    const positions: number[] = [0]
    let cum = 0
    for (let i = 1; i < stops.length; i++) {
      cum += stops[i].deltaKm ?? 0
      positions.push(totalKm > 0 ? (cum / totalKm) * 100 : (i / (stops.length - 1)) * 100)
    }
    return positions
  }, [stops, hasRealDistances, totalKm])

  if (stops.length === 0) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-sm cursor-pointer hover:bg-muted/50 transition-colors"
        style={{ opacity }}
        onClick={onClick}
      >
        <span className="text-xs text-muted-foreground w-20 shrink-0">{route.name}</span>
        <span className="text-xs text-muted-foreground italic">Sem paradas cadastradas</span>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-sm"
      style={{ opacity }}
      onClick={onClick}
    >
      <span className="text-xs font-medium text-muted-foreground w-20 shrink-0 truncate">{route.name}</span>

      <div className="relative flex-1 h-10">
        {/* track line */}
        <div
          className="absolute top-1/2 left-0 right-0 h-0.5 -translate-y-1/2 rounded-full"
          style={{ backgroundColor: color, opacity: 0.4 }}
        />

        {stops.map((stop, i) => {
          const pct = positions[i]
          const isOrigin = i === 0
          const isDest   = i === stops.length - 1
          return (
            <div
              key={stop.id}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${pct}%` }}
              title={stop.locality?.name ?? `Seq ${stop.sequence}`}
            >
              {isOrigin || isDest ? (
                <div
                  className="w-3 h-3 rounded-full border-2 border-background"
                  style={{ backgroundColor: color }}
                />
              ) : (
                <div
                  className="w-2 h-2 rounded-full border border-background"
                  style={{ backgroundColor: color }}
                />
              )}
              {(isOrigin || isDest || stops.length <= 6) && (
                <div
                  className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted-foreground max-w-16 truncate"
                  title={stop.locality?.name}
                >
                  {stop.locality?.name?.split(' ')[0]}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!hasRealDistances && (
        <span className="text-[10px] text-muted-foreground shrink-0 italic">distribuição estimada</span>
      )}
    </div>
  )
}

export function RulerCanvas({ routes, localities, selectedRouteId, onSelectRoute }: Props) {
  if (routes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Nenhum sentido cadastrado. Clique em <strong className="mx-1">+</strong> para adicionar.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {routes.map((route) => (
        <RulerRow
          key={route.id}
          route={route}
          localities={localities[route.id] ?? []}
          isSelected={route.id === selectedRouteId}
          onClick={() => onSelectRoute(route.id)}
        />
      ))}
    </div>
  )
}
