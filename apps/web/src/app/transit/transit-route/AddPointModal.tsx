'use client'

import { useState, useEffect }  from 'react'
import { Button }               from '@/components/ui/button'
import { useFieldOptions }      from '@/core/useFieldOptions'
import { apiFetch }        from '@/lib/auth'
import type { PendingPoint, RouteLocality } from './types'

interface Props {
  localities: RouteLocality[]
  prefillLat?: number
  prefillLng?: number
  prefillName?: string
  onAdd:    (point: PendingPoint) => void
  onClose:  () => void
}

type Mode = 'stop' | 'waypoint'

export function AddPointModal({ localities, prefillLat, prefillLng, prefillName, onAdd, onClose }: Props) {
  const [mode,       setMode]       = useState<Mode>('stop')
  const [localityId, setLocalityId] = useState('')
  const [latStr,     setLatStr]     = useState(prefillLat?.toFixed(6) ?? '')
  const [lngStr,     setLngStr]     = useState(prefillLng?.toFixed(6) ?? '')
  const [name,       setName]       = useState(prefillName ?? '')
  const [afterSeq,   setAfterSeq]   = useState<number>(() => {
    const last = localities.at(-1)
    return last ? last.sequence - 1 : 0
  })
  const [snapping,   setSnapping]   = useState(false)

  const { options: rawLocalities } = useFieldOptions({ resource: 'transit-locality', domain: 'transit' })
  const localityOptions = rawLocalities.map((o) => ({ value: String(o.id ?? ''), label: String(o.name ?? '') }))

  // when lat/lng are prefilled from map click, try to snap and reverse-geocode
  useEffect(() => {
    if (!prefillLat || !prefillLng) return
    setSnapping(true)
    Promise.all([
      apiFetch(`/transit/transit-locality/nearest?lat=${prefillLat}&lng=${prefillLng}`).then((r) => r.json()),
      apiFetch(`/transit/transit-locality/reverse-geocode?lat=${prefillLat}&lng=${prefillLng}`).then((r) => r.json()),
    ]).then(([snap, geo]) => {
      setLatStr((snap.location?.[1] ?? prefillLat).toFixed(6))
      setLngStr((snap.location?.[0] ?? prefillLng).toFixed(6))
      if (!prefillName && geo.display_name) setName(String(geo.display_name).split(',')[0].trim())
    }).catch(() => {}).finally(() => setSnapping(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // insert before destination (last), after second-to-last by default
  const insertOptions = localities.map((rl, i) => ({
    label: i === 0 ? 'No início (após origem)' : `Após ${rl.locality?.name ?? `Ponto ${rl.sequence}`} (seq ${rl.sequence})`,
    value: i === 0 ? 0 : rl.sequence,
  }))

  function handleAdd() {
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (mode === 'waypoint' && (isNaN(lat) || isNaN(lng))) return
    if (mode === 'stop' && !localityId && (isNaN(lat) || isNaN(lng))) return

    const selectedLocality = localityOptions.find((o) => o.value === localityId)
    onAdd({
      _pendingId:          crypto.randomUUID(),
      localityId:          mode === 'stop' && localityId ? localityId : null,
      localityName:        mode === 'stop' ? (selectedLocality?.label ?? (name || null)) : null,
      lat,
      lng,
      isWaypoint:          mode === 'waypoint',
      insertAfterSequence: afterSeq,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-md shadow-lg w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold">Adicionar Ponto</h2>

        <div className="flex gap-2">
          {(['stop', 'waypoint'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 h-8 rounded-sm text-xs font-medium border transition-colors ${
                mode === m ? 'bg-accent text-accent-foreground border-accent' : 'border-input hover:bg-muted'
              }`}
            >
              {m === 'stop' ? 'Ponto de Ônibus' : 'Waypoint (passagem)'}
            </button>
          ))}
        </div>

        {mode === 'stop' && (
          <div className="space-y-1">
            <label className="text-sm font-medium">Localidade existente</label>
            <select
              className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              value={localityId}
              onChange={(e) => setLocalityId(e.target.value)}
            >
              <option value="">— ou informe lat/lng abaixo para criar nova —</option>
              {localityOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {(!localityId || mode === 'waypoint') && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Latitude</label>
              <input
                className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={latStr}
                onChange={(e) => setLatStr(e.target.value)}
                placeholder="-15.6014"
                disabled={snapping}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Longitude</label>
              <input
                className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={lngStr}
                onChange={(e) => setLngStr(e.target.value)}
                placeholder="-56.0974"
                disabled={snapping}
              />
            </div>
          </div>
        )}

        {mode === 'stop' && !localityId && (
          <div className="space-y-1">
            <label className="text-sm font-medium">Nome da nova localidade</label>
            <input
              className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={snapping ? 'Buscando endereço…' : 'Nome do ponto'}
              disabled={snapping}
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">Inserir</label>
          <select
            className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={afterSeq}
            onChange={(e) => setAfterSeq(Number(e.target.value))}
          >
            {insertOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={handleAdd} disabled={snapping}>
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  )
}
