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
  version:     number
  status:      'DRAFT' | 'APPROVED' | 'SUPERSEDED' | 'ARCHIVED'
  approvalRef: string | null
}

export interface PlanLineInfo {
  lineId:         string
  line:           { id: string; code: string; name: string }
  lineScheduleId: string | null
  lineSchedule:   { id: string; version: number; status: string; approvalRef: string | null } | null
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

const NO_REF_KEY = '__sem_referencia__'

function groupKey(approvalRef: string | null): string {
  return approvalRef?.trim() || NO_REF_KEY
}

export function SwitchLineScheduleModal({ planId, dayTypeId, lines, hasPendingChanges, onClose, onApplied }: Props) {
  useShortcutContext('modal')
  const { toast } = useToast()
  const confirm   = useConfirm()

  const [selections,    setSelections]    = useState<Map<string, string | null>>(
    () => new Map(lines.map(l => [l.lineId, l.lineScheduleId])),
  )
  const [groupOverride, setGroupOverride] = useState<Map<string, string>>(new Map())
  const [isSubmitting,  setIsSubmitting]  = useState(false)

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
        return json.data ?? []
      },
    })),
  })

  const changed = useMemo(
    () => lines.filter(l => (selections.get(l.lineId) ?? null) !== l.lineScheduleId),
    [lines, selections],
  )

  function findVersion(history: LineScheduleRow[], id: string | null): LineScheduleRow | undefined {
    return id ? history.find(h => h.id === id) : undefined
  }

  async function handleApply() {
    if (changed.length === 0 || isSubmitting) return

    const summary = changed.map((l) => {
      const idx     = lines.indexOf(l)
      const history = historyQueries[idx].data ?? []
      const from    = l.lineSchedule ? `v${l.lineSchedule.version}` : 'em análise'
      const target  = findVersion(history, selections.get(l.lineId) ?? null)
      const to      = target ? `v${target.version}` : 'em análise'
      return `${l.line.code}: ${from} → ${to}`
    })

    const ok = await confirm({
      title:        'Trocar quadro de horários',
      description:  `As viagens destas linhas serão recriadas a partir da versão selecionada — o plano precisará ser gerado novamente para reblocar:\n\n${summary.join('\n')}`,
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
          <h2 className="text-base font-semibold">Versões do Quadro de Horários</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {hasPendingChanges && (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <Icons.AlertCircle className="w-4 h-4 shrink-0" />
              Salve ou descarte as alterações pendentes do Gantt antes de trocar de versão.
            </div>
          )}

          {lines.map((l, idx) => {
            const history = historyQueries[idx].data ?? []
            const loading = historyQueries[idx].isLoading

            const groups = new Map<string, LineScheduleRow[]>()
            for (const h of history) {
              const key = groupKey(h.approvalRef)
              if (!groups.has(key)) groups.set(key, [])
              groups.get(key)!.push(h)
            }
            for (const g of groups.values()) g.sort((a, b) => a.version - b.version)
            const groupKeys = [...groups.keys()].sort((a, b) => {
              const maxA = Math.max(...groups.get(a)!.map(h => h.version))
              const maxB = Math.max(...groups.get(b)!.map(h => h.version))
              return maxB - maxA
            })

            const selectedId   = selections.get(l.lineId) ?? null
            const selectedItem = findVersion(history, selectedId)
            const currentGroup = groupOverride.get(l.lineId)
              ?? (selectedItem ? groupKey(selectedItem.approvalRef) : groupKeys[0])
            const badgesInGroup = groups.get(currentGroup) ?? []

            return (
              <div key={l.lineId} className="rounded-md border border-border bg-muted/40 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    <span className="font-mono font-medium">{l.line.code}</span>
                    <span className="text-muted-foreground ml-2">{l.line.name}</span>
                  </span>
                  {l.lineSchedule ? (
                    <span className={`text-xs rounded-full border px-2 py-0.5 ${STATUS_CLASSES[l.lineSchedule.status]}`}>
                      {l.lineSchedule.approvalRef ?? 'Sem referência'} V{l.lineSchedule.version} - {STATUS_LABELS[l.lineSchedule.status]}
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
                  <p className="text-xs text-muted-foreground">Nenhuma versão disponível para esta linha</p>
                ) : (
                  <>
                    <select
                      value={currentGroup}
                      onChange={e => {
                        const key = e.target.value
                        setGroupOverride(prev => new Map(prev).set(l.lineId, key))
                        const first = groups.get(key)?.[groups.get(key)!.length - 1]
                        if (first) setSelections(prev => new Map(prev).set(l.lineId, first.id))
                      }}
                      className="w-full text-xs rounded-sm border border-input bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {groupKeys.map(key => (
                        <option key={key} value={key}>
                          {key === NO_REF_KEY ? 'Sem referência' : key}
                        </option>
                      ))}
                    </select>

                    <div className="flex flex-wrap gap-1.5">
                      {badgesInGroup.map(h => {
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
                            title={`${STATUS_LABELS[h.status]}`}
                          >
                            v{h.version}
                          </button>
                        )
                      })}
                    </div>
                  </>
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
