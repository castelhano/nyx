'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { useShortcutContext } from '@/lib/keywatch'

interface LineScheduleRow {
  id:          string
  status:      'DRAFT' | 'APPROVED' | 'SUPERSEDED' | 'ARCHIVED'
  approvalRef: string
  approvedAt:  string | null
  createdAt:   string
}

export interface PlanLineInfo {
  lineId:         string
  line:           { id: string; code: string; name: string }
  lineScheduleId: string | null
  lineSchedule:   { id: string; status: string; approvalRef: string | null } | null
}

interface Props {
  planId:            string
  dayTypeId:         string
  lines:             PlanLineInfo[]
  hasPendingChanges: boolean
  onClose:           () => void
  onApplied:         () => void
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho', APPROVED: 'Aprovado', SUPERSEDED: 'Substituído', ARCHIVED: 'Arquivado',
}

const STATUS_CLASSES: Record<string, string> = {
  DRAFT:      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  APPROVED:   'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',
  SUPERSEDED: 'bg-muted text-muted-foreground border-border',
  ARCHIVED:   'bg-muted text-muted-foreground border-border opacity-60',
}

const ANALISE_CLASSES = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800'

export function SwitchLineScheduleModal({ planId, dayTypeId, lines, hasPendingChanges, onClose, onApplied }: Props) {
  useShortcutContext('modal')
  const { toast } = useToast()
  const confirm   = useConfirm()

  const [selections,   setSelections]   = useState<Map<string, string | null>>(
    () => new Map(lines.map(l => [l.lineId, l.lineScheduleId])),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const historyQueries = useQueries({
    queries: lines.map(l => ({
      queryKey: ['transit', 'line-schedule', 'history', l.lineId, dayTypeId],
      queryFn:  async (): Promise<LineScheduleRow[]> => {
        const res = await apiFetch(`/transit/line-schedule?lineId=${l.lineId}&dayTypeId=${dayTypeId}&pageSize=999`)
        if (!res.ok) return []
        const json = await res.json()
        const rows: LineScheduleRow[] = json.data ?? []
        return [...rows].sort((a, b) => {
          const da = new Date(a.approvedAt ?? a.createdAt).getTime()
          const db = new Date(b.approvedAt ?? b.createdAt).getTime()
          return db - da
        })
      },
    })),
  })

  const changed = useMemo(
    () => lines.filter(l => (selections.get(l.lineId) ?? null) !== l.lineScheduleId),
    [lines, selections],
  )

  function findSchedule(history: LineScheduleRow[], id: string | null): LineScheduleRow | undefined {
    return id ? history.find(h => h.id === id) : undefined
  }

  async function handleApply() {
    if (changed.length === 0 || isSubmitting) return

    const summary = changed.map((l) => {
      const idx     = lines.indexOf(l)
      const history = historyQueries[idx].data ?? []
      const from    = l.lineSchedule?.approvalRef ?? 'em análise'
      const target  = findSchedule(history, selections.get(l.lineId) ?? null)
      const to      = target?.approvalRef ?? 'em análise'
      return `${l.line.code}: ${from} → ${to}`
    })

    const ok = await confirm({
      title:        'Trocar quadro de horários',
      description:  `As viagens destas linhas serão recriadas a partir da OSO selecionada — o plano precisará ser gerado novamente para reblocar:\n\n${summary.join('\n')}`,
      confirmLabel: 'Aplicar',
      variant:      'safeConfirm',
    })
    if (!ok) return

    setIsSubmitting(true)
    try {
      const results = await Promise.all(
        changed.map(l =>
          apiFetch(`/transit/vehicle-plan/${planId}/lines/${l.lineId}/switch-schedule`, {
            method: 'POST',
            body:   JSON.stringify({ lineScheduleId: selections.get(l.lineId) }),
          }),
        ),
      )
      const failed = results.filter(r => !r.ok)
      if (failed.length > 0) {
        const json = await failed[0].json().catch(() => ({}))
        throw new Error(json?.message?.message ?? json?.message ?? 'Erro ao trocar quadro de horários')
      }
      toast.success('Quadro de horários atualizado')
      onApplied()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao trocar quadro de horários')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Quadros de Horários (OSO)</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {hasPendingChanges && (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <Icons.AlertCircle className="w-4 h-4 shrink-0" />
              Salve ou descarte as alterações pendentes do Gantt antes de trocar de OSO.
            </div>
          )}

          {lines.map((l, idx) => {
            const history = historyQueries[idx].data ?? []
            const loading = historyQueries[idx].isLoading
            const selectedId = selections.get(l.lineId) ?? null

            return (
              <div key={l.lineId} className="rounded-md border border-border bg-muted/40 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    <span className="font-mono font-medium">{l.line.code}</span>
                    <span className="text-muted-foreground ml-2">{l.line.name}</span>
                  </span>
                  {l.lineSchedule ? (
                    <span className={`text-xs rounded-full border px-2 py-0.5 ${STATUS_CLASSES[l.lineSchedule.status]}`}>
                      {l.lineSchedule.approvalRef} - {STATUS_LABELS[l.lineSchedule.status]}
                    </span>
                  ) : (
                    <span className={`text-xs rounded-full border px-2 py-0.5 ${ANALISE_CLASSES}`}>
                      Em análise
                    </span>
                  )}
                </div>

                {loading ? (
                  <p className="text-xs text-muted-foreground">Carregando histórico…</p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma OSO disponível para esta linha</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {history.map(h => {
                      const isSelected = h.id === selectedId
                      return (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => setSelections(prev => new Map(prev).set(l.lineId, h.id))}
                          className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                            isSelected
                              ? 'border-ring bg-accent font-medium'
                              : 'border-border hover:bg-muted/40'
                          }`}
                          title={STATUS_LABELS[h.status]}
                        >
                          {h.approvalRef}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={hasPendingChanges || changed.length === 0 || isSubmitting}
            onClick={handleApply}
          >
            {isSubmitting ? 'Aplicando…' : 'Aplicar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
