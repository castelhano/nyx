'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Marker, Polyline, Tooltip, Popup, useMapEvents } from 'react-leaflet'
import type { Map as LeafletMap, LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DIR_COLOR, DIR_LABEL, DIR_MARK_COLOR, REPOSITION_COLOR, SUGGEST_COLOR, getCoord, type PendingPoint, type RouteLocality, type SuggestedLocality, type TransitRoute } from './types'
import { stopGlyphMarkup } from './StopGlyph'
import { PointDetails } from './PointDetails'
import { DirectionArrows } from './DirectionArrows'
import { Dropdown, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown'
import { Icons } from '@/lib/icons'

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

// ─── Ruler ──────────────────────────────────────────────────────────────────
const RULER_COLOR = '#0ea5e9'

function RulerLayer({ onPoint }: { onPoint: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      L.DomEvent.stop(e)
      onPoint(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

// ─── Props ──────────────────────────────────────────────────────────────────
interface Props {
  routes:              TransitRoute[]
  localities:          Record<string, RouteLocality[]>
  selectedRouteId:     string | null
  pendingPoints:       PendingPoint[]
  suggestions:         SuggestedLocality[] | null
  addPointMode:        boolean
  repositionKey:       string | null   // RouteLocality.id or pending._pendingId awaiting a destination click
  hiddenRouteIds:      Set<string>
  onMapClick?:         (lat: number, lng: number) => void
  onSelectRoute:       (id: string) => void
  onSelectForReposition: (key: string) => void
  onAddPointClick?:    () => void
  onSuggestionClick?: (s: SuggestedLocality) => void
  onToggleRouteVisibility: (id: string) => void
}

const CUIABA_CENTER: [number, number] = [-15.601, -56.097]

export default function MapCanvas({
  routes, localities, selectedRouteId, pendingPoints, suggestions, addPointMode, repositionKey, hiddenRouteIds,
  onMapClick, onSelectRoute, onSelectForReposition, onAddPointClick, onSuggestionClick, onToggleRouteVisibility,
}: Props) {
  const awaitingDestination = repositionKey != null
  const mapRef = useRef<LeafletMap | null>(null)
  const [, forceRender] = useState(0)

  const [rulerActive, setRulerActive] = useState(false)
  const [rulerPoints, setRulerPoints] = useState<{ lat: number; lng: number }[]>([])

  function toggleRuler() {
    setRulerActive((prev) => !prev)
    setRulerPoints([])
  }

  function addRulerPoint(lat: number, lng: number) {
    setRulerPoints((prev) => [...prev, { lat, lng }])
  }

  const rulerTotalM = useMemo(() => {
    let total = 0
    for (let i = 1; i < rulerPoints.length; i++) {
      total += L.latLng(rulerPoints[i - 1]).distanceTo(L.latLng(rulerPoints[i]))
    }
    return total
  }, [rulerPoints])

  // Esc exits ruler mode (mirrors the addPointMode/reposition Esc handling in the parent page)
  useEffect(() => {
    if (!rulerActive) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setRulerActive(false); setRulerPoints([]) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rulerActive])

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
    <div className={`flex-1 relative isolate ${addPointMode || awaitingDestination || rulerActive ? 'cursor-crosshair' : ''}`}>
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

        <ClickCapture onMapClick={addPointMode || awaitingDestination ? onMapClick : undefined} />
        {rulerActive && <RulerLayer onPoint={addRulerPoint} />}

        {routes.map((route) => {
          const isSelected = route.id === selectedRouteId
          if (hiddenRouteIds.has(route.id) && !isSelected) return null

          const lls      = localities[route.id] ?? []
          const color     = DIR_COLOR[route.direction]
          const markColor = DIR_MARK_COLOR[route.direction]
          const opacity   = selectedRouteId ? (isSelected ? 1 : 0.6) : 0.8

          // collect leg geometries, keeping the owning RouteLocality so we can key by it
          const legs = lls.filter((rl) => rl.geometry != null)

          // sequence number shown next to each point is its 0-indexed position among
          // ALL points on the route (origin = 0) — stops and waypoints share one
          // continuous numbering so it matches the route's real order
          const pointIndex = new Map(lls.map((rl, i) => [rl.id, i]))

          return (
            <span key={route.id}>
              {legs.map((rl) => (
                <span key={`${rl.id}-${rl.updatedAt}`}>
                  <GeoJSON
                    // react-leaflet's GeoJSON only builds the layer once at mount and never
                    // diffs the `data` prop on re-render — key by updatedAt so a changed
                    // geometry (after Gravar/Reprocessar) forces a remount instead of showing stale shape
                    data={rl.geometry as any}
                    style={{ color, weight: isSelected ? 4 : 3, opacity }}
                    eventHandlers={{ click: () => onSelectRoute(route.id) }}
                  />
                  <DirectionArrows coordinates={rl.geometry!.coordinates} color={markColor} opacity={opacity} />
                </span>
              ))}

              {lls.map((rl) => {
                const c = getCoord(rl)
                if (!c) return null
                const isWaypoint    = rl.localityId === null
                const isOrigin      = rl.localityId === route.originLocalityId
                const isDestination = rl.localityId === route.destinationLocalityId
                const position      = pointIndex.get(rl.id) ?? null
                const isPicked      = isSelected && rl.id === repositionKey

                // only the currently selected route's points are pickable —
                // other routes stay dimmed background context. dblclick stops
                // propagation so it doesn't also trigger the map's own
                // doubleClickZoom (see MapContainer default)
                const pickHandler = {
                  dblclick: (e: LeafletMouseEvent) => {
                    if (!isSelected) return
                    L.DomEvent.stop(e)
                    onSelectForReposition(rl.id)
                    e.target.closePopup()
                  },
                }

                if (isOrigin || isDestination) {
                  const size = isPicked ? 24 : 18
                  return (
                    <Marker
                      key={rl.id}
                      position={[c.lat, c.lng]}
                      opacity={opacity}
                      icon={L.divIcon({
                        html:       stopGlyphMarkup(isOrigin ? 'origin' : 'destination', isPicked ? REPOSITION_COLOR : markColor, size),
                        className:  isPicked ? 'animate-pulse' : '',
                        iconSize:   [size, size],
                        iconAnchor: [size / 2, size / 2],
                      })}
                      eventHandlers={pickHandler}
                    >
                      <Tooltip permanent direction="top" offset={[0, -10]} className="!py-0 !px-1 !text-[10px] !leading-tight">
                        {position}
                      </Tooltip>
                      <Popup><PointDetails rl={rl} position={position} /></Popup>
                    </Marker>
                  )
                }

                if (isWaypoint) {
                  const size = isPicked ? 20 : 14
                  return (
                    <Marker
                      key={rl.id}
                      position={[c.lat, c.lng]}
                      opacity={opacity}
                      icon={L.divIcon({
                        html:       stopGlyphMarkup('waypoint', isPicked ? REPOSITION_COLOR : markColor, size),
                        className:  isPicked ? 'animate-pulse' : '',
                        iconSize:   [size, size],
                        iconAnchor: [size / 2, size / 2],
                      })}
                      eventHandlers={pickHandler}
                    >
                      <Tooltip permanent direction="top" offset={[0, -8]} className="!py-0 !px-1 !text-[10px] !leading-tight">
                        {position}
                      </Tooltip>
                      <Popup><PointDetails rl={rl} position={position} /></Popup>
                    </Marker>
                  )
                }

                return (
                  <CircleMarker
                    key={rl.id}
                    center={[c.lat, c.lng]}
                    radius={isPicked ? 8 : 5}
                    pathOptions={{
                      color:       isPicked ? REPOSITION_COLOR : '#fff',
                      fillColor:   isPicked ? REPOSITION_COLOR : markColor,
                      fillOpacity: opacity,
                      opacity,
                      weight:      isPicked ? 3 : 2,
                      dashArray:   isPicked ? '3,3' : undefined,
                      className:   isPicked ? 'animate-pulse' : undefined,
                    }}
                    eventHandlers={pickHandler}
                  >
                    <Tooltip permanent direction="top" offset={[0, -6]} className="!py-0 !px-1 !text-[10px] !leading-tight">
                      {position}
                    </Tooltip>
                    <Popup><PointDetails rl={rl} position={position} /></Popup>
                  </CircleMarker>
                )
              })}
            </span>
          )
        })}

        {/* pending points — shown outside the line */}
        {pendingPoints.map((p) => {
          const isPicked = p._pendingId === repositionKey
          return (
            <CircleMarker
              key={p._pendingId}
              center={[p.lat, p.lng]}
              radius={isPicked ? 9 : 6}
              pathOptions={{
                color:       '#f59e0b',
                fillColor:   '#f59e0b',
                fillOpacity: 0.6,
                weight:      isPicked ? 3 : 2,
                dashArray:   '4,4',
                className:   isPicked ? 'animate-pulse' : undefined,
              }}
              eventHandlers={{
                dblclick: (e: LeafletMouseEvent) => {
                  L.DomEvent.stop(e)
                  onSelectForReposition(p._pendingId)
                },
              }}
            />
          )
        })}

        {/* suggested points — click to insert into the sequence */}
        {suggestions?.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            radius={7}
            pathOptions={{
              color:       SUGGEST_COLOR,
              fillColor:   SUGGEST_COLOR,
              fillOpacity: 0.55,
              weight:      2,
              dashArray:   '2,4',
            }}
            eventHandlers={{
              click: (e: LeafletMouseEvent) => {
                L.DomEvent.stop(e)
                onSuggestionClick?.(s)
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="!py-0 !px-1 !text-[10px] !leading-tight">
              {s.name} · {s.distanceM}m
            </Tooltip>
          </CircleMarker>
        ))}

        {/* ruler — dashed line + a marker per clicked point, running total shown in the badge below */}
        {rulerPoints.length > 0 && (
          <Polyline
            positions={rulerPoints.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: RULER_COLOR, weight: 2, dashArray: '6,6' }}
          />
        )}
        {rulerPoints.map((p, i) => (
          <CircleMarker
            key={i}
            center={[p.lat, p.lng]}
            radius={4}
            pathOptions={{ color: RULER_COLOR, fillColor: RULER_COLOR, fillOpacity: 1, weight: 2 }}
          />
        ))}
      </MapContainer>

      {/* single-slot status banner — priority: point placement > ruler > suggestions */}
      {(addPointMode || awaitingDestination) ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] bg-background/90 border border-border rounded-sm px-3 py-1.5 text-xs shadow-md">
          {awaitingDestination
            ? 'Clique no mapa para reposicionar o ponto selecionado (Esc cancela)'
            : 'Clique no mapa para posicionar o ponto'}
        </div>
      ) : rulerActive ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] bg-background/90 border border-border rounded-sm px-3 py-1.5 text-xs shadow-md flex items-center gap-2">
          <span>
            {rulerPoints.length === 0
              ? 'Clique no mapa para começar a medir (Esc cancela)'
              : `${formatDistance(rulerTotalM)} · clique para continuar`}
          </span>
          {rulerPoints.length > 0 && (
            <button type="button" title="Limpar régua" onClick={() => setRulerPoints([])} className="text-muted-foreground hover:text-foreground">
              <Icons.X className="w-3 h-3" />
            </button>
          )}
        </div>
      ) : suggestions != null && suggestions.length > 0 ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] bg-background/90 border border-border rounded-sm px-3 py-1.5 text-xs shadow-md">
          Clique num ponto sugerido para inseri-lo na sequência
        </div>
      ) : null}

      <div className="absolute top-3 right-3 z-[1001] flex flex-col gap-2">
        {onAddPointClick && (
          <button
            type="button"
            title="Apontar ponto no mapa (q m)"
            disabled={addPointMode || awaitingDestination || rulerActive}
            onClick={onAddPointClick}
            className={`w-8 h-8 flex items-center justify-center rounded-sm border border-border shadow-md transition-colors disabled:opacity-50 disabled:pointer-events-none ${addPointMode ? 'bg-accent text-accent-foreground' : 'bg-background/90 hover:bg-accent hover:text-accent-foreground'}`}
          >
            <Icons.MapPinPlus className="w-4 h-4" />
          </button>
        )}

        {routes.length > 0 && (
          <Dropdown
            side="bottom"
            align="end"
            trigger={
              <button
                type="button"
                title="Mostrar/ocultar sentidos"
                className="w-8 h-8 flex items-center justify-center rounded-sm border border-border shadow-md bg-background/90 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Icons.Eye className="w-4 h-4" />
              </button>
            }
          >
            <DropdownLabel>Sentidos no mapa</DropdownLabel>
            <DropdownSeparator />
            {routes.map((route) => {
              const isSelected = route.id === selectedRouteId
              const isHidden   = hiddenRouteIds.has(route.id) && !isSelected
              return (
                <button
                  key={route.id}
                  type="button"
                  disabled={isSelected}
                  title={isSelected ? 'Sentido selecionado — sempre visível' : undefined}
                  onClick={(e) => { e.stopPropagation(); onToggleRouteVisibility(route.id) }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isHidden
                    ? <Icons.EyeOff className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    : <Icons.Eye className="w-3.5 h-3.5 shrink-0" style={{ color: DIR_COLOR[route.direction] }} />}
                  <span className="flex-1 truncate">{route.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{DIR_LABEL[route.direction]}</span>
                </button>
              )
            })}
          </Dropdown>
        )}

        <button
          type="button"
          title="Medir distância no mapa"
          disabled={addPointMode || awaitingDestination}
          onClick={toggleRuler}
          className={`w-8 h-8 flex items-center justify-center rounded-sm border border-border shadow-md transition-colors disabled:opacity-50 disabled:pointer-events-none ${rulerActive ? 'bg-accent text-accent-foreground' : 'bg-background/90 hover:bg-accent hover:text-accent-foreground'}`}
        >
          <Icons.Ruler className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
