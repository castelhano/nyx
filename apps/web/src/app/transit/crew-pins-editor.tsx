'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Combobox } from '@/components/ui/combobox'
import { apiFetch } from '@/lib/auth'
import { Icons } from '@/lib/icons'

// warning: why this crew member can't take it (e.g. outside his shift) — shown, never enforced
export interface CrewPin { id: string; code: string; name: string; warning?: string }

// "Operadores preferenciais": who should work a duty or a trip group, in order — searched by code
// or name (the empresa's, when given), reordered with ↑↓, removed with ✕; each change goes out
// at once (onChange)
export function CrewPinsEditor({ pins, branchId, canEdit, onChange, hint }: {
  pins: CrewPin[]; branchId: string | null; canEdit: boolean; onChange: (ids: string[]) => void; hint?: string
}) {
  const [search, setSearch] = useState('')
  const q = search.trim()
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['transit', 'crew-member', 'pin-search', branchId, q],
    queryFn:  async () => {
      const params = new URLSearchParams({ search: q, pageSize: '20', ...(branchId ? { f_branchId: branchId } : {}) })
      const res = await apiFetch(`/transit/crew-member?${params}`)
      const json = await res.json().catch(() => ({}))
      return (json.data ?? []) as { id: string; code: string; displayName: string }[]
    },
    enabled:  canEdit && q.length > 0,
  })
  const ids = pins.map(p => p.id)
  const move = (i: number, d: -1 | 1) => { const next = [...ids]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next) }
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Operadores preferenciais</p>
      {!pins.length && <p className="text-xs text-muted-foreground">Nenhum — a escala diária escolhe livremente.</p>}
      {pins.map((p, i) => (
        <div key={p.id} className="flex items-center gap-1.5 text-xs">
          <span className="w-5 text-muted-foreground tabular-nums">{i + 1}º</span>
          <span className="tabular-nums text-muted-foreground">{p.code}</span>
          <span className="truncate">{p.name}</span>
          {p.warning && (
            <span className="flex items-center gap-0.5 shrink-0 text-amber-600 dark:text-amber-400" title={p.warning}>
              <Icons.AlertTriangle className="w-3.5 h-3.5" /><span className="text-[11px]">{p.warning}</span>
            </span>
          )}
          {canEdit && (
            <span className="ml-auto flex gap-0.5">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer" title="Subir"><Icons.ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" disabled={i === pins.length - 1} onClick={() => move(i, 1)} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer" title="Descer"><Icons.ArrowDown className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => onChange(ids.filter(x => x !== p.id))} className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" title="Remover"><Icons.X className="w-3.5 h-3.5" /></button>
            </span>
          )}
        </div>
      ))}
      {canEdit && (
        <Combobox
          value={null} displayValue="" search={search} onSearchChange={setSearch} isLoading={isFetching}
          options={found.filter(m => !ids.includes(m.id)).map(m => ({ id: m.id, label: m.displayName ?? m.code }))}
          onSelect={(o) => { setSearch(''); if (o) onChange([...ids, o.id]) }}
          placeholder="Adicionar operador (matrícula ou nome)…" className="h-8 text-sm" emptyMessage={q ? 'Nenhum operador' : 'Digite para buscar'}
        />
      )}
      {pins.length > 0 && hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
