'use client'

import { useState } from 'react'
import { useQuery }  from '@tanstack/react-query'
import { Button }    from '@/components/ui/button'
import { Icons }     from '@/lib/icons'
import { apiFetch }  from '@/lib/auth'
import { useShortcutContext } from '@/lib/keywatch'

export interface IntervalType {
  id:         string
  code:       string
  name:       string
  isPaid:     boolean
  minMinutes: number | null
  maxMinutes: number | null
}

interface Props {
  onConfirm: (intervalType: IntervalType) => void
  onClose:   () => void
}

export function AddIntervalModal({ onConfirm, onClose }: Props) {
  const [intervalTypeId, setIntervalTypeId] = useState('')
  useShortcutContext('modal')

  const { data: intervalTypes = [], isLoading } = useQuery<IntervalType[]>({
    queryKey: ['transit', 'interval-type', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/interval-type?pageSize=999')
      if (!res.ok) throw new Error('Erro ao carregar tipos de intervalo')
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 60_000,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const intervalType = intervalTypes.find(t => t.id === intervalTypeId)
    if (intervalType) onConfirm(intervalType)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 space-y-4"
      >
        <h2 className="text-base font-semibold">Adicionar intervalo</h2>

        <div>
          <label htmlFor="intervalTypeId" className="text-sm font-medium">
            Tipo de intervalo <span className="ps-0.5">*</span>
          </label>
          <div className="relative mt-2">
            <select
              id="intervalTypeId"
              value={intervalTypeId}
              onChange={e => setIntervalTypeId(e.target.value)}
              required
              autoFocus
              disabled={isLoading}
              className="w-full appearance-none border border-input rounded-sm text-sm bg-input-bg px-3 py-2 pe-8 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              <option value="">
                {isLoading ? 'Carregando…' : intervalTypes.length === 0 ? 'Nenhum tipo de intervalo cadastrado' : 'Selecione…'}
              </option>
              {intervalTypes.map(t => (
                <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!intervalTypeId || isLoading}>
            Adicionar
          </Button>
        </div>
      </form>
    </div>
  )
}
