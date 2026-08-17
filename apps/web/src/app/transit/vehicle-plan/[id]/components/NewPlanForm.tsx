'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Icons }        from '@/lib/icons'
import { apiFetch }     from '@/lib/auth'
import { useToast }     from '@/lib/toast-context'
import { extractError } from '@/lib/utils'
import { Button }       from '@/components/ui/button'
import { useShortcut }  from '@/lib/keywatch'

const FORM_ID = 'new-vehicle-plan-form'

interface DayType { id: string; name: string; code: string }
interface ScopeOption { id: string; name: string }

export function NewPlanForm() {
  const router    = useRouter()
  const { toast } = useToast()

  const [scopeId,   setScopeId]   = useState('')
  const [dayTypeId, setDayTypeId] = useState('')
  const [isPending, setIsPending] = useState(false)

  const { data: scopes = [] } = useQuery<ScopeOption[]>({
    queryKey: ['transit', 'scope', 'list'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/scope')
      if (!res.ok) throw new Error('Erro ao carregar escopos')
      const json = await res.json()
      return json.data ?? json
    },
    staleTime: 60_000,
  })

  const { data: dayTypes = [] } = useQuery<DayType[]>({
    queryKey: ['transit', 'day-type', 'list'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/day-type')
      if (!res.ok) throw new Error('Erro ao carregar tipos de dia')
      const json = await res.json()
      return json.data ?? json
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!scopeId && scopes.length > 0) setScopeId(scopes[0].id)
  }, [scopes, scopeId])

  useEffect(() => {
    if (!dayTypeId && dayTypes.length > 0) setDayTypeId(dayTypes[0].id)
  }, [dayTypes, dayTypeId])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!scopeId || !dayTypeId) return
    setIsPending(true)
    try {
      const res = await apiFetch('/transit/vehicle-plan', {
        method: 'POST',
        body:   JSON.stringify({ scopeId, dayTypeId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const created = await res.json()
      router.push(`/transit/vehicle-plan/${created.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar planejamento')
      setIsPending(false)
    }
  }

  function handleCancel() {
    router.push('/transit/vehicle-plan')
  }

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Gravar', icon: Icons.Save, context: 'all', origin: 'transit/vehicle-plan/[id]/NewPlanForm' })

  useShortcut('alt+v;esc', handleCancel, {
    desc: 'Cancelar', icon: Icons.ArrowLeft, context: 'all', origin: 'transit/vehicle-plan/[id]/NewPlanForm',
  })

  return (
    <div className="flex flex justify-center p-8">
      <form
        id={FORM_ID}
        onSubmit={handleCreate}
        className="w-full max-w-sm space-y-4 border border-border rounded-md p-6 bg-card"
      >
        <div>
          <h2 className="text-base font-semibold mb-2">Novo Planejamento</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Selecione o escopo e o tipo de dia para iniciar.
          </p>
        </div>

        <div>
          <label htmlFor="scopeId" className="text-sm font-medium">
            Escopo <span className="ps-1">*</span>
          </label>
          <div className="relative mt-2">
            <select
              id="scopeId"
              value={scopeId}
              onChange={e => setScopeId(e.target.value)}
              required
              autoFocus
              className="w-full appearance-none border border-input rounded-sm text-sm bg-input-bg px-3 py-2 pe-8 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              {scopes.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>

        <div>
          <label htmlFor="dayTypeId" className="text-sm font-medium">
            Tipo de Dia <span className="ps-1">*</span>
          </label>
          <div className="relative mt-2">
            <select
              id="dayTypeId"
              value={dayTypeId}
              onChange={e => setDayTypeId(e.target.value)}
              required
              className="w-full appearance-none border border-input rounded-sm text-sm bg-input-bg px-3 py-2 pe-8 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              {dayTypes.map(dt => (
                <option key={dt.id} value={dt.id}>{dt.name}</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>
        <div className="flex justify-end space-x-4">
          <Button type="button" className="w-full" size="default" variant='cancel' tabIndex={-1} onClick={handleCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending || !scopeId || !dayTypeId} className="w-full" size="default">
          {isPending ? 'Gravando…' : 'Gravar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
