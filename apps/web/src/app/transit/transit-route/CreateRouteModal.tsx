'use client'

import { useState }        from 'react'
import { Button }          from '@/components/ui/button'
import { useFieldOptions } from '@/core/useFieldOptions'
import { apiFetch }        from '@/lib/auth'
import { extractError }    from '@/lib/utils'
import { DIR_LABEL, type RouteDirection } from './types'

interface Props {
  lineId: string
  onClose: () => void
  onCreated: (route: { id: string; originLocalityId: string; destinationLocalityId: string }) => void
}

const DIRECTIONS: RouteDirection[] = ['OUTBOUND', 'INBOUND', 'CIRCULAR']

export function CreateRouteModal({ lineId, onClose, onCreated }: Props) {
  const [direction,   setDirection]   = useState<RouteDirection>('OUTBOUND')
  const [name,        setName]        = useState('')
  const [originId,    setOriginId]    = useState('')
  const [destId,      setDestId]      = useState('')
  const [isPending,   setIsPending]   = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const { options: rawLocalities, isLoading: localitiesLoading } = useFieldOptions({
    resource: 'transit-locality',
    domain:   'transit',
  })
  const localityOptions = rawLocalities.map((o) => ({ value: String(o.id ?? ''), label: String(o.name ?? '') }))

  const isCircular = direction === 'CIRCULAR'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!originId || (!isCircular && !destId) || !name.trim()) { setError('Preencha todos os campos'); return }
    setIsPending(true)
    setError(null)
    try {
      const res = await apiFetch('/transit/transit-route', {
        method: 'POST',
        body: JSON.stringify({
          lineId, direction, name: name.trim(),
          originLocalityId:      originId,
          destinationLocalityId: isCircular ? originId : destId,
          isActive: true,
        }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(extractError(j as Record<string, unknown>, 'Erro ao criar sentido')) }
      const route = await res.json()
      onCreated(route)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar sentido')
      setIsPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="bg-background border border-border rounded-md shadow-lg w-full max-w-md p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold">Novo Sentido</h2>

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
          <select
            className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={originId}
            onChange={(e) => setOriginId(e.target.value)}
            disabled={localitiesLoading}
          >
            <option value="">Selecione…</option>
            {localityOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {isCircular && (
            <p className="text-xs text-muted-foreground">Rota circular — o destino é o mesmo ponto de origem.</p>
          )}
        </div>

        {!isCircular && (
          <div className="space-y-1">
            <label className="text-sm font-medium">Destino</label>
            <select
              className="w-full h-9 px-3 text-sm border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              value={destId}
              onChange={(e) => setDestId(e.target.value)}
              disabled={localitiesLoading}
            >
              <option value="">Selecione…</option>
              {localityOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" onClick={onClose} disabled={isPending}>Cancelar</Button>
          <Button type="submit" disabled={isPending || localitiesLoading}>
            {isPending ? 'Criando…' : 'Criar Sentido'}
          </Button>
        </div>
      </form>
    </div>
  )
}
