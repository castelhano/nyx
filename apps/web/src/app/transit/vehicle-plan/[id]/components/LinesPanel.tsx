'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import { Icons }    from '@/lib/icons'

interface PlanLine {
  lineId: string
  line:   { id: string; code: string; name: string }
}

interface AvailableLine {
  id:   string
  code: string
  name: string
}

interface Props {
  planId:       string
  currentLines: PlanLine[]
  onClose:      () => void
  onChanged:    () => Promise<void>
}

export function LinesPanel({ planId, currentLines, onClose, onChanged }: Props) {
  const [pending, setPending] = useState<string | null>(null)
  const [search,  setSearch]  = useState('')

  const { data: allLines = [] } = useQuery<AvailableLine[]>({
    queryKey: ['transit', 'transit-line', 'list'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/transit-line')
      if (!res.ok) throw new Error('Erro ao carregar linhas')
      const json = await res.json()
      return json.data ?? json
    },
    staleTime: 60_000,
  })

  const currentIds   = new Set(currentLines.map(l => l.lineId))
  const q            = search.toLowerCase()
  const visibleLines = q
    ? allLines.filter(l => l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q))
    : allLines

  async function handleAdd(lineId: string) {
    setPending(lineId)
    try {
      await apiFetch(`/transit/vehicle-plan/${planId}/lines`, {
        method: 'POST',
        body:   JSON.stringify({ lineId }),
      })
      await onChanged()
    } finally {
      setPending(null)
    }
  }

  async function handleRemove(lineId: string) {
    setPending(lineId)
    try {
      await apiFetch(`/transit/vehicle-plan/${planId}/lines/${lineId}`, { method: 'DELETE' })
      await onChanged()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="w-64 shrink-0 border-l border-border flex flex-col bg-background">
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-medium">Linhas do Plano</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <Icons.X className="w-4 h-4" />
        </button>
      </div>

      {/* search */}
      <div className="px-2 py-2 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar linha…"
          className="w-full text-xs rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {visibleLines.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            {allLines.length === 0 ? 'Nenhuma linha cadastrada' : 'Nenhum resultado'}
          </p>
        )}
        {visibleLines.map(line => {
          const active = currentIds.has(line.id)
          const busy   = pending === line.id
          return (
            <div
              key={line.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent group"
            >
              <div className="flex-1 min-w-0">
                <span className="text-xs font-mono font-medium">{line.code}</span>
                <span className="text-xs text-muted-foreground ml-1.5 truncate">{line.name}</span>
              </div>
              <button
                disabled={busy}
                onClick={() => active ? handleRemove(line.id) : handleAdd(line.id)}
                className={[
                  'shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors',
                  busy    ? 'opacity-40 cursor-not-allowed' : '',
                  active  ? 'bg-primary text-primary-foreground hover:bg-destructive'
                          : 'border border-border text-muted-foreground hover:border-primary hover:text-primary',
                ].join(' ')}
                title={active ? 'Remover linha' : 'Adicionar linha'}
              >
                {active
                  ? <Icons.Check className="w-3 h-3" />
                  : <Icons.Plus  className="w-3 h-3" />
                }
              </button>
            </div>
          )
        })}
      </div>

      {currentLines.length > 0 && (
        <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
          {currentLines.length} linha{currentLines.length !== 1 ? 's' : ''} no plano
        </div>
      )}
    </div>
  )
}
