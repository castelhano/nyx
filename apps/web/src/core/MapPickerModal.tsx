'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import type { Map as LeafletMap, LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/auth'
import { Icons } from '@/lib/icons'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'

// Leaflet icons broken in webpack — fix the default icon
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const DEFAULT_CENTER: [number, number] = [-15.601, -56.097]

interface GeocodeResult {
  displayName: string
  lat:         number
  lng:         number
}

interface Props {
  initialLat?: number | null
  initialLng?: number | null
  onConfirm:   (lat: number, lng: number) => void
  onClose:     () => void
}

function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function MapPickerModal({ initialLat, initialLng, onConfirm, onClose }: Props) {
  const hasInitial = initialLat != null && initialLng != null
  const mapRef      = useRef<LeafletMap | null>(null)
  const inputRef     = useRef<HTMLInputElement>(null)

  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [picked,    setPicked]    = useState<{ lat: number; lng: number } | null>(
    hasInitial ? { lat: initialLat!, lng: initialLng! } : null,
  )

  useShortcutContext('map_picker_md')
  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSearch() {
    const q = query.trim()
    if (q.length < 3) return
    setSearching(true)
    try {
      const res = await apiFetch(`/transit/transit-locality/geocode?q=${encodeURIComponent(q)}`)
      const data = await res.json() as { results: GeocodeResult[] }
      setResults(data.results ?? [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  function pickResult(r: GeocodeResult) {
    setPicked({ lat: r.lat, lng: r.lng })
    setResults([])
    setQuery(r.displayName)
    mapRef.current?.flyTo([r.lat, r.lng], 16)
  }

  function pickFromMap(lat: number, lng: number) {
    setPicked({ lat, lng })
  }

  function handleConfirm() {
    if (!picked) return
    onConfirm(picked.lat, picked.lng)
    onClose()
  }

  useShortcut('alt+g', handleConfirm, {
    desc:    'Confirmar coordenadas',
    icon:    Icons.Save,
    context: 'map_picker_md',
    origin:  'apps/web/src/core/MapPickerModal.tsx',
    enabled: !!picked,
  })

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl mx-4 bg-card border border-border rounded-lg shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Selecionar no mapa</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border relative">
          {/* plain div, not <form> — this modal is portalled into <body>, but React
              still bubbles synthetic events through the *component* tree, so a nested
              <form onSubmit> here would also trigger AutoForm's onSubmit up the React
              tree despite living outside it in the DOM */}
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch() } }}
              placeholder="Buscar endereço…"
              className="w-full h-9 pl-9 pr-20 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || query.trim().length < 3}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6.5 px-2.5 text-xs rounded-sm bg-accent text-accent-foreground hover:bg-accent/80 disabled:opacity-50 disabled:pointer-events-none"
            >
              {searching ? 'Buscando…' : 'Buscar'}
            </button>
          </div>

          {results.length > 0 && (
            <div className="absolute left-5 right-5 top-full mt-1 z-[1002] bg-card border border-border rounded-sm shadow-lg max-h-56 overflow-auto">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickResult(r)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors border-b border-border last:border-0"
                >
                  {r.displayName}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-[420px] relative">
          <MapContainer
            center={hasInitial ? [initialLat!, initialLng!] : DEFAULT_CENTER}
            zoom={hasInitial ? 16 : 12}
            className="w-full h-full"
            ref={mapRef as any}
            whenReady={() => setTimeout(() => mapRef.current?.invalidateSize(), 0)}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickCapture onPick={pickFromMap} />
            {picked && <Marker position={[picked.lat, picked.lng]} />}
          </MapContainer>

          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] bg-background/90 border border-border rounded-sm px-3 py-1.5 text-xs shadow-md">
            Clique no mapa ou busque um endereço acima
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-border">
          <span className="text-xs text-muted-foreground font-mono">
            {picked ? `${picked.lat.toFixed(6)}, ${picked.lng.toFixed(6)}` : 'Nenhum ponto selecionado'}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="cancel" size="sm" onClick={onClose}>Cancelar</Button>
            <Button type="button" size="sm" onClick={handleConfirm} disabled={!picked}>Confirmar</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
