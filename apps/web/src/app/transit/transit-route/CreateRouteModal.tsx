'use client'

import { useEffect, useState } from 'react'
import { Button }          from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { ColorPicker }     from '@/components/ui/color-picker'
import { useComboboxSearch } from '@/core/useComboboxSearch'
import { useRelationLabel } from '@/core/useRelationLabel'
import { apiFetch }        from '@/lib/auth'
import { extractError }    from '@/lib/utils'
import { Icons }           from '@/lib/icons'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { DIR_COLOR, DIR_LABEL, ROUTE_COLOR_PALETTE, type RouteDirection, type TransitRoute } from './types'

interface Props {
  lineId: string
  route?: TransitRoute | null
  onClose: () => void
  onSaved: (route: { id: string; originLocalityId: string; destinationLocalityId: string }) => void
}

const DIRECTIONS: RouteDirection[] = ['OUTBOUND', 'INBOUND', 'CIRCULAR']

export function CreateRouteModal({ lineId, route, onClose, onSaved }: Props) {
  const isEditing = !!route
  const [direction,   setDirection]   = useState<RouteDirection>(route?.direction ?? 'OUTBOUND')
  const [color,       setColor]       = useState<string | null>(route?.color ?? null)
  const [name,        setName]        = useState(route?.name ?? '')
  const [originId,    setOriginId]    = useState(route?.originLocalityId ?? '')
  const [destId,      setDestId]      = useState(route && route.direction !== 'CIRCULAR' ? route.destinationLocalityId : '')
  const [originLabelOverride, setOriginLabelOverride] = useState<string | null>(null)
  const [destLabelOverride,   setDestLabelOverride]   = useState<string | null>(null)
  const [isPending,   setIsPending]   = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const { search: originSearch, setSearch: setOriginSearch, rows: originRows, isLoading: originLoading } =
    useComboboxSearch('transit', 'transit-locality')
  const { search: destSearch, setSearch: setDestSearch, rows: destRows, isLoading: destLoading } =
    useComboboxSearch('transit', 'transit-locality')
  const originOptions: ComboboxOption[] = originRows.map((o) => ({ id: String(o.id ?? ''), label: String(o.name ?? '') }))
  const destOptions:   ComboboxOption[] = destRows.map((o) => ({ id: String(o.id ?? ''), label: String(o.name ?? '') }))

  const fetchedOriginLabel = useRelationLabel('transit', 'transit-locality', originId)
  const fetchedDestLabel   = useRelationLabel('transit', 'transit-locality', destId)
  const originLabel = originLabelOverride ?? fetchedOriginLabel
  const destLabel    = destLabelOverride ?? fetchedDestLabel

  const isCircular = direction === 'CIRCULAR'
  const autoColor = DIR_COLOR[direction]
  // the direction's default is already offered as the "Automático" swatch — drop it
  // from the grid so it isn't shown twice
  const paletteColors = ROUTE_COLOR_PALETTE.map((c) => c.value).filter((v) => v !== autoColor)

  // switching direction can make an explicitly picked color coincide with the new
  // direction's default — fold it back into "Automático" so it isn't orphaned
  // (its swatch was just filtered out of the grid above)
  useEffect(() => {
    if (color === autoColor) setColor(null)
  }, [autoColor]) // eslint-disable-line react-hooks/exhaustive-deps

  useShortcutContext('modal')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, isPending])

  async function submit() {
    if (!originId || (!isCircular && !destId) || !name.trim()) { setError('Preencha todos os campos'); return }
    setIsPending(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        lineId, direction, name: name.trim(), color,
        originLocalityId:      originId,
        destinationLocalityId: isCircular ? originId : destId,
      }
      if (!isEditing) body.isActive = true
      const res = await apiFetch(route ? `/transit/transit-route/${route.id}` : '/transit/transit-route', {
        method: isEditing ? 'PATCH' : 'POST',
        body:   JSON.stringify(body),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(extractError(j as Record<string, unknown>, isEditing ? 'Erro ao editar sentido' : 'Erro ao criar sentido')) }
      const saved = await res.json()
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEditing ? 'Erro ao editar sentido' : 'Erro ao criar sentido'))
      setIsPending(false)
    }
  }

  useShortcut('alt+g', submit, {
    desc:    'Gravar',
    icon:    Icons.Save,
    context: 'modal',
    origin:  'apps/web/src/app/transit/transit-route/CreateRouteModal.tsx',
    enabled: !isPending,
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        className="bg-background border border-border rounded-md shadow-lg w-full max-w-md p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold">{isEditing ? 'Editar Sentido' : 'Novo Sentido'}</h2>

        <div className="space-y-1">
          <label className="text-sm font-medium">Sentido</label>
          <div className="flex gap-2">
            {DIRECTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`flex-1 h-8 rounded-sm text-xs font-medium border transition-colors ${
                  direction === d
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'border-input hover:bg-muted'
                }`}
              >
                {DIR_LABEL[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Cor</label>
          <ColorPicker
            value={color}
            onChange={setColor}
            palette={paletteColors}
            autoColor={autoColor}
            autoLabel={`Automático (${DIR_LABEL[direction]})`}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Descrição</label>
          <input
            className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Terminal → Shopping"
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{isCircular ? 'Origem / Destino' : 'Origem'}</label>
          <Combobox
            value={originId || null}
            displayValue={originId ? (originLabel || '…') : ''}
            search={originSearch}
            onSearchChange={setOriginSearch}
            options={originOptions}
            isLoading={originLoading}
            onSelect={(opt) => { setOriginId(opt?.id ?? ''); setOriginLabelOverride(opt?.label ?? null) }}
            placeholder="Selecione…"
            className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {isCircular && (
            <p className="text-xs text-muted-foreground">Rota circular — o destino é o mesmo ponto de origem.</p>
          )}
        </div>

        {!isCircular && (
          <div className="space-y-1">
            <label className="text-sm font-medium">Destino</label>
            <Combobox
              value={destId || null}
              displayValue={destId ? (destLabel || '…') : ''}
              search={destSearch}
              onSearchChange={setDestSearch}
              options={destOptions}
              isLoading={destLoading}
              onSelect={(opt) => { setDestId(opt?.id ?? ''); setDestLabelOverride(opt?.label ?? null) }}
              placeholder="Selecione…"
              className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" tabIndex={-1} onClick={onClose} disabled={isPending}>Cancelar</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Gravando…' : 'Gravar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
