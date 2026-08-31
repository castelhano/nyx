'use client'

import { useState, useEffect, useRef }  from 'react'
import { Button }               from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { useComboboxSearch }    from '@/core/useComboboxSearch'
import { apiFetch }        from '@/lib/auth'
import { Icons }           from '@/lib/icons'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import type { PendingPoint, RouteLocality } from './types'
import { resolveOrder }         from './order'

interface Props {
  existing: RouteLocality[]
  pending:  PendingPoint[]
  prefillLat?: number
  prefillLng?: number
  prefillName?: string
  onAdd:    (point: PendingPoint) => void
  onClose:  () => void
}

type Mode = 'stop' | 'waypoint'

export function AddPointModal({ existing, pending, prefillLat, prefillLng, prefillName, onAdd, onClose }: Props) {
  // insert after the current last stop before the destination by default —
  // the destination (last stop) can't be used as an anchor, since no point may come after it.
  // includes pending (not-yet-saved) points so a chain of additions before
  // "Gravar" can anchor onto each other, not just onto persisted stops
  const orderedItems = resolveOrder(existing, pending)
  const insertOptions = orderedItems.slice(0, -1).map((item, i) => ({
    label: `${String(i + 1).padStart(2, '0')} - Após ${
      item.type === 'existing'
        ? (item.rl.locality?.abbr ?? `Ponto ${item.rl.sequence}`)
        : `${item.p.localityName ?? 'Novo ponto'} (pendente)`
    }`,
    value: item.key,
  }))

  // a point added by clicking the map is almost always a waypoint (route passage),
  // not a bus stop tied to an existing/new locality
  const fromMapClick = prefillLat != null && prefillLng != null
  const [mode,       setMode]       = useState<Mode>(fromMapClick ? 'waypoint' : 'stop')
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [localityId, setLocalityId] = useState('')
  const [selectedLocality, setSelectedLocality] = useState<Record<string, unknown> | null>(null)
  const [latStr,     setLatStr]     = useState(prefillLat?.toFixed(6) ?? '')
  const [lngStr,     setLngStr]     = useState(prefillLng?.toFixed(6) ?? '')
  const [name,       setName]       = useState(prefillName ?? '')
  const [code,       setCode]       = useState('')
  const [abbr,       setAbbr]       = useState('')
  const [allowsCrewChange, setAllowsCrewChange] = useState(false)
  const [afterKey,   setAfterKey]   = useState<string | null>(() => insertOptions.at(-1)?.value ?? null)
  const [snapping,   setSnapping]   = useState(false)
  const codeTouched = useRef(false)

  const isNewLocality = mode === 'stop' && !localityId

  useShortcutContext('add_point_md')

  const { search: localitySearch, setSearch: setLocalitySearch, rows: localityRows, isLoading: localitiesLoading } =
    useComboboxSearch('transit', 'transit-locality')
  const localityOptions: ComboboxOption[] = localityRows.map((o) => ({
    id: String(o.id ?? ''), label: String(o.name ?? ''), raw: o,
  }))

  // an existing stop's coordinates come from its own record, not the (hidden) lat/lng
  // inputs — those only render for waypoints/new localities
  const selectedRaw = mode === 'stop' ? selectedLocality : null
  const resolvedLat = selectedRaw ? (selectedRaw.lat != null ? Number(selectedRaw.lat as number) : NaN) : parseFloat(latStr)
  const resolvedLng = selectedRaw ? (selectedRaw.lng != null ? Number(selectedRaw.lng as number) : NaN) : parseFloat(lngStr)
  const hasValidCoords = !isNaN(resolvedLat) && !isNaN(resolvedLng)

  // suggest a locality code from the quadrant grid once lat/lng resolve to valid numbers
  // — user can still overwrite it, which stops further auto-fills (codeTouched).
  // the server only knows about persisted codes, so bump the sequence past any code
  // already claimed by a pending (not-yet-saved) point, to avoid a unique-constraint clash on save
  useEffect(() => {
    if (!isNewLocality) return
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (isNaN(lat) || isNaN(lng)) return
    const timer = setTimeout(() => {
      apiFetch(`/transit/transit-locality/next-code?lat=${lat}&lng=${lng}`).then((r) => r.json()).then((data) => {
        if (codeTouched.current || !data.code) return
        const usedByPending = new Set(pending.map((p) => p.code).filter((c): c is string => c != null))
        const match = /^(.+-)(\d{3})$/.exec(data.code)
        if (!match) { setCode(data.code); return }
        const [, prefix, seqStr] = match
        let seq = Number(seqStr)
        while (usedByPending.has(`${prefix}${String(seq).padStart(3, '0')}`)) seq += 1
        setCode(`${prefix}${String(seq).padStart(3, '0')}`)
      }).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewLocality, latStr, lngStr])

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

  useEffect(() => {
    if (fromMapClick && !snapping) addButtonRef.current?.focus()
  }, [fromMapClick, snapping])

  function handleAdd() {
    if (!hasValidCoords) return
    if (isNewLocality && (!code.trim() || !name.trim())) return

    onAdd({
      _pendingId:          crypto.randomUUID(),
      localityId:          mode === 'stop' && localityId ? localityId : null,
      localityName:        mode === 'stop' ? (String(selectedLocality?.name ?? '') || name || null) : null,
      code:                isNewLocality ? code.trim() : null,
      abbr:                isNewLocality && abbr.trim() ? abbr.trim() : null,
      lat:                 resolvedLat,
      lng:                 resolvedLng,
      isWaypoint:          mode === 'waypoint',
      allowsCrewChange:    mode === 'stop' && allowsCrewChange,
      insertAfterKey:      afterKey,
    })
    onClose()
  }

  const canSubmit = hasValidCoords && !(isNewLocality && (!code.trim() || !name.trim()))

  useShortcut('alt+g', handleAdd, {
    desc:    'Adicionar ponto',
    icon:    Icons.Save,
    context: 'add_point_md',
    origin:  'apps/web/src/app/transit/transit-route/AddPointModal.tsx',
    enabled: !snapping && canSubmit,
  })

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
            <Combobox
              value={localityId || null}
              displayValue={selectedLocality ? String(selectedLocality.name ?? '') : ''}
              search={localitySearch}
              onSearchChange={setLocalitySearch}
              options={localityOptions}
              isLoading={localitiesLoading}
              onSelect={(opt) => {
                setLocalityId(opt?.id ?? '')
                setSelectedLocality(opt?.raw ?? null)
              }}
              placeholder="— ou informe lat/lng abaixo para criar nova —"
              className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
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
                  onChange={(e) => { codeTouched.current = true; setCode(e.target.value) }}
                  placeholder="Ex: A0517-001"
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
                  maxLength={16}
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
            value={afterKey ?? ''}
            onChange={(e) => setAfterKey(e.target.value || null)}
          >
            {insertOptions.map((o) => (
              <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" tabIndex={-1} onClick={onClose}>Cancelar</Button>
          <Button ref={addButtonRef} type="button" onClick={handleAdd} disabled={snapping || !canSubmit}>
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  )
}
