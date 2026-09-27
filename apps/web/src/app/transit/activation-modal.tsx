'use client'

// Activation with a start date (docs/proposal/plan_activation_date_v1.md), shared by VehiclePlan,
// CrewPlan and LineSchedule: every date change asks the endpoint for the preview (no `confirm`,
// nothing written), confirming sends the same date with `confirm: true`.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PlanActivationPreview } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { useShortcutContext } from '@/lib/keywatch'
import { localToday } from '@/lib/plan-vigence'

interface Props {
  title:        string
  // POST endpoint taking { startDate, confirm }
  endpoint:     string
  confirmLabel: string
  onDone:       (preview: PlanActivationPreview) => void
  onClose:      () => void
}

const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

export function ActivationModal({ title, endpoint, confirmLabel, onDone, onClose }: Props) {
  useShortcutContext('activation_md')
  const [startDate, setStartDate] = useState(localToday())
  const [saving, setSaving]       = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function call(confirm: boolean): Promise<PlanActivationPreview> {
    const res  = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ startDate, confirm }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(extractError(json))
    return json as PlanActivationPreview
  }

  const previewQuery = useQuery({
    queryKey: ['plan-activation-preview', endpoint, startDate],
    queryFn:  () => call(false),
    enabled:  /^\d{4}-\d{2}-\d{2}$/.test(startDate),
    retry:    false,
    gcTime:   0,
  })
  const preview = previewQuery.data ?? null
  const loading = previewQuery.isFetching
  const error   = confirmError ?? (previewQuery.error instanceof Error ? previewQuery.error.message : null)

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      onDone(await call(true))
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Erro ao ativar')
      setSaving(false)
    }
  }

  const nothingElse = preview && !preview.superseded.length && !preview.reverted.length
    && !preview.crewSuperseded.length && !preview.crewReverted.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={handleConfirm} className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <h2 className="text-base font-semibold">{title}</h2>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Início da vigência</span>
          <input
            type="date"
            value={startDate}
            onChange={e => { setStartDate(e.target.value); setConfirmError(null) }}
            className="w-full h-8 border border-input rounded-sm text-sm bg-input-bg px-2 focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
        </label>

        <div className="min-h-16 space-y-1.5 text-sm">
          {loading && <p className="text-xs text-muted-foreground">Verificando…</p>}
          {!loading && error && (
            <p className="flex gap-2 text-red-600 dark:text-red-400"><Icons.AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}</p>
          )}
          {!loading && preview && (
            <>
              {preview.superseded.map(s => <Effect key={s.id} text={`"${s.label}" deixa de valer após ${fmt(s.validTo)}`} />)}
              {preview.reverted.map(r => <Effect key={r.id} text={`"${r.label}" volta a rascunho (não chegou a entrar em vigor)`} />)}
              {preview.crewSuperseded.map(s => <Effect key={s.id} text={`Escala "${s.label}" deixa de valer após ${fmt(s.validTo)}`} />)}
              {preview.crewReverted.map(r => <Effect key={r.id} text={`Escala "${r.label}" volta a rascunho`} />)}
              {nothingElse && <Effect text="Nenhuma outra versão é afetada" />}
              {preview.warnings.map(w => (
                <p key={w} className="flex gap-2 text-amber-700 dark:text-amber-400"><Icons.AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{w}</p>
              ))}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>Cancelar</Button>
          <Button type="submit" size="sm" disabled={saving || loading || !preview || !!error}>
            {saving ? 'Ativando…' : confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}

function Effect({ text }: { text: string }) {
  return <p className="flex gap-2 text-muted-foreground"><Icons.ArrowRight className="w-4 h-4 shrink-0 mt-0.5" />{text}</p>
}
