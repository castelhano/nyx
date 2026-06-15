'use client'

import { useState } from 'react'
import { useQuery }  from '@tanstack/react-query'
import { Button }    from '@/components/ui/button'
import { Icons }     from '@/lib/icons'
import { apiFetch }  from '@/lib/auth'

interface Depot {
  id:   string
  name: string
  code: string
}

interface Props {
  title:     string
  onConfirm: (depotLocalityId: string) => void
  onClose:   () => void
}

export function AccessModal({ title, onConfirm, onClose }: Props) {
  const [depotId, setDepotId] = useState('')

  const { data: depots = [], isLoading } = useQuery<Depot[]>({
    queryKey: ['transit', 'transit-locality', 'depots'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/transit-locality?f_isDepot=true&pageSize=100')
      if (!res.ok) throw new Error('Erro ao carregar garagens')
      const json = await res.json()
      return (json.data ?? json) as Depot[]
    },
    staleTime: 60_000,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (depotId) onConfirm(depotId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 space-y-4"
      >
        <h2 className="text-base font-semibold">{title}</h2>

        <div>
          <label htmlFor="depotId" className="text-sm font-medium">
            Garagem <span className="ps-0.5">*</span>
          </label>
          <div className="relative mt-2">
            <select
              id="depotId"
              value={depotId}
              onChange={e => setDepotId(e.target.value)}
              required
              autoFocus
              disabled={isLoading}
              className="w-full appearance-none border border-input rounded-sm text-sm bg-input-bg px-3 py-2 pe-8 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              <option value="">
                {isLoading ? 'Carregando…' : depots.length === 0 ? 'Nenhuma garagem cadastrada' : 'Selecione…'}
              </option>
              {depots.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!depotId || isLoading}>
            Adicionar
          </Button>
        </div>
      </form>
    </div>
  )
}
