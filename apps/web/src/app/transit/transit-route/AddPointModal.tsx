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
  // insert after the current last stop before the destination by default —
  // the destination (last stop) can't be used as an anchor, since no point may come after it.
  // label position = the sequence the new point will take (origin is position 0)
  const insertOptions = localities.slice(0, -1).map((rl, i) => ({
    label: `${String(i + 1).padStart(2, '0')} - Após ${rl.locality?.abbr ?? `Ponto ${rl.sequence}`}`,
    value: rl.sequence,
  }))

  const [mode,       setMode]       = useState<Mode>('stop')
  const [localityId, setLocalityId] = useState('')
  const [latStr,     setLatStr]     = useState(prefillLat?.toFixed(6) ?? '')
  const [lngStr,     setLngStr]     = useState(prefillLng?.toFixed(6) ?? '')
  const [name,       setName]       = useState(prefillName ?? '')
  const [code,       setCode]       = useState('')
  const [abbr,       setAbbr]       = useState('')
  const [allowsCrewChange, setAllowsCrewChange] = useState(false)
  const [afterSeq,   setAfterSeq]   = useState<number>(() => insertOptions.at(-1)?.value ?? 0)
  const [snapping,   setSnapping]   = useState(false)

  const isNewLocality = mode === 'stop' && !localityId

  const { options: rawLocalities } = useFieldOptions({ resource: 'transit-locality', domain: 'transit' })
  const localityOptions = rawLocalities.map((o) => ({ value: String(o.id ?? ''), label: String(o.name ?? '') }))

  // suggest the next free locality code once on mount — user can still overwrite it
  useEffect(() => {
    apiFetch('/transit/transit-locality/next-code').then((r) => r.json()).then((data) => {
      setCode((prev) => prev || String(data.code ?? ''))
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleAdd() {
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if ((mode === 'waypoint' || isNewLocality) && (isNaN(lat) || isNaN(lng))) return
    if (isNewLocality && (!code.trim() || !name.trim())) return

    const selectedLocality = localityOptions.find((o) => o.value === localityId)
    onAdd({
      _pendingId:          crypto.randomUUID(),
      localityId:          mode === 'stop' && localityId ? localityId : null,
      localityName:        mode === 'stop' ? (selectedLocality?.label ?? (name || null)) : null,
      code:                isNewLocality ? code.trim() : null,
      abbr:                isNewLocality && abbr.trim() ? abbr.trim() : null,
      lat,
      lng,
      isWaypoint:          mode === 'waypoint',
      allowsCrewChange:    mode === 'stop' && allowsCrewChange,
      insertAfterSequence: afterSeq,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40">
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

        {mode === 'stop' && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded-sm border-input"
              checked={allowsCrewChange}
              onChange={(e) => setAllowsCrewChange(e.target.checked)}
            />
            Troca de motorista
          </label>
        )}

        {(mode === 'waypoint' || isNewLocality) && (
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

        {isNewLocality && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Código</label>
                <input
                  className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Ex: 1234"
                  maxLength={10}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Abreviação</label>
                <input
                  className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  value={abbr}
                  onChange={(e) => setAbbr(e.target.value)}
                  placeholder="Opcional"
                  maxLength={10}
                />
              </div>
            </div>

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
          </>
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
          <Button type="button" onClick={handleAdd} disabled={snapping || (isNewLocality && (!code.trim() || !name.trim()))}>
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  )
}
