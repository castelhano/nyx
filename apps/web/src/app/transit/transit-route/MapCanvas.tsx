'use client'

import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Marker, useMapEvents } from 'react-leaflet'
import type { Map as LeafletMap, LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DIR_COLOR, getCoord, type PendingPoint, type RouteLocality, type TransitRoute } from './types'
import { stopGlyphMarkup } from './StopGlyph'

// Leaflet icons broken in webpack — fix the default icon
import L from 'leaflet'
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ─── Map click capture ──────────────────────────────────────────────────────
function ClickCapture({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onMapClick?.(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// ─── Props ──────────────────────────────────────────────────────────────────
interface Props {
  routes:          TransitRoute[]
  localities:      Record<string, RouteLocality[]>
  selectedRouteId: string | null
  pendingPoints:   PendingPoint[]
  addPointMode:    boolean
  onMapClick?:     (lat: number, lng: number) => void
  onSelectRoute:   (id: string) => void
}

const CUIABA_CENTER: [number, number] = [-15.601, -56.097]

export default function MapCanvas({
  routes, localities, selectedRouteId, pendingPoints, addPointMode, onMapClick, onSelectRoute,
}: Props) {
  const mapRef = useRef<LeafletMap | null>(null)
  const [, forceRender] = useState(0)

  // fit bounds to selected route when it changes
  useEffect(() => {
    if (!selectedRouteId || !mapRef.current) return
    const lls = localities[selectedRouteId] ?? []
    const coords: [number, number][] = []
    for (const rl of lls) {
      const c = getCoord(rl)
      if (c) coords.push([c.lat, c.lng])
    }
    if (coords.length >= 2) {
      mapRef.current.fitBounds(coords as [number, number][], { padding: [40, 40] })
    }
  }, [selectedRouteId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`flex-1 relative ${addPointMode ? 'cursor-crosshair' : ''}`}>
      <MapContainer
        center={CUIABA_CENTER}
        zoom={12}
        className="w-full h-full"
        ref={mapRef as any}
        whenReady={() => forceRender((n) => n + 1)}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ClickCapture onMapClick={addPointMode ? onMapClick : undefined} />

        {routes.map((route) => {
          const lls      = localities[route.id] ?? []
          const isSelected = route.id === selectedRouteId
          const color    = DIR_COLOR[route.direction]
          const opacity  = selectedRouteId ? (isSelected ? 1 : 0.3) : 0.8

          // collect leg geometries, keeping the owning RouteLocality so we can key by it
          const legs = lls.filter((rl) => rl.geometry != null)

          return (
            <span key={route.id}>
              {legs.map((rl) => (
                <GeoJSON
                  // react-leaflet's GeoJSON only builds the layer once at mount and never
                  // diffs the `data` prop on re-render — key by updatedAt so a changed
                  // geometry (after Gravar/Reprocessar) forces a remount instead of showing stale shape
                  key={`${rl.id}-${rl.updatedAt}`}
                  data={rl.geometry as any}
                  style={{ color, weight: isSelected ? 4 : 2, opacity }}
                  eventHandlers={{ click: () => onSelectRoute(route.id) }}
                />
              ))}

              {lls.map((rl) => {
                const c = getCoord(rl)
                if (!c) return null
                const isWaypoint    = rl.localityId === null
                const isOrigin      = rl.localityId === route.originLocalityId
                const isDestination = rl.localityId === route.destinationLocalityId

                if (isOrigin || isDestination) {
                  return (
                    <Marker
                      key={rl.id}
                      position={[c.lat, c.lng]}
                      opacity={opacity}
                      icon={L.divIcon({
                        html:       stopGlyphMarkup(isOrigin ? 'origin' : 'destination', color, 18),
                        className:  '',
                        iconSize:   [18, 18],
                        iconAnchor: [9, 9],
                      })}
                      eventHandlers={{ click: () => onSelectRoute(route.id) }}
                    />
                  )
                }

                return (
                  <CircleMarker
                    key={rl.id}
                    center={[c.lat, c.lng]}
                    radius={isWaypoint ? 3 : 5}
                    pathOptions={{
                      color:       isWaypoint ? '#94a3b8' : color,
                      fillColor:   isWaypoint ? '#94a3b8' : color,
                      fillOpacity: opacity,
                      opacity,
                      weight:      isWaypoint ? 1 : 2,
                      dashArray:   isWaypoint ? '3,3' : undefined,
                    }}
                    eventHandlers={{ click: () => onSelectRoute(route.id) }}
                  >
                  </CircleMarker>
                )
              })}
            </span>
          )
        })}

        {/* pending points — shown outside the line */}
        {pendingPoints.map((p) => (
          <CircleMarker
            key={p._pendingId}
            center={[p.lat, p.lng]}
            radius={6}
            pathOptions={{
              color:       '#f59e0b',
              fillColor:   '#f59e0b',
              fillOpacity: 0.6,
              weight:      2,
              dashArray:   '4,4',
            }}
          />
        ))}
      </MapContainer>

      {addPointMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-background/90 border border-border rounded-sm px-3 py-1.5 text-xs shadow-md">
          Clique no mapa para posicionar o ponto
        </div>
      )}
    </div>
  )
}
