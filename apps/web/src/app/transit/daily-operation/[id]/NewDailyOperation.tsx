'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Icons }            from '@/lib/icons'
import { Breadcrumb }       from '@/components/ui/breadcrumb'
import { Select }           from '@/components/ui/select'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { extractError }     from '@/lib/utils'
import { localToday }       from '@/lib/plan-vigence'

const ORIGIN  = 'apps/web/src/app/transit/daily-operation/[id]/NewDailyOperation'
const FORM_ID = 'daily-operation-form'

// Creating a day = materializing the plans in force on the date for a Scope. An existing day
// of the same Scope and date is opened instead.
export function NewDailyOperation() {
  const router    = useRouter()
  const { toast } = useToast()
  const [scopeId, setScopeId] = useState('')
  const [date, setDate]       = useState(localToday())
  const [saving, setSaving]   = useState(false)

  const { data: scopes = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['transit', 'scope', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/scope?pageSize=999')
      if (!res.ok) throw new Error()
      const json = await res.json()
      return json.data ?? json
    },
  })

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!scopeId || !date || saving) return
    setSaving(true)
    try {
      const res = await apiFetch('/transit/daily-operation', { method: 'POST', body: JSON.stringify({ scopeId, date }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      router.replace(`/transit/daily-operation/${json.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar o dia')
      setSaving(false)
    }
  }

  const reset = () => { setScopeId(''); setDate(localToday()) }

  useTopbarActions([
    { label: 'Materializar', icon: Icons.Save, type: 'submit', form: FORM_ID, primary: true, disabled: saving || !scopeId || !date, keybind: 'ALT+G' },
  ], [saving, scopeId, date])
  useShortcut('alt+g', () => void handleSubmit(), { desc: 'Materializar o dia', icon: Icons.Save, origin: ORIGIN })
  useShortcut('alt+v', () => router.push('/transit/daily-operation'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN })
  useShortcut('alt+l', reset, { display: false, origin: ORIGIN })

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <Breadcrumb segments={[
        { label: 'Operação', href: '/transit' },
        { label: 'Escalas Diárias', href: '/transit/daily-operation' },
        { label: 'Novo' },
      ]} />
      <form id={FORM_ID} onSubmit={handleSubmit} className="grid grid-cols-[8rem_1fr] items-center gap-3">
        <label className="text-sm font-medium" htmlFor="scope">Escopo</label>
        <Select id="scope" value={scopeId} onChange={e => setScopeId(e.target.value)} size="sm" className="w-72" autoFocus>
          <option value="">Selecione…</option>
          {scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <label className="text-sm font-medium" htmlFor="date">Data</label>
        <input
          id="date" type="date" value={date} onChange={e => setDate(e.target.value)}
          className="h-8 w-44 border border-input rounded-sm text-sm bg-input-bg px-2 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="col-start-2 text-xs text-muted-foreground">
          Copia os planejamentos de veículos e de escala em vigor na data — por linha, conforme o tipo de dia dela (exceções de calendário incluídas). Nada é ajustado: o dia mostra as pendências.
        </p>
      </form>
    </div>
  )
}
