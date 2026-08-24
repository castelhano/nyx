'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Icons }             from '@/lib/icons'
import { AutoBreadcrumb }    from '@/core/AutoBreadcrumb'
import { usePageGuard }      from '@/core/usePageGuard'
import { useRecordQuery }    from '@/core/useRecordQuery'
import { useTopbarActions }  from '@/components/layout/topbar-actions-context'
import { apiFetch }          from '@/lib/auth'
import { useToast }          from '@/lib/toast-context'
import { extractError }      from '@/lib/utils'
import { NewPlanForm }       from './components/NewPlanForm'
import { InlineDescription } from './components/InlineDescription'
import { useGanttEditor } from './hooks/useGanttEditor'
import { useSolverController } from './hooks/useSolverController'
import { useVehiclePlanShortcuts } from './hooks/useVehiclePlanShortcuts'
import { GanttBoard }        from './components/GanttBoard'
import type { GanttBoardHandle } from './components/GanttBoard'
import { GanttActionBar }    from './components/GanttActionBar'
import { HeadwayRangeBar }   from './components/HeadwayRangeBar'
import { LineFreqPanel }     from './components/LineFreqPanel'
import { LinesPanel }        from './components/LinesPanel'
import { SwitchLineScheduleModal } from './components/SwitchLineScheduleModal'
import { FrequencyPanel }    from './components/FrequencyPanel'
import { TripSummaryPanel }  from './components/TripSummaryPanel'
import { OptimizeModal }         from './components/OptimizeModal'
import { AccessModal }           from './components/AccessModal'
import { AddIntervalModal }      from './components/AddIntervalModal'
import { SolverProposalDialog }  from './components/SolverProposalDialog'
import { AddTripModal }          from './components/AddTripModal'
import { LineScheduleGeneratorModal } from './components/LineScheduleGeneratorModal'
import type { VehiclePlanGanttData, GanttBlockTrip, GanttBlockDeadrun, GanttBlockInterval } from './views/vehicles.view'
import { computeHeadway } from './views/vehicles.view'
import type { ViewportSnapshot } from './engine/gantt.types'

const INITIAL_VP: ViewportSnapshot = { scrollX: 0, scrollY: 0, pixelsPerMinute: 1.2, width: 0, dayStartMinute: 0 }

// ── page ──────────────────────────────────────────────────────────────────────

export default function VehiclePlanPage() {
  const { id }      = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { toast }   = useToast()

  const isNew = id === 'new'

  const [isPending, setIsPending] = useState(false)

  // ── data ────────────────────────────────────────────────────────────────────

  const { data: record, error: recordError } = useRecordQuery(
    ['transit', 'vehicle-plan', id],
    `/transit/vehicle-plan/${id}`,
    { enabled: !isNew, staleTime: 30_000 },
  )

  const { guardNode, canUpdate } = usePageGuard(
    'transit', 'vehicle-plan', isNew, recordError ?? undefined,
  )

  const status = record?.status as string | undefined
  // Edit bar stays reachable on active plans for navigation/inspection (trip detail
  // panel, keyboard nav) — only mutating actions require DRAFT + canUpdate.
  const canEdit = canUpdate && status === 'DRAFT'

  const { data: ganttData, refetch: refetchGantt } = useQuery<VehiclePlanGanttData>({
    queryKey: ['transit', 'vehicle-plan', id, 'gantt'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/gantt-data`)
      if (!res.ok) throw new Error('Falha ao carregar dados do Gantt')
      return res.json() as Promise<VehiclePlanGanttData>
    },
    enabled:   !isNew,
    staleTime: 10_000,
  })

  // Editing state/logic (pending changes, selection, keyboard nav) lives in
  // useGanttEditor; useVehiclePlanShortcuts below just binds keys to its handlers,
  // so it must run after this call — it destructures values (selection,
  // focusedSegId, mergedPlottedData, ...) straight out of `editor`.
  const editor = useGanttEditor({ id, canEdit, ganttData, refetchGantt, setIsPending })
  const {
    selection, setSelection,
    depotModal, setDepotModal,
    addIntervalModal, setAddIntervalModal,
    moveTargetBlockId, setMoveTargetBlockId,
    pendingAdds, pendingDeletes, pendingDeadrunDeletes, pendingIntervalDeletes,
    setPendingAdds, setPendingDeletes, setPendingDeadrunDeletes, setPendingChanges, setPendingDeadrunChanges,
    editBarOpen,
    focusedSegId, setFocusedSegId,
    tripSeqAnchor, setTripSeqAnchor,
    selectedLineIds, setSelectedLineIds,
    plottedData, mergedPlottedData,
    allTrips, navBlocks, tripSeqRangeIds, headwayRangeInfo, freqIndex,
    addTripReference, moveTargetBlocks, moveTargetHints,
    pendingCount, isSaving,
    stepMoveTarget,
    handleSelectionChange, handlePendingAdd, clearAllPending, handleToggleEditBar,
    handleSavePendingWithConfirm, handleDiscardPendingWithConfirm,
    handleConfirmAddInterval, discardBreaks,
    handleConfirmMove, handleConfirmDepotModal,
    vehiclesActionSpec,
    handleAdjustCycle, handleFinalizePlan, handleDistributeHeadway, handleTripTimingOp,
  } = editor

  const [linesPanelOpen,    setLinesPanelOpen]    = useState(false)
  const [freqPanelOpen,     setFreqPanelOpen]     = useState(false)
  const [ganttVp,           setGanttVp]           = useState<ViewportSnapshot>(INITIAL_VP)
  const [versionsModalOpen, setVersionsModalOpen] = useState(false)
  const [generateLineModal, setGenerateLineModal] = useState<{ lineId: string } | null>(null)
  const [addTripOpen,       setAddTripOpen]       = useState(false)

  // ── side frequency panel — read-only mirror of the focused trip in the
  // Gantt (see LineFreqPanel.tsx), no focus/selection of its own
  const [lineFreqOpen,  setLineFreqOpen]  = useState(false)

  const ganttBoardRef       = useRef<GanttBoardHandle>(null)
  const shiftAnchorRef      = useRef<string | null>(null)
  const groupAnchorSegIdRef = useRef<string | null>(null)

  useVehiclePlanShortcuts({
    canEdit, isNew, ganttBoardRef, shiftAnchorRef,
    selection, setSelection, focusedSegId, setFocusedSegId, tripSeqAnchor, setTripSeqAnchor,
    moveTargetBlockId, setMoveTargetBlockId, editBarOpen, selectedLineIds, navBlocks, allTrips,
    mergedPlottedData, moveTargetBlocks, pendingAdds, pendingDeletes, pendingDeadrunDeletes, pendingIntervalDeletes,
    setPendingAdds, setPendingDeletes, setPendingChanges, setPendingDeadrunDeletes, setPendingDeadrunChanges,
    pendingCount, setFreqPanelOpen, setAddTripOpen, setLineFreqOpen, setLinesPanelOpen,
    clearAllPending, handleSavePendingWithConfirm, handleDiscardPendingWithConfirm, handleToggleEditBar,
    handleSelectionChange, vehiclesActionSpec, stepMoveTarget, handleConfirmMove, handleDistributeHeadway,
    handleFinalizePlan, handleTripTimingOp, discardBreaks,
  })

  // ── solver ──────────────────────────────────────────────────────────────────

  const solver = useSolverController({ id, canUpdate, record, ganttData, refetchGantt, setIsPending })
  const {
    activeJobId,
    isSolverDone,
    optimizeModalOpen, setOptimizeModalOpen,
    detailsOpen, setDetailsOpen,
    baselineSnapshot,
    solverProgress,
    handleOptimize, handleClearMetrics, handleStop, handleAssumeBest, handleDiscard, handleDelete, handleActivate,
  } = solver

  // ── topbar ───────────────────────────────────────────────────────────────────

  const planLines        = ganttData?.plan?.lines ?? []
  const hasCustomMetrics = !!( (record as Record<string, unknown> | undefined)?.metrics )
  const fleetDelta       = baselineSnapshot != null && solverProgress.bestScenario != null
    ? solverProgress.bestScenario.fleetCount - baselineSnapshot.fleetCount
    : null

  useTopbarActions([
    // edit-bar toggle — always visible, aligned to the start
    ...(!isNew ? [{
      label:    'Barra Edição',
      icon:     Icons.SlidersHorizontal,
      size:     'icon' as const,
      onClick:  () => handleToggleEditBar(),
      disabled: !editBarOpen && selectedLineIds.size === 0,
      variant:  (editBarOpen ? 'default' : 'ghost') as 'default' | 'ghost',
      keybind:  'F9',
      position: 'start' as const,
    }] : []),

    // ── edit mode ──────────────────────────────────────────────────────────────
    // Navigation/inspection stays available even on active plans; actions that
    // write changes (trip, generate, save, clear) require canEdit (DRAFT).
    ...(editBarOpen ? [
      ...(canEdit ? [
        {
          label:    'Viagem',
          icon:     Icons.Plus,
          size:     'sm' as const,
          variant:  'ghost' as const,
          onClick:  () => setAddTripOpen(true),
          keybind:  'alt+n',
        },
        { label: '', separator: true },
        {
          // Generates a service proposal (windows/fleet/supply×demand) for the
          // line selected in "Linhas" — the solver's optimization flow is a
          // separate action, labeled "Otimizar" (see "normal mode" block below).
          label:    'Gerar',
          icon:     Icons.Play,
          size:     'sm' as const,
          variant:  'ghost' as const,
          onClick:  () => setGenerateLineModal({ lineId: [...selectedLineIds][0] }),
          disabled: selectedLineIds.size !== 1,
          menu: [
            {
              label:    'Ajustar Ciclo',
              icon:     Icons.Timer,
              onClick:  handleAdjustCycle,
              disabled: isPending,
            },
            {
              label:    'Finalizar Plano',
              icon:     Icons.CheckCircle,
              onClick:  handleFinalizePlan,
              disabled: isPending,
            },
          ],
        },
        { label: '', separator: true },
        {
          label:    isSaving ? 'Salvando…' : pendingCount > 0 ? `Salvar (${pendingCount})` : 'Salvar',
          icon:     Icons.Save,
          size:     'sm' as const,
          onClick:  handleSavePendingWithConfirm,
          disabled: isPending || pendingCount === 0,
          keybind:  'Alt+G',
        },
        {
          label:    'Limpar',
          icon:     Icons.Undo2,
          size:     'sm' as const,
          onClick:  handleDiscardPendingWithConfirm,
          disabled: isPending || pendingCount === 0,
          variant:  'destructive' as const,
          keybind:  'Alt+L',
        },
      ] : []),
    ] : [
    // ── normal mode ────────────────────────────────────────────────────────────
      // lines panel toggle
      ...(!isNew ? [{
        label:   'Linhas',
        icon:    Icons.List,
        onClick: () => setLinesPanelOpen(v => !v),
        menu: [
          { label: 'Versões', icon: Icons.GitBranch, onClick: () => {
            if (selectedLineIds.size === 0) { toast.error('Selecione ao menos uma linha em "Linhas" primeiro'); return }
            setVersionsModalOpen(true)
          } },
        ],
      }] : []),
      // stop: only while stream is open
      ...(activeJobId && !isSolverDone ? [{
        label:    'Parar',
        icon:     Icons.Square,
        onClick:  handleStop,
        disabled: isPending,
      }] : []),
      // optimize
      ...((!activeJobId || isSolverDone) && canEdit ? [{
        label:    isPending ? 'Otimizando…' : 'Otimizar',
        icon:     Icons.Play,
        onClick:  () => setOptimizeModalOpen(true),
        disabled: isPending,
      }] : []),
      // activate
      ...(!activeJobId && canEdit ? [{
        label:    isPending ? 'Ativando…' : 'Ativar',
        icon:     Icons.CheckCircle,
        onClick:  handleActivate,
        disabled: isPending,
        overflow: true,
      }] : []),
      // delete
      ...(!activeJobId && canEdit ? [{
        label:    'Excluir',
        icon:     Icons.Trash2,
        onClick:  handleDelete,
        disabled: isPending,
        variant:  'destructive' as const,
        overflow: true,
      }] : []),
    ]),
  ], [isPending, isSaving, activeJobId, isSolverDone, canUpdate, canEdit, status, isNew, selectedLineIds, editBarOpen, pendingCount])

  // ── trip summary panel ────────────────────────────────────────────────────
  // Tracks the segment whose data the panel shows: the single selected/focused
  // segment, or — once a group (interval) selection starts — the segment that
  // was selected right before it grew into a group, kept fixed while it grows.
  if (!selection) {
    groupAnchorSegIdRef.current = null
  } else if (selection.type === 'trip') {
    groupAnchorSegIdRef.current = selection.segment.id
  } else if (!groupAnchorSegIdRef.current) {
    groupAnchorSegIdRef.current = selection.from.id
  }

  const summarySegId = selection ? groupAnchorSegIdRef.current : focusedSegId

  let summaryTrip:    GanttBlockTrip     | null = null
  let summaryDeadrun: GanttBlockDeadrun  | null = null
  let summaryBreak:   GanttBlockInterval | null = null
  if (summarySegId && mergedPlottedData) {
    if (summarySegId.endsWith(':dr')) {
      const drId = summarySegId.slice(0, -3)
      for (const block of mergedPlottedData.blocks) {
        const dr = block.blockDeadruns.find(dr => dr.id === drId)
        if (dr) { summaryDeadrun = dr; break }
      }
    } else if (summarySegId.endsWith(':bk')) {
      const bkId = summarySegId.slice(0, -3)
      for (const block of mergedPlottedData.blocks) {
        const bi = block.blockIntervals.find(bi => bi.id === bkId)
        if (bi) { summaryBreak = bi; break }
      }
    } else {
      for (const block of mergedPlottedData.blocks) {
        const bt = block.blockTrips.find(bt => bt.id === summarySegId)
        if (bt) { summaryTrip = bt; break }
      }
    }
  }
  const summaryHeadway = summaryTrip && mergedPlottedData
    ? computeHeadway(summaryTrip, mergedPlottedData.blocks)
    : null

  // ── render ─────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  if (isNew) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-4 pb-2 shrink-0">
          <AutoBreadcrumb domain="transit" resource="vehicle-plan" id={id} />
        </div>
        <NewPlanForm />
      </div>
    )
  }

  const recordName = record ? String(record.status ?? '') : undefined

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {isSaving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 bg-card border border-border rounded-lg shadow-xl px-6 py-4">
            <Icons.Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium">Salvando alterações…</span>
          </div>
        </div>
      )}

      {optimizeModalOpen && (
        <OptimizeModal
          hasCustomMetrics={hasCustomMetrics}
          onConfirm={handleOptimize}
          onClearMetrics={handleClearMetrics}
          onClose={() => setOptimizeModalOpen(false)}
        />
      )}

      {versionsModalOpen && ganttData?.plan?.dayType && (
        <SwitchLineScheduleModal
          planId={id}
          dayTypeId={ganttData.plan.dayType.id}
          dayTypeName={ganttData.plan.dayType.name}
          lines={planLines.filter(l => selectedLineIds.has(l.lineId))}
          hasPendingChanges={pendingCount > 0}
          onApplied={async () => { await refetchGantt() }}
          onClose={() => setVersionsModalOpen(false)}
        />
      )}

      {depotModal && (
        <AccessModal
          title={depotModal.kind === 'access' ? 'Adicionar Acesso' : 'Adicionar Recolhida'}
          onConfirm={handleConfirmDepotModal}
          onClose={() => setDepotModal(null)}
        />
      )}

      {addIntervalModal && (
        <AddIntervalModal
          onConfirm={handleConfirmAddInterval}
          onClose={() => setAddIntervalModal(null)}
        />
      )}

      {addTripOpen && mergedPlottedData && selectedLineIds.size > 0 && (
        <AddTripModal
          planId={id}
          dayTypeCode={ganttData?.plan?.dayType?.code ?? 'U'}
          plottedLines={mergedPlottedData.plan.lines.filter(l => selectedLineIds.has(l.lineId))}
          plottedBlocks={mergedPlottedData.blocks}
          reference={addTripReference}
          onClose={() => setAddTripOpen(false)}
          onPendingAdd={handlePendingAdd}
        />
      )}

      {detailsOpen && (
        <SolverProposalDialog
          baseline={baselineSnapshot}
          proposal={solverProgress.bestScenario}
          proposalCount={solverProgress.proposalCount}
          isPending={isPending}
          canDiscard={isSolverDone || solverProgress.bestScenario != null}
          onClose={() => setDetailsOpen(false)}
          onAssume={handleAssumeBest}
          onDiscard={handleDiscard}
        />
      )}

      <div className="px-6 pt-4 pb-2 shrink-0 flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <AutoBreadcrumb domain="transit" resource="vehicle-plan" id={id} recordName={recordName} />

          {/* summary bar */}
          {record && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <InlineDescription
                value={(record as Record<string, unknown>).description as string | undefined}
                disabled={!canUpdate}
                onSave={async (val) => {
                  const res = await apiFetch(`/transit/vehicle-plan/${id}`, {
                    method: 'PATCH',
                    body:   JSON.stringify({ description: val }),
                  })
                  if (!res.ok) {
                    const json = await res.json().catch(() => ({}))
                    throw new Error(extractError(json))
                  }
                  await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
                }}
              />
              <span>
                Status:{' '}
                <span className={status === 'ACTIVE' ? 'text-green-600 font-medium' : 'font-medium'}>
                  {status === 'ACTIVE' ? 'Ativo' : 'Rascunho'}
                </span>
              </span>
              {ganttData?.plan?.dayType && (
                <span>Tipo: <span className="font-medium">{ganttData.plan.dayType.code}</span></span>
              )}
              {ganttData?.plan?.lines != null && (
                <span>{ganttData.plan.lines.length} {ganttData.plan.lines.length === 1 ? 'linha' : 'linhas'}</span>
              )}
              {ganttData?.blocks != null && (
                <span>{ganttData.blocks.length} {ganttData.blocks.length === 1 ? 'bloco' : 'blocos'}</span>
              )}
              {ganttData?.blocks != null && (
                <span>
                  {ganttData.blocks.reduce((sum, b) => sum + b.blockTrips.length, 0)} viagens produtivas
                </span>
              )}
              {activeJobId && (
                <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
                  <span className={`px-1.5 py-0.5 rounded font-semibold ${
                    isSolverDone
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  }`}>
                    LVL {solverProgress.currentLevel} {solverProgress.currentLevelLabel}
                  </span>
                  <span className="text-muted-foreground">—</span>
                  <span className={!isSolverDone ? 'text-blue-600 animate-pulse' : 'text-muted-foreground'}>
                    {solverProgress.totalIterations.toLocaleString('pt-BR')}
                  </span>
                  <span className="bg-muted rounded px-1 py-0.5 text-muted-foreground">
                    [{solverProgress.proposalCount}]
                  </span>
                  {fleetDelta != null && (
                    <span className={`rounded px-1 py-0.5 ${
                      fleetDelta < 0
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                        : fleetDelta > 0
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                          : 'bg-muted text-muted-foreground'
                    }`}>
                      [{fleetDelta > 0 ? '+' : ''}{fleetDelta}]
                    </span>
                  )}
                  <button
                    onClick={() => setDetailsOpen(true)}
                    className="rounded px-1 py-0.5 bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  >
                    [Detalhes]
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {editBarOpen && (summaryTrip || summaryDeadrun || summaryBreak) && (
          <TripSummaryPanel trip={summaryTrip} deadrun={summaryDeadrun} breakItem={summaryBreak} headway={summaryHeadway} />
        )}
      </div>

      {/* gantt + lines panel */}
      <div className="flex flex-1 min-h-0 border-t overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 relative">
            {mergedPlottedData ? (
              mergedPlottedData.blocks.length > 0 ? (
                <GanttBoard
                  ref={ganttBoardRef}
                  data={mergedPlottedData}
                  onViewportChange={setGanttVp}
                  selection={editBarOpen ? selection : null}
                  onSelectionChange={handleSelectionChange}
                  actionSpec={editBarOpen ? vehiclesActionSpec : undefined}
                  onBlockUpdate={refetchGantt}
                  focusedSegId={editBarOpen ? focusedSegId : null}
                  moveTargetBlockId={editBarOpen ? moveTargetBlockId : null}
                  moveTargetHints={moveTargetHints}
                  highlightedSegIds={editBarOpen ? tripSeqRangeIds : null}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {selectedLineIds.size === 0
                    ? 'Selecione linhas no painel lateral para visualizar'
                    : 'Nenhum bloco para as linhas selecionadas'}
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Carregando…
              </div>
            )}

            {editBarOpen && selection && mergedPlottedData && (
              <GanttActionBar
                selection={selection}
                actions={vehiclesActionSpec.getActions(selection, mergedPlottedData, () => setSelection(null))}
                onDismiss={() => setSelection(null)}
              />
            )}

            {editBarOpen && canEdit && !selection && headwayRangeInfo && (
              <HeadwayRangeBar
                count={headwayRangeInfo.trips.length}
                singleLine={headwayRangeInfo.singleLine}
                onDistribute={handleDistributeHeadway}
              />
            )}

            {lineFreqOpen && editBarOpen && freqIndex && (
              <LineFreqPanel
                index={freqIndex}
                focusedSegId={focusedSegId}
                onFocusChange={(segId) => { setTripSeqAnchor(null); setFocusedSegId(segId) }}
                rangeSegIds={tripSeqRangeIds}
              />
            )}
          </div>

          {freqPanelOpen && plottedData && (
            <FrequencyPanel data={mergedPlottedData ?? plottedData} vp={ganttVp} />
          )}
        </div>

        {linesPanelOpen && (
          <LinesPanel
            planId={id}
            planLines={ganttData?.plan?.lines ?? []}
            selectedLineIds={selectedLineIds}
            onSelectionChange={setSelectedLineIds}
            onClose={() => setLinesPanelOpen(false)}
            onLineCleared={() => refetchGantt()}
            canClear={canEdit}
          />
        )}

        {generateLineModal && (
          <LineScheduleGeneratorModal
            planId={id}
            lineId={generateLineModal.lineId}
            dayTypeCode={ganttData?.plan?.dayType?.code ?? ''}
            existingTripIds={
              (ganttData?.blocks ?? [])
                .flatMap(b => b.blockTrips)
                .filter(bt => bt.trip.route.line.id === generateLineModal.lineId)
                .map(bt => bt.trip.id)
            }
            hasPendingChanges={pendingCount > 0}
            onClose={() => setGenerateLineModal(null)}
            onPendingAdd={handlePendingAdd}
            onPendingDeleteTrips={(tripIds) => setPendingDeletes(prev => new Set([...prev, ...tripIds]))}
          />
        )}
      </div>
    </div>
  )
}