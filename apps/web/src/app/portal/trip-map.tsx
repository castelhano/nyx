'use client'

// A trip of his day on the map, full screen: the route's trajectory, its stops and where he takes /
// hands over the vehicle. Once he allows it, his position (and the straight-line distance to the
// point he's heading for); the screen stays on meanwhile where the browser allows it.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { PortalTripMap } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { portalFetch } from '@/lib/portal-auth'

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const ROUTE_COLOR = '#2563eb'
const RELIEF_COLOR = '#f59e0b'

type Position = { lat: number; lng: number; accuracy: number }
type Located = { status: 'asking' | 'on' } | { status: 'error'; message: string } | null

// meters between two points (haversine)
function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}
const meters = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)

export default function TripMap({ date, eventId, onClose }: { date: string; eventId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', 'roster', date, 'trip', eventId],
    queryFn:  () => portalFetch<PortalTripMap>(`/roster/${date}/trip/${eventId}/map`),
  })
  const [tracking, setTracking] = useState(false)
  const [located, setLocated] = useState<Located>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    if (!tracking) return
    const watch = navigator.geolocation.watchPosition(
      p => { setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); setLocated({ status: 'on' }) },
      e => {
        setTracking(false)
        setLocated({ status: 'error', message: e.code === e.PERMISSION_DENIED ? 'Localização bloqueada — libere nas permissões do navegador para este site' : 'Não foi possível obter sua posição' })
      },
      { enableHighAccuracy: true, maximumAge: 5_000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [tracking])

  // keep the screen on while showing his position (Wake Lock — not every browser has it)
  const on = located?.status === 'on'
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const acquire = () => { if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {}) }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => { document.removeEventListener('visibilitychange', acquire); void lock?.release() }
  }, [on])

  const locate = () => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setLocated({ status: 'error', message: 'Localização indisponível neste navegador (exige conexão segura)' })
      return
    }
    setFollow(true)
    setLocated({ status: 'asking' })
    setTracking(true)
  }

  // the point he's heading for: where he takes the vehicle, else where he hands it over / the end
  const destination = data?.stops.find(s => s.kind === 'DESTINATION')
  const target = data?.joins?.lat != null ? { ...data.joins, label: 'até onde assume' }
    : data?.leaves?.lat != null ? { ...data.leaves, label: 'até onde entrega' }
    : destination ? { ...destination, label: 'até o destino' } : null

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-2 py-3">
        <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-muted cursor-pointer" title="Voltar"><Icons.ArrowLeft className="h-5 w-5" /></button>
        {data && (
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{data.line} · {data.route}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {clock(data.start)}–{clock(data.end)}
              {data.joins && ` · assume ${clock(data.joins.minutes)} em ${data.joins.name}`}
              {data.leaves && ` · entrega ${clock(data.leaves.minutes)} em ${data.leaves.name}`}
            </p>
          </div>
        )}
      </header>

      <div className="relative isolate flex-1">
        {isLoading && <div className="flex h-full items-center justify-center"><Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {error && <p className="p-4 text-sm text-destructive">{error.message}</p>}
        {data && (data.path.length < 2 ? <p className="p-4 text-sm text-muted-foreground">Rota sem trajeto cadastrado.</p> : (
          <MapContainer center={[data.path[0][1], data.path[0][0]]} zoom={13} zoomControl={false} className="h-full w-full">
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Fit trip={data} position={follow ? position : null} onDrag={() => setFollow(false)} />
            <Polyline positions={data.path.map(([lng, lat]) => [lat, lng] as LatLngExpression)} pathOptions={{ color: ROUTE_COLOR, weight: 5, opacity: 0.8, dashArray: data.approximate ? '8 8' : undefined }} />
            {data.stops.map((s, i) => (
              <CircleMarker key={i} center={[s.lat, s.lng]} radius={s.kind === 'STOP' ? 4 : 8}
                pathOptions={{ color: '#fff', weight: 2, fillOpacity: 1, fillColor: s.kind === 'ORIGIN' ? '#16a34a' : s.kind === 'DESTINATION' ? '#dc2626' : ROUTE_COLOR }}>
                <Tooltip permanent={s.kind !== 'STOP'} direction="top" offset={[0, -6]}>{s.name}</Tooltip>
              </CircleMarker>
            ))}
            {[data.joins && { ...data.joins, verb: 'Assume' }, data.leaves && { ...data.leaves, verb: 'Entrega' }].map(p => p && p.lat != null && p.lng != null && (
              <CircleMarker key={p.verb} center={[p.lat, p.lng]} radius={10} pathOptions={{ color: '#fff', weight: 3, fillOpacity: 1, fillColor: RELIEF_COLOR }}>
                <Tooltip permanent direction="top" offset={[0, -8]}><b>{p.verb} {clock(p.minutes)}</b> · {p.name}</Tooltip>
              </CircleMarker>
            ))}
            {position && on && (
              <>
                <Circle center={[position.lat, position.lng]} radius={position.accuracy} pathOptions={{ color: '#0ea5e9', weight: 1, fillOpacity: 0.1 }} />
                <CircleMarker center={[position.lat, position.lng]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillOpacity: 1, fillColor: '#0ea5e9' }} />
              </>
            )}
          </MapContainer>
        ))}

        {data && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[1000] space-y-2">
            {data.approximate && <p className="pointer-events-auto rounded-lg bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow">Trajeto aproximado — parte da rota sem trajeto gerado.</p>}
            {located?.status === 'error' && <p className="pointer-events-auto rounded-lg bg-card/95 px-3 py-2 text-xs text-amber-700 shadow dark:text-amber-300">{located.message}</p>}
            <div className="flex items-end gap-2">
              {position && on && target && (
                <p className="pointer-events-auto me-auto rounded-lg bg-card/95 px-3 py-2 text-sm shadow">
                  <span className="font-semibold tabular-nums">{meters(distance(position, { lat: target.lat!, lng: target.lng! }))}</span>
                  <span className="text-muted-foreground"> {target.label} (em linha reta)</span>
                </p>
              )}
              <button type="button" onClick={on ? () => setFollow(true) : locate}
                className={cn('pointer-events-auto ms-auto flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-lg cursor-pointer', on && follow ? 'text-primary' : 'text-foreground')}
                title={on ? 'Centralizar na minha posição' : 'Mostrar minha posição'}>
                {located?.status === 'asking' ? <Icons.Loader2 className="h-5 w-5 animate-spin" /> : <Icons.MapPin className="h-5 w-5" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// fits the trip on open; then, while following, keeps his position in the center — dragging the
// map stops following
function Fit({ trip, position, onDrag }: { trip: PortalTripMap; position: Position | null; onDrag: () => void }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(trip.path.map(([lng, lat]) => [lat, lng]) as LatLngBoundsExpression, { padding: [40, 40] })
  }, [map, trip])
  useEffect(() => {
    if (position) map.setView([position.lat, position.lng], Math.max(map.getZoom(), 16))
  }, [map, position])
  useEffect(() => {
    map.on('dragstart', onDrag)
    return () => { map.off('dragstart', onDrag) }
  }, [map, onDrag])
  return null
}
