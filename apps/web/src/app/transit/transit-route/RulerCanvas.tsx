'use client'

import { useMemo, useState } from 'react'
import { DIR_COLOR, type RouteLocality, type TransitRoute } from './types'
import { StopGlyph } from './StopGlyph'
import { PointDetailModal } from './PointDetailModal'

interface Props {
  routes:          TransitRoute[]
  localities:      Record<string, RouteLocality[]>
  selectedRouteId: string | null
  onSelectRoute:   (id: string) => void
}

function RulerRow({ route, localities }: {
  route: TransitRoute
  localities: RouteLocality[]
}) {
  const color = DIR_COLOR[route.direction]
  const opacity = 1   // all fully visible in ruler
  const [detail, setDetail] = useState<{ rl: RouteLocality; position: number } | null>(null)

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
      <div className="flex items-center gap-3 px-4 py-3 rounded-sm" style={{ opacity }}>
        <span className="text-xs text-muted-foreground w-20 shrink-0">{route.name}</span>
        <span className="text-xs text-muted-foreground italic">Sem paradas cadastradas</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-4 rounded-sm" style={{ opacity }}>
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
            const label    = stop.locality?.abbr || stop.locality?.name?.split(' ')[0]
            return (
              <div
                key={stop.id}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
                style={{ left: `${pct}%` }}
                title={stop.locality?.name ?? `Seq ${stop.sequence}`}
                onClick={() => setDetail({ rl: stop, position: i })}
              >
                <div className="flex flex-col items-center">
                  <span className="text-[9px] leading-none text-muted-foreground mb-0.5">{i}</span>
                  <StopGlyph
                    kind={isOrigin ? 'origin' : isDest ? 'destination' : 'stop'}
                    color={color}
                    size={isOrigin || isDest ? 14 : 10}
                  />
                </div>
                {(isOrigin || isDest || stops.length <= 6) && (
                  <div
                    className="absolute top-6 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted-foreground max-w-16 truncate"
                    title={stop.locality?.name}
                  >
                    {label}
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

      {detail && (
        <PointDetailModal rl={detail.rl} position={detail.position} onClose={() => setDetail(null)} />
      )}
    </>
  )
}

export function RulerCanvas({ routes, localities }: Props) {
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
        />
      ))}
    </div>
  )
}
