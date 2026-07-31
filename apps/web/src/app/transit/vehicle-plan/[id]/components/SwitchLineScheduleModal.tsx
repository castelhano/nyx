'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
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
  dayTypeName?:      string
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

export function SwitchLineScheduleModal({ planId, dayTypeId, dayTypeName, lines, hasPendingChanges, onClose, onApplied }: Props) {
  useShortcutContext('modal')
  const { toast }   = useToast()
  const confirm     = useConfirm()
  const queryClient = useQueryClient()

  const [selections,   setSelections]   = useState<Map<string, string | null>>(
    () => new Map(lines.map(l => [l.lineId, l.lineScheduleId])),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  // "Nova OSO" inline creation — badge dropdown (só para linhas "Em análise") → form → Gravar
  const [openMenuLineId, setOpenMenuLineId] = useState<string | null>(null)
  const [creatingLineId, setCreatingLineId] = useState<string | null>(null)
  const [draftRefByLine,   setDraftRefByLine]   = useState<Map<string, string>>(new Map())
  const [draftNotesByLine, setDraftNotesByLine] = useState<Map<string, string>>(new Map())
  const [savingLineId,     setSavingLineId]     = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!openMenuLineId) return
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuLineId(null)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [openMenuLineId])

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

  function startCreating(lineId: string) {
    setOpenMenuLineId(null)
    setCreatingLineId(lineId)
  }

  function cancelCreating(lineId: string) {
    setCreatingLineId(null)
    setDraftRefByLine(prev => { const next = new Map(prev); next.delete(lineId); return next })
    setDraftNotesByLine(prev => { const next = new Map(prev); next.delete(lineId); return next })
  }

  async function handleCreateSchedule(lineId: string) {
    const approvalRef = (draftRefByLine.get(lineId) ?? '').trim()
    if (!approvalRef || savingLineId) return

    setSavingLineId(lineId)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/lines/${lineId}/schedules`, {
        method: 'POST',
        body:   JSON.stringify({
          approvalRef,
          notes: (draftNotesByLine.get(lineId) ?? '').trim() || undefined,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json, 'Erro ao criar OSO'))
      }
      const created = await res.json()
      setSelections(prev => new Map(prev).set(lineId, created.id))
      await queryClient.invalidateQueries({ queryKey: ['transit', 'line-schedule', 'history', lineId, dayTypeId] })
      cancelCreating(lineId)
      toast.success(`OSO ${approvalRef} criada`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar OSO')
    } finally {
      setSavingLineId(null)
    }
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
            const isCreating  = creatingLineId === l.lineId
            const isSaving    = savingLineId === l.lineId

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
                    <div className="relative" ref={openMenuLineId === l.lineId ? menuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setOpenMenuLineId(v => v === l.lineId ? null : l.lineId)}
                        className={`flex items-center gap-1 text-xs rounded-full border px-2 py-0.5 hover:brightness-95 transition-[filter] ${ANALISE_CLASSES}`}
                      >
                        Em análise
                        <Icons.ChevronDown className="w-3 h-3" />
                      </button>
                      {openMenuLineId === l.lineId && (
                        <div className="absolute right-0 top-full mt-1 w-32 bg-background border border-border rounded shadow-md z-10 text-xs">
                          <button
                            type="button"
                            onClick={() => startCreating(l.lineId)}
                            className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                          >
                            Nova OSO
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {isCreating ? (
                  <div className="space-y-2 rounded-md border border-dashed border-border p-2.5">
                    {dayTypeName && (
                      <p className="text-[11px] text-muted-foreground">Tipo de dia: <span className="font-medium">{dayTypeName}</span></p>
                    )}
                    <div>
                      <label className="text-[11px] text-muted-foreground">OSO <span className="text-destructive">*</span></label>
                      <input
                        type="text"
                        autoFocus
                        value={draftRefByLine.get(l.lineId) ?? ''}
                        onChange={e => setDraftRefByLine(prev => new Map(prev).set(l.lineId, e.target.value))}
                        placeholder="No do processo"
                        className="w-full mt-0.5 text-xs rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Observações</label>
                      <textarea
                        value={draftNotesByLine.get(l.lineId) ?? ''}
                        onChange={e => setDraftNotesByLine(prev => new Map(prev).set(l.lineId, e.target.value))}
                        rows={2}
                        className="w-full mt-0.5 text-xs rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-0.5">
                      <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={() => cancelCreating(l.lineId)}>
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!(draftRefByLine.get(l.lineId) ?? '').trim() || isSaving}
                        onClick={() => handleCreateSchedule(l.lineId)}
                      >
                        {isSaving ? 'Gravando…' : 'Gravar'}
                      </Button>
                    </div>
                  </div>
                ) : loading ? (
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
