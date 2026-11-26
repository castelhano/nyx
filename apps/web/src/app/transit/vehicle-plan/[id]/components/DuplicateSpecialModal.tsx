'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { useShortcutContext } from '@/lib/keywatch'

interface DayTypeRow { id: string; name: string; pattern: unknown }

interface Props {
  planId:      string
  dayTypeName: string
  onClose:     () => void
}

// Duplicates a conventional plan into a special one (day type without pattern — Férias,
// Especial): the copy keeps every line, block and OSO pin, and its lines may later switch to
// OSOs of the new day type (docs/architecture/transit/day-types.md)
export function DuplicateSpecialModal({ planId, dayTypeName, onClose }: Props) {
  useShortcutContext('duplicate_special_md')
  const router    = useRouter()
  const { toast } = useToast()

  const [dayTypeId, setDayTypeId] = useState('')
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const { data: dayTypes = [], isLoading } = useQuery<DayTypeRow[]>({
    queryKey: ['transit', 'day-type', 'list'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/day-type')
      if (!res.ok) throw new Error('Erro ao carregar tipos de dia')
      const json = await res.json()
      return json.data ?? json
    },
    staleTime: 60_000,
  })
  const special = dayTypes.filter(dt => !dt.pattern)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dayTypeId || saving) return
    setSaving(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/duplicate`, {
        method: 'POST',
        body:   JSON.stringify({ dayTypeId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json, 'Erro ao duplicar planejamento'))
      }
      const created: { id: string } = await res.json()
      toast.success('Planejamento duplicado')
      router.push(`/transit/vehicle-plan/${created.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao duplicar planejamento')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4"
      >
        <div>
          <h2 className="text-base font-semibold">Duplicar como dia especial</h2>
          <p className="text-xs text-muted-foreground mt-1">
            A cópia traz todas as linhas e carros deste planejamento, vinculados às OSOs de {dayTypeName}.
            Depois, troque a OSO só das linhas que mudam e remova as que não operam.
          </p>
        </div>

        <div>
          <label htmlFor="specialDayType" className="text-sm font-medium">Tipo de dia <span className="ps-0.5">*</span></label>
          <Select
            id="specialDayType"
            wrapperClassName="mt-2"
            value={dayTypeId}
            onChange={e => setDayTypeId(e.target.value)}
            required
            autoFocus
            disabled={isLoading}
          >
            <option value="">{isLoading ? 'Carregando…' : special.length === 0 ? 'Nenhum tipo de dia sem padrão cadastrado' : 'Selecione…'}</option>
            {special.map(dt => (
              <option key={dt.id} value={dt.id}>{dt.name}</option>
            ))}
          </Select>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!dayTypeId || saving}>
            {saving ? 'Duplicando…' : 'Duplicar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
