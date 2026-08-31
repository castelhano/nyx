'use client'

import { useState, useEffect, useRef } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { useShortcutContext } from '@/lib/keywatch'
import type { LineMetrics, GanttBlock } from '../views/vehicles.view'
import type { PendingAddEntry } from './AddTripModal'
import { computeScheduleSwitch, type LineDepartureForSwitch } from '../switch-schedule-logic'

interface LineScheduleRow {
  id:          string
  status:      'DRAFT' | 'APPROVED' | 'SUPERSEDED' | 'ARCHIVED'
  approvalRef: string
  approvedAt:  string | null
  createdAt:   string
}

interface RouteRow {
  id:                    string
  direction:             string
  originLocalityId:      string
  destinationLocalityId: string
}

interface LocalityRow {
  id:   string
  name: string
}

export interface PlanLineInfo {
  lineId:         string
  line:           { id: string; code: string; name: string; metrics: LineMetrics | null }
  lineScheduleId: string | null
  lineSchedule:   { id: string; status: string; approvalRef: string | null } | null
  isDrifted?:     boolean
}

interface Props {
  planId:            string
  dayTypeId:         string
  dayTypeCode:       string
  dayTypeName?:      string
  lines:             PlanLineInfo[]
  blocks:            GanttBlock[]
  hasPendingChanges: boolean
  onClose:           () => void
  onApplied:         () => void | Promise<void>
  onPendingAdd:         (entry: PendingAddEntry) => void
  onQueueTripDeletes:   (tripIds: string[]) => void
  onScheduleSwitchStaged: (lineId: string, lineScheduleId: string) => void
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

export function SwitchLineScheduleModal({
  planId, dayTypeId, dayTypeCode, dayTypeName, lines, blocks, hasPendingChanges, onClose, onApplied,
  onPendingAdd, onQueueTripDeletes, onScheduleSwitchStaged,
}: Props) {
  useShortcutContext('switch_schedule_md')
  const { toast }   = useToast()
  const confirm     = useConfirm()
  const queryClient = useQueryClient()

  // "Nova OSO" inline creation — badge dropdown (só para linhas "Em análise") → form → Gravar
  const [openMenuLineId, setOpenMenuLineId] = useState<string | null>(null)
  const [creatingLineId, setCreatingLineId] = useState<string | null>(null)
  const [draftRefByLine,   setDraftRefByLine]   = useState<Map<string, string>>(new Map())
  const [draftNotesByLine, setDraftNotesByLine] = useState<Map<string, string>>(new Map())
  const [savingLineId,     setSavingLineId]     = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Reconcile: line already linked to a schedule, but with diverging trips
  // (isDrifted). DRAFT → syncs in-place; any other status → creates and
  // immediately activates a new version.
  const [reconcilingLineId, setReconcilingLineId] = useState<string | null>(null)

  // Switching to a different approved OSO version — stages trip adds/deletes and a
  // pending schedule pin (see useGanttEditor's pendingLineSchedulePin), never
  // writes directly. One line at a time: hasPendingChanges (from the staged diff)
  // already blocks starting another switch until the user saves or discards.
  const [switchingTo, setSwitchingTo] = useState<{ lineId: string; lineScheduleId: string } | null>(null)

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

  // Route direction/localities per line — needed to resolve cycle time and to
  // build the PendingAddTrip entries when switching to a different OSO version.
  const routesQueries = useQueries({
    queries: lines.map(l => ({
      queryKey: ['transit', 'transit-route', 'by-line', l.lineId],
      queryFn:  async (): Promise<RouteRow[]> => {
        const res = await apiFetch(`/transit/transit-route?f_lineId=${l.lineId}&pageSize=999`)
        if (!res.ok) return []
        const json = await res.json()
        return json.data ?? []
      },
    })),
  })

  const { data: localities = [] } = useQuery<LocalityRow[]>({
    queryKey: ['transit', 'transit-locality', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/transit-locality?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })

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
      await queryClient.invalidateQueries({ queryKey: ['transit', 'line-schedule', 'history', lineId, dayTypeId] })
      cancelCreating(lineId)
      toast.success(`OSO ${approvalRef} criada`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar OSO')
    } finally {
      setSavingLineId(null)
    }
  }

  async function handleReconcile(l: PlanLineInfo) {
    if (!l.lineSchedule || reconcilingLineId) return
    const isDraft = l.lineSchedule.status === 'DRAFT'

    const ok = await confirm({
      title:        isDraft ? 'Sincronizar OSO' : 'Nova versão da OSO',
      description:  isDraft
        ? `A OSO ${l.lineSchedule.approvalRef} será atualizada para corresponder ao plano atual. Essa ação não pode ser desfeita.`
        : `A OSO ${l.lineSchedule.approvalRef} está ${STATUS_LABELS[l.lineSchedule.status]} e não pode ser alterada. Será criada nova OSO (rascunho), com partidas do plano.`,
      confirmLabel: isDraft ? 'Sincronizar' : 'Criar nova versão',
      variant:      'safeConfirm',
    })
    if (!ok) return

    setReconcilingLineId(l.lineId)
    try {
      const res = await apiFetch(
        `/transit/vehicle-plan/${planId}/lines/${l.lineId}/${isDraft ? 'sync-schedule' : 'activate-new-schedule'}`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json, 'Erro ao aplicar OSO'))
      }
      const result: { id: string; approvalRef: string } = await res.json()
      await queryClient.invalidateQueries({ queryKey: ['transit', 'line-schedule', 'history', l.lineId, dayTypeId] })
      toast.success(isDraft ? `OSO ${result.approvalRef} sincronizada` : `Nova versão ${result.approvalRef} ativada`)
      await onApplied()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao aplicar OSO')
    } finally {
      setReconcilingLineId(null)
    }
  }

  // Switches a line to a different OSO version — never writes directly. Stages the
  // line's current trips in this plan as pending deletes, the target schedule's
  // departures as pending adds (grouped into blocks, not one-per-trip), and the
  // schedule pin as pending too, all only taking effect when the user saves the
  // Gantt's normal pending-changes flow.
  async function handleSwitchTo(l: PlanLineInfo, idx: number, targetId: string, targetRef: string) {
    if (switchingTo || hasPendingChanges) return

    const ok = await confirm({
      title:        'Trocar quadro de horários',
      description:  `As viagens da linha ${l.line.code} neste plano serão apagadas e recriadas a partir da OSO ${targetRef}, com o ciclo atualizado — ficam pendentes até você salvar.`,
      confirmLabel: 'Trocar',
      variant:      'safeConfirm',
    })
    if (!ok) return

    setSwitchingTo({ lineId: l.lineId, lineScheduleId: targetId })
    try {
      const depRes = await apiFetch(`/transit/line-departure?lineScheduleId=${targetId}&pageSize=999`)
      if (!depRes.ok) throw new Error('Erro ao buscar partidas da OSO')
      const depJson = await depRes.json()
      const rows: Array<{ id: string; routeId: string; departureMinutes: number; requiredVehicleType?: string | null }> = depJson.data ?? []

      const routes     = routesQueries[idx].data ?? []
      const routeById  = new Map(routes.map(r => [r.id, r]))
      const localityById = new Map(localities.map(loc => [loc.id, loc.name]))

      const departures: LineDepartureForSwitch[] = []
      for (const d of rows) {
        const route = routeById.get(d.routeId)
        if (!route) continue
        departures.push({
          id:                  d.id,
          routeId:             d.routeId,
          departureMinutes:    d.departureMinutes,
          requiredVehicleType: d.requiredVehicleType,
          route: { direction: route.direction, originLocalityId: route.originLocalityId, destinationLocalityId: route.destinationLocalityId },
        })
      }
      if (departures.length === 0) throw new Error('OSO selecionada não tem partidas com rota reconhecida')

      const { blocks: scheduleBlocks, warnings } = await computeScheduleSwitch(departures, l.line.metrics, dayTypeCode)
      if (scheduleBlocks.length === 0) throw new Error(warnings[0] ?? 'Nenhuma partida pôde ser posicionada')

      for (const block of scheduleBlocks) {
        let anchorTempId: string | null = null
        for (const trip of block) {
          const route = routeById.get(trip.routeId)!
          const originLocality      = { id: route.originLocalityId,      name: localityById.get(route.originLocalityId) ?? '' }
          const destinationLocality = { id: route.destinationLocalityId, name: localityById.get(route.destinationLocalityId) ?? '' }
          onPendingAdd({
            _kind:               'trip',
            _tempId:             trip._tempId,
            routeId:             trip.routeId,
            direction:           route.direction,
            lineId:              l.lineId,
            lineCode:            l.line.code,
            lineName:            l.line.name,
            lineMetrics:         l.line.metrics,
            originLocality, destinationLocality,
            departureMinutes:    trip.departureMinutes,
            arrivalMinutes:      trip.arrivalMinutes,
            blockId:             anchorTempId ? `pending:${anchorTempId}` : 'new',
            requiredVehicleType: trip.requiredVehicleType,
          })
          if (!anchorTempId) anchorTempId = trip._tempId
        }
      }

      const currentTripIds = blocks
        .flatMap(b => b.blockTrips)
        .filter(bt => bt.trip.route.line.id === l.lineId)
        .map(bt => bt.trip.id)
      if (currentTripIds.length > 0) onQueueTripDeletes(currentTripIds)

      onScheduleSwitchStaged(l.lineId, targetId)

      if (warnings.length > 0) toast.error(`${warnings.length} partida(s) sem dado de ciclo/tempo de viagem foram ignoradas`)
      toast.success(`OSO ${targetRef} pronta para revisão — salve para aplicar`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao trocar OSO')
    } finally {
      setSwitchingTo(null)
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
                    <span className="flex items-center gap-1">
                      <span className={`text-xs rounded-full border px-2 py-0.5 ${STATUS_CLASSES[l.lineSchedule.status]}`}>
                        {l.lineSchedule.approvalRef} - {STATUS_LABELS[l.lineSchedule.status]}
                      </span>
                      <a
                        href={`/transit/line-schedule/${l.lineSchedule.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Editar OSO"
                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                      >
                        <Icons.ExternalLink className="w-3 h-3" />
                      </a>
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

                {l.lineSchedule && l.isDrifted && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 px-2.5 py-1.5">
                    <span className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <Icons.AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      Viagens desta linha no plano divergem da OSO vinculada
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={hasPendingChanges || reconcilingLineId === l.lineId}
                      onClick={() => handleReconcile(l)}
                    >
                      {reconcilingLineId === l.lineId
                        ? 'Aplicando…'
                        : l.lineSchedule.status === 'DRAFT' ? 'Sincronizar' : 'Nova versão'}
                    </Button>
                  </div>
                )}

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
                      const isActive     = h.id === l.lineScheduleId
                      const isThisTarget = switchingTo?.lineId === l.lineId && switchingTo.lineScheduleId === h.id
                      return (
                        <button
                          key={h.id}
                          type="button"
                          disabled={hasPendingChanges || switchingTo !== null}
                          onClick={() => !isActive && handleSwitchTo(l, idx, h.id, h.approvalRef)}
                          className={`text-xs rounded-full border px-2.5 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            isActive
                              ? 'border-ring bg-accent font-medium'
                              : 'border-border hover:bg-muted/40'
                          }`}
                          title={STATUS_LABELS[h.status]}
                        >
                          {isThisTarget ? 'Trocando…' : h.approvalRef}
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
            Fechar
          </Button>
        </div>
      </div>
    </div>
  )
}
