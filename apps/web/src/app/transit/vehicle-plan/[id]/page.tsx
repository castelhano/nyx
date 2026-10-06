'use client'

import { useState, useRef, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Icons }             from '@/lib/icons'
import { AutoBreadcrumb }    from '@/core/AutoBreadcrumb'
import { usePageGuard }      from '@/core/usePageGuard'
import { useRecordQuery }    from '@/core/useRecordQuery'
import { useTopbarActions }  from '@/components/layout/topbar-actions-context'
import { apiFetch }          from '@/lib/auth'
import { useToast }          from '@/lib/toast-context'
import { useConfirm }        from '@/lib/confirm-context'
import { extractError }      from '@/lib/utils'
import { NewPlanForm }       from './components/NewPlanForm'
import { InlineDescription } from './components/InlineDescription'
import { useGanttEditor } from './hooks/useGanttEditor'
import { useVehiclePlanShortcuts } from './hooks/useVehiclePlanShortcuts'
import { useOsoCoverage } from './hooks/useOsoCoverage'
import { GanttBoard }        from './components/GanttBoard'
import type { GanttBoardHandle } from './components/GanttBoard'
import { GanttActionBar }    from './components/GanttActionBar'
import { HeadwayRangeBar }   from './components/HeadwayRangeBar'
import { BlockFilterBar }    from './components/BlockFilterBar'
import { LineFreqPanel, PANEL_WIDTH as LINE_FREQ_PANEL_WIDTH } from './components/LineFreqPanel'
import { LinesPanel }        from './components/LinesPanel'
import { SwitchLineScheduleModal } from './components/SwitchLineScheduleModal'
import { ExportOsoModal } from './components/ExportOsoModal'
import { PlanExportModal } from './components/PlanExportModal'
import { FrequencyPanel }    from './components/FrequencyPanel'
import { TripSummaryPanel }  from './components/TripSummaryPanel'
import { OptimizeModal, type OptimizeTab, type SolverJob } from './components/OptimizeModal'
import { BACKGROUND_JOBS_KEY } from '@/components/layout/background-jobs'
import { AccessModal }           from './components/AccessModal'
import { AddIntervalModal }      from './components/AddIntervalModal'
import { TripDetailsModal }      from './components/TripDetailsModal'
import { AddTripModal }          from './components/AddTripModal'
import { LineScheduleGeneratorModal } from './components/LineScheduleGeneratorModal'
import { RedistributeModal }          from './components/RedistributeModal'
import { OsoCoverageModal }           from './components/OsoCoverageModal'
import { SyncFromOsoModal }           from './components/SyncFromOsoModal'
import { OsoSavePromptModal }         from './components/OsoSavePromptModal'
import { LineSummaryView }            from './components/LineSummaryView'
import type { VehiclePlanGanttData, GanttBlockTrip, GanttBlockDeadrun, GanttBlockInterval } from './views/vehicles.view'
import { computeHeadway } from './views/vehicles.view'
import { BusyOverlay } from '@/components/ui/busy-overlay'
import { Badge } from '@/components/ui/badge'
import { vigenceBadge } from '@/lib/plan-vigence'
import { ActivationModal } from '../../activation-modal'
import type { ViewportSnapshot } from './engine/gantt.types'

const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const INITIAL_VP: ViewportSnapshot = { scrollX: 0, scrollY: 0, pixelsPerMinute: 1.2, width: 0, dayStartMinute: 0 }

// ── page ──────────────────────────────────────────────────────────────────────

export default function VehiclePlanPage() {
  const { id }      = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { toast }   = useToast()
  const router      = useRouter()
  const confirm     = useConfirm()
  // ?optimize=1 (from the topbar's background generations) opens the optimize modal on Cenários
  const optimizeFromUrl = useSearchParams().get('optimize') === '1'

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
  // canEdit gates structural/bulk flows (Otimizar, Ativar, Excluir, Gerar menu,
  // Limpar linha, versionamento de OSO) — DRAFT-only, since they touch far more than
  // one trip at a time or affect operação corrente in a way that needs the DRAFT
  // review step. canEditGantt gates punctual Gantt edits (mover/adicionar/remover
  // viagem, marcações, intervalos, acesso/recolhida) — allowed on ACTIVE too, so a
  // plan already in operação can still receive pontual corrections; only the
  // solver stays blocked there (enforced independently server-side).
  const canEdit      = canUpdate && status === 'DRAFT'
  const canEditGantt = canUpdate && (status === 'DRAFT' || status === 'ACTIVE')

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
  const editor = useGanttEditor({ id, canEditGantt, canEditStructural: canEdit, isActivePlan: status === 'ACTIVE', ganttData, refetchGantt, setIsPending })
  const {
    selection, setSelection,
    depotModal, setDepotModal,
    addIntervalModal, setAddIntervalModal,
    tripDetailsModalTripIds, setTripDetailsModalTripIds, handleUpdateMarkings, handleUpdateNotes, handleUpdateStopPattern,
    handleConvertToDeadrun, convertToTripSeed, setConvertToTripSeed, handleConvertToTripPendingAdd,
    moveTargetBlockId, setMoveTargetBlockId,
    pendingAdds, pendingDeletes, pendingDeadrunDeletes, pendingIntervalDeletes,
    setPendingAdds, setPendingDeletes, setPendingDeadrunDeletes, setPendingChanges, setPendingDeadrunChanges,
    handleCreateEmptyBlock, handleChangeDepot,
    setPendingLineSchedulePin,
    editBarOpen, setEditBarOpen,
    focusedSegId, setFocusedSegId,
    tripSeqAnchor, setTripSeqAnchor,
    selectedLineIds, setSelectedLineIds,
    mergedPlottedData,
    navBlocks, tripSeqRangeIds, headwayRangeInfo, freqData, freqIndex, deltaGroups,
    addTripReference, moveTargetBlocks, moveTargetHints,
    blockFilter, setBlockFilter, pinnedBlockIds, togglePinnedBlock, clearPinnedBlocks, visibleBlockIds, visibleNavBlocks, visibleAllTrips, filterMatchCount,
    pendingCount, isSaving,
    stepMoveTarget,
    handleSelectionChange, handlePendingAdd, queueTripDeletes, clearAllPending, handleToggleEditBar,
    handleSavePendingWithConfirm, handleDiscardPendingWithConfirm,
    osoSavePrompt, handleResolveOsoSavePrompt, handleApplyOsoAttributes,
    handleConfirmAddInterval, discardBreaks,
    handleConfirmMove, handleConfirmDepotModal,
    vehiclesActionSpec,
    handleAdjustCycle, handleFinalizePlan, handleDistributeHeadway, handleTripTimingOp,
  } = editor

  const [linesPanelOpen,    setLinesPanelOpen]    = useState(false)
  const [blockFilterOpen,   setBlockFilterOpen]   = useState(false)
  const [summaryLineIds,   setSummaryLineIds]     = useState<string[] | null>(null)
  const [freqPanelOpen,     setFreqPanelOpen]     = useState(false)
  // Fase 4 — FrequencyPanel can plot the delta-crossing instant instead of the
  // raw departure for rows whose direction has a resolved delta group; off by
  // default (see FrequencyPanel.tsx for why raw departure stays the default).
  const [freqDeltaView,     setFreqDeltaView]     = useState(false)
  const [ganttVp,           setGanttVp]           = useState<ViewportSnapshot>(INITIAL_VP)
  const [versionsModalOpen, setVersionsModalOpen] = useState(false)
  const [exportOsoModalOpen, setExportOsoModalOpen] = useState(false)
  const [planExportOpen, setPlanExportOpen] = useState(false)
  const [syncFromOsoOpen,    setSyncFromOsoOpen]    = useState(false)
  const [generateLineModal, setGenerateLineModal] = useState<{ lineIds: string[] } | null>(null)
  const [redistributeModal, setRedistributeModal] = useState<{ lineId: string } | null>(null)
  const [addTripOpen,       setAddTripOpen]       = useState(false)
  const [changeDepotOpen,   setChangeDepotOpen]   = useState(false)
  const [osoCoverageModal,  setOsoCoverageModal]   = useState<{ lineId: string } | null>(null)

  // ── side frequency panel — read-only mirror of the focused trip in the
  // Gantt (see LineFreqPanel.tsx), no focus/selection of its own
  const [lineFreqOpen,  setLineFreqOpen]  = useState(false)

  const ganttBoardRef  = useRef<GanttBoardHandle>(null)
  const shiftAnchorRef = useRef<string | null>(null)
  const [groupAnchorSegId, setGroupAnchorSegId] = useState<string | null>(null)

  useVehiclePlanShortcuts({
    canEdit, canEditGantt, isNew, ganttBoardRef, shiftAnchorRef,
    selection, setSelection, focusedSegId, setFocusedSegId, tripSeqAnchor, setTripSeqAnchor,
    moveTargetBlockId, setMoveTargetBlockId, editBarOpen, selectedLineIds, setSelectedLineIds, linesPanelOpen, navBlocks, visibleNavBlocks, visibleAllTrips,
    mergedPlottedData, moveTargetBlocks, pendingAdds, pendingDeletes, pendingDeadrunDeletes, pendingIntervalDeletes,
    setPendingAdds, setPendingDeletes, setPendingChanges, setPendingDeadrunDeletes, setPendingDeadrunChanges,
    pendingCount, freqPanelOpen, setFreqPanelOpen, setFreqDeltaView, deltaGroups,
    setAddTripOpen, setLineFreqOpen, setLinesPanelOpen,
    summaryLineIds, setSummaryLineIds, setRedistributeModal,
    blockFilterOpen, setBlockFilterOpen, setBlockFilter, clearPinnedBlocks,
    clearAllPending, handleSavePendingWithConfirm, handleDiscardPendingWithConfirm, handleToggleEditBar,
    handleSelectionChange, vehiclesActionSpec, stepMoveTarget, handleConfirmMove, handleDistributeHeadway,
    handleFinalizePlan, handleTripTimingOp, discardBreaks, handleCreateEmptyBlock,
  })

  // ── OSO drift — per-trip/per-line comparison, gated to isDrifted lines only
  // (see useOsoCoverage) ─────────────────────────────────────────────────────────

  const { offScheduleTripIds, coverageByLine, isLoading: osoCoverageLoading } = useOsoCoverage(mergedPlottedData)
  // mergedPlottedData only holds the lines selected in "Linhas" — inspecting the drift of
  // any other line compares against the persisted data instead (it can't have pending
  // edits: those only exist for plotted lines). Same departure queries, deduped.
  const persistedCoverage = useOsoCoverage(ganttData ?? null)
  // Memoized so panning/zooming the Gantt (onViewportChange fires on every
  // scroll tick) doesn't hand GanttBoard a new `data` reference every render —
  // that would defeat its memo() and retrigger a full engine.setView layout
  // pass on every frame. offScheduleTripIds is itself stable across unrelated
  // renders (see useOsoCoverage), so this only changes when something real does.
  const boardData = useMemo(() => {
    if (!mergedPlottedData) return null
    const blocks = visibleBlockIds
      ? mergedPlottedData.blocks.filter(b => visibleBlockIds.has(b.id))
      : mergedPlottedData.blocks
    return { ...mergedPlottedData, blocks, offScheduleTripIds }
  }, [mergedPlottedData, offScheduleTripIds, visibleBlockIds])

  // ── solver ──────────────────────────────────────────────────────────────────

  // the plan's vehicle solver generation — it runs on the server whether or not the modal is
  // open; polled while running so the Otimizar button shows it
  const { data: solverJob = null, refetch: refetchSolverJobQuery, isFetched: solverJobFetched } = useQuery<SolverJob | null>({
    queryKey: ['transit', 'vehicle-plan', id, 'solver-current'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/solver/current`)
      if (!res.ok) return null
      return ((await res.json()) as { job: SolverJob | null }).job
    },
    enabled:         canEdit,
    refetchInterval: q => (q.state.data?.running ? 3000 : false),
  })
  // the plan's generation changed — the topbar's list follows
  const refetchSolverJob = () => {
    void queryClient.invalidateQueries({ queryKey: BACKGROUND_JOBS_KEY })
    return refetchSolverJobQuery()
  }
  const [optimizeTabState, setOptimizeTab] = useState<OptimizeTab | null>(null)
  const optimizeTab: OptimizeTab | null = optimizeTabState ?? (optimizeFromUrl && canEdit ? 'scenarios' : null)
  const closeOptimize = () => {
    setOptimizeTab(null)
    if (optimizeFromUrl) router.replace('?', { scroll: false })
  }
  const lockedCount = ganttData?.blocks.filter(b => b.constraints?.locked).length ?? 0

  async function handleDelete() {
    if (!canUpdate) return
    const ok = await confirm({
      title:       'Excluir planejamento',
      description: 'Esta ação não pode ser desfeita. Todos os blocos gerados serão removidos.',
      confirmLabel: 'Excluir',
      variant:     'destructive',
    })
    if (!ok) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      router.push('/transit/vehicle-plan')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
      setIsPending(false)
    }
  }
  const [activationOpen, setActivationOpen] = useState(false)

  // ── Vehicles ⇄ Crew switch ──────────────────────────────────────────────────
  // Opens the plan's ACTIVE crew plan (else the latest); with none yet, offers to create
  // one. Blocked while there are pending Gantt edits (the crew plan is built on the
  // saved blocks).

  async function handleOpenCrewPlan() {
    try {
      const res = await apiFetch(`/transit/crew-plan/for-vehicle-plan/${id}`)
      if (!res.ok) throw new Error(extractError(await res.json().catch(() => ({}))))
      const found = await res.json().catch(() => null) as { id: string } | null
      if (found) { router.push(`/transit/crew-plan/${found.id}`); return }

      const ok = await confirm({
        title:        'Criar escala',
        description:  'Este planejamento ainda não tem escala de tripulação. Criar uma agora?',
        confirmLabel: 'Criar',
      })
      if (!ok) return
      const created = await apiFetch('/transit/crew-plan', {
        method: 'POST',
        body:   JSON.stringify({ vehiclePlanId: id, description: 'Escala' }),
      })
      const json = await created.json().catch(() => ({}))
      if (!created.ok) throw new Error(extractError(json))
      router.push(`/transit/crew-plan/${(json as { id: string }).id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao abrir a escala')
    }
  }

  // ── topbar ───────────────────────────────────────────────────────────────────

  const planLines        = ganttData?.plan?.lines ?? []

  useTopbarActions([
    ...(!isNew ? [{
      label:    'Escala',
      icon:     Icons.Users,
      size:     'sm' as const,
      variant:  'ghost' as const,
      onClick:  () => void handleOpenCrewPlan(),
      disabled: pendingCount > 0,
      position: 'start' as const,
    }] : []),

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

    // block filter toggle — always visible, not gated to edit mode (browsing
    // the Gantt happens in normal mode too). See BlockFilterBar.tsx.
    ...(!isNew ? [{
      label:    'Filtro de blocos',
      icon:     Icons.Filter,
      size:     'icon' as const,
      onClick:  () => setBlockFilterOpen(v => {
        if (v) { setBlockFilter(null); clearPinnedBlocks() }
        return !v
      }),
      variant:  (blockFilterOpen ? 'default' : 'ghost') as 'default' | 'ghost',
      keybind:  'F7',
      position: 'start' as const,
    }] : []),

    // ── edit mode ──────────────────────────────────────────────────────────────
    // Navigation/inspection stays available even on active plans. Punctual edits
    // (trip, save, clear) require canEditGantt (DRAFT or ACTIVE); bulk/structural
    // flows (Gerar and its submenu) require canEdit (DRAFT only).
    ...(editBarOpen ? [
      {
        label:    'Resumo',
        icon:     Icons.BarChart2,
        size:     'sm' as const,
        variant:  (summaryLineIds ? 'default' : 'ghost') as 'default' | 'ghost',
        onClick:  () => setSummaryLineIds(v => v ? null : [...selectedLineIds]),
        disabled: !summaryLineIds && selectedLineIds.size === 0,
      },
      { label: '', separator: true },
      ...(canEditGantt ? [
        {
          label:    'Viagem',
          icon:     Icons.Plus,
          size:     'sm' as const,
          variant:  'ghost' as const,
          onClick:  () => setAddTripOpen(true),
          keybind:  'q+n',
        },
        { label: '', separator: true },
      ] : []),
      ...(canEdit ? [
        {
          // Generates a service proposal (windows/fleet/supply×demand) for the
          // line selected in "Linhas" — the solver's optimization flow is a
          // separate action, labeled "Otimizar" (see "normal mode" block below).
          label:    'Gerar',
          icon:     Icons.Play,
          size:     'sm' as const,
          variant:  'ghost' as const,
          onClick:  () => setGenerateLineModal({ lineIds: [...selectedLineIds] }),
          disabled: selectedLineIds.size === 0,
          menu: [
            {
              label:    'Validar e consolidar plano',
              icon:     Icons.CheckCircle,
              onClick:  handleFinalizePlan,
              disabled: isPending,
            },
            {
              label:    'Modificar depósito',
              icon:     Icons.Warehouse,
              onClick:  () => setChangeDepotOpen(true),
              disabled: isPending || selectedLineIds.size === 0,
            },
            { separator: true as const },
            {
              label:    'Ajustar Ciclo',
              icon:     Icons.Timer,
              onClick:  handleAdjustCycle,
              disabled: isPending,
            },
            {
              label:    'Redistribuir',
              icon:     Icons.Shuffle,
              onClick:  () => setRedistributeModal({ lineId: [...selectedLineIds][0] }),
              disabled: isPending || selectedLineIds.size !== 1,
            },
          ],
        },
        { label: '', separator: true },
      ] : []),
      ...(canEditGantt ? [
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
        variant: (linesPanelOpen ? 'default' : 'ghost') as 'default' | 'ghost',
        menu: [
          { label: 'Versões', icon: Icons.GitBranch, onClick: () => {
            if (selectedLineIds.size === 0) { toast.error('Selecione ao menos uma linha em "Linhas" primeiro'); return }
            setVersionsModalOpen(true)
          } },
          { label: 'OSO', icon: Icons.FileSpreadsheet, onClick: () => setExportOsoModalOpen(true) },
          // reads the saved plan — pending Gantt edits wouldn't be in the file
          { label: 'Exportar Planejamento', icon: Icons.Upload, onClick: () => {
            if (selectedLineIds.size === 0) { toast.error('Selecione ao menos uma linha em "Linhas" primeiro'); return }
            if (pendingCount > 0) { toast.error('Salve ou descarte as alterações pendentes antes de exportar'); return }
            setPlanExportOpen(true)
          } },
          ...(canEditGantt ? [{ label: 'Atualizar da OSO', icon: Icons.RefreshCw, onClick: () => {
            if (selectedLineIds.size === 0) { toast.error('Selecione ao menos uma linha em "Linhas" primeiro'); return }
            setSyncFromOsoOpen(true)
          } }] : []),
        ],
      }] : []),
      // optimize — the solver reads the saved blocks, so not with pending Gantt edits
      ...(canEdit ? [{
        label:    solverJob?.running
          ? `Gerando… ${fmtClock(solverJob.progress?.elapsed ?? 0)}`
          : solverJob?.hasProposal ? 'Otimizar • proposta pronta' : 'Otimizar',
        icon:     solverJob?.running ? Icons.Loader2 : Icons.Sparkles,
        onClick:  () => setOptimizeTab(solverJob ? 'scenarios' : 'panel'),
        disabled: isPending || pendingCount > 0,
      }] : []),
      // activate
      ...(!solverJob?.running && canEdit ? [{
        label:    isPending ? 'Ativando…' : 'Ativar',
        icon:     Icons.CheckCircle,
        onClick:  () => setActivationOpen(true),
        disabled: isPending,
        overflow: true,
      }] : []),
      // delete
      ...(!solverJob?.running && canEdit ? [{
        label:    'Excluir',
        icon:     Icons.Trash2,
        onClick:  handleDelete,
        disabled: isPending,
        variant:  'destructive' as const,
        overflow: true,
      }] : []),
    ]),
  ], [isPending, isSaving, solverJob, canUpdate, canEdit, canEditGantt, status, isNew, selectedLineIds, editBarOpen, pendingCount, linesPanelOpen, summaryLineIds, blockFilterOpen])

  // ── trip summary panel ────────────────────────────────────────────────────
  // Tracks the segment whose data the panel shows: the single selected/focused
  // segment, or — once a group (interval) selection starts — the segment that
  // was selected right before it grew into a group, kept fixed while it grows.
  // Adjusting state during render (react.dev/learn/you-might-not-need-an-effect)
  // instead of mutating a ref, so `summarySegId` below is consistent with it on
  // this same render rather than lagging a render behind via an effect.
  if (!selection) {
    if (groupAnchorSegId !== null) setGroupAnchorSegId(null)
  } else if (selection.type === 'trip') {
    if (groupAnchorSegId !== selection.segment.id) setGroupAnchorSegId(selection.segment.id)
  } else if (!groupAnchorSegId) {
    setGroupAnchorSegId(selection.from.id)
  }

  const summarySegId = selection ? groupAnchorSegId : focusedSegId

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
      {isSaving && <BusyOverlay message="Salvando alterações…" />}

      {activationOpen && (
        <ActivationModal
          title="Ativar planejamento"
          endpoint={`/transit/vehicle-plan/${id}/activate`}
          confirmLabel="Ativar"
          onClose={() => setActivationOpen(false)}
          onDone={() => {
            setActivationOpen(false)
            toast.success('Planejamento ativado')
            void queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
          }}
        />
      )}

      {optimizeTab && solverJobFetched && (
        <OptimizeModal
          planId={id}
          initialTab={optimizeTab}
          job={solverJob}
          lockedCount={lockedCount}
          onJobChanged={() => void refetchSolverJob()}
          onApplied={() => {
            closeOptimize()
            void refetchSolverJob()
            void queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
            void refetchGantt()
            toast.success('Proposta aplicada no planejamento')
          }}
          onSettingsSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
            void refetchGantt()
          }}
          onClose={() => { closeOptimize(); void refetchSolverJob() }}
        />
      )}

      {versionsModalOpen && ganttData?.plan?.dayType && (
        <SwitchLineScheduleModal
          planId={id}
          dayTypeId={ganttData.plan.dayType.id}
          dayTypeCode={ganttData.plan.dayType.code}
          dayTypeName={ganttData.plan.dayType.name}
          lines={planLines.filter(l => selectedLineIds.has(l.lineId))}
          blocks={ganttData.blocks}
          hasPendingChanges={pendingCount > 0}
          onApplied={async () => { await refetchGantt(); setEditBarOpen(true) }}
          onPendingAdd={handlePendingAdd}
          onQueueTripDeletes={queueTripDeletes}
          onScheduleSwitchStaged={(lineId, lineScheduleId) => {
            setPendingLineSchedulePin({ lineId, lineScheduleId })
            setSelectedLineIds(new Set([lineId]))
            setEditBarOpen(true)
          }}
          onClose={() => setVersionsModalOpen(false)}
        />
      )}

      {exportOsoModalOpen && (
        <ExportOsoModal
          planId={id}
          onClose={() => setExportOsoModalOpen(false)}
        />
      )}

      {planExportOpen && (
        <PlanExportModal
          planId={id}
          planName={String(record?.description ?? '')}
          lineIds={[...selectedLineIds]}
          onClose={() => setPlanExportOpen(false)}
        />
      )}

      {syncFromOsoOpen && mergedPlottedData && (
        <SyncFromOsoModal
          planId={id}
          lineIds={[...selectedLineIds]}
          lineCodeById={new Map(mergedPlottedData.plan.lines.map(l => [l.lineId, l.line.code]))}
          blocks={mergedPlottedData.blocks}
          skipTripIds={new Set(pendingAdds.flatMap(a => a._kind === 'trip' ? [a._tempId] : []))}
          onApply={handleApplyOsoAttributes}
          onClose={() => setSyncFromOsoOpen(false)}
        />
      )}

      {osoSavePrompt && (
        <OsoSavePromptModal
          lines={osoSavePrompt.lines}
          badge={status === 'ACTIVE' ? 'Plano Ativo' : undefined}
          onResolve={handleResolveOsoSavePrompt}
        />
      )}

      {depotModal && (
        <AccessModal
          title={depotModal.kind === 'access' ? 'Adicionar Acesso' : 'Adicionar Recolhida'}
          onConfirm={handleConfirmDepotModal}
          onClose={() => setDepotModal(null)}
        />
      )}

      {changeDepotOpen && (
        <AccessModal
          title="Modificar depósito"
          confirmLabel="Aplicar"
          onConfirm={depot => { setChangeDepotOpen(false); handleChangeDepot(depot) }}
          onClose={() => setChangeDepotOpen(false)}
        />
      )}

      {addIntervalModal && (
        <AddIntervalModal
          onConfirm={handleConfirmAddInterval}
          onClose={() => setAddIntervalModal(null)}
        />
      )}

      {tripDetailsModalTripIds && mergedPlottedData && (
        <TripDetailsModal
          tripIds={tripDetailsModalTripIds}
          mergedPlottedData={mergedPlottedData}
          onUpdateMarkings={handleUpdateMarkings}
          onUpdateStopPattern={handleUpdateStopPattern}
          onUpdateNotes={handleUpdateNotes}
          onConvertToDeadrun={handleConvertToDeadrun}
          onClose={() => setTripDetailsModalTripIds(null)}
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

      {/* "Produtiva" — Direção 2 de docs/proposal/plan_trip_deadrun_conversion_v1.md.
          Same modal as above, seeded from the deadrun being converted; the deadrun is
          only queued for deletion once the user actually confirms a trip (see
          handleConvertToTripPendingAdd), never just from opening this. */}
      {convertToTripSeed && mergedPlottedData && (
        <AddTripModal
          planId={id}
          dayTypeCode={ganttData?.plan?.dayType?.code ?? 'U'}
          plottedLines={mergedPlottedData.plan.lines.filter(l => selectedLineIds.has(l.lineId))}
          plottedBlocks={mergedPlottedData.blocks}
          reference={null}
          seed={convertToTripSeed}
          onClose={() => setConvertToTripSeed(null)}
          onPendingAdd={handleConvertToTripPendingAdd}
        />
      )}

      <div className="px-6 pt-4 pb-2 shrink-0 flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <AutoBreadcrumb domain="transit" resource="vehicle-plan" id={id} recordName={recordName} />

          {/* plan name — the rest of the old summary bar (status/type/counts,
              solver progress) was removed; the block filter now lives at this
              same height, over the Gantt (see BlockFilterBar below). */}
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
              <Badge {...vigenceBadge(status, record.validFrom as string | null, record.validTo as string | null)} />
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
            {summaryLineIds ? (
              <LineSummaryView
                planId={id}
                lineIds={summaryLineIds}
                lines={planLines
                  .filter(l => summaryLineIds.includes(l.lineId))
                  .map(l => ({ lineId: l.lineId, code: l.line.code, name: l.line.name }))}
                onClose={() => setSummaryLineIds(null)}
                mergedPlottedData={mergedPlottedData}
                hasPendingChanges={pendingCount > 0}
              />
            ) : (
              <>
                {mergedPlottedData ? (
                  mergedPlottedData.blocks.length > 0 ? (
                    <GanttBoard
                      ref={ganttBoardRef}
                      data={boardData!}
                      onViewportChange={setGanttVp}
                      selection={editBarOpen ? selection : null}
                      onSelectionChange={handleSelectionChange}
                      actionSpec={editBarOpen ? vehiclesActionSpec : undefined}
                      onBlockUpdate={refetchGantt}
                      focusedSegId={editBarOpen ? focusedSegId : null}
                      moveTargetBlockId={editBarOpen ? moveTargetBlockId : null}
                      moveTargetHints={moveTargetHints}
                      highlightedSegIds={editBarOpen ? tripSeqRangeIds : null}
                      // +8 for LineFreqPanel's `right-2` offset from the container edge
                      rightInset={lineFreqOpen ? LINE_FREQ_PANEL_WIDTH + 8 : 0}
                      filterBarOpen={blockFilterOpen}
                      pinnedBlockIds={pinnedBlockIds}
                      onTogglePin={togglePinnedBlock}
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

                {blockFilterOpen && (
                  <BlockFilterBar
                    filter={blockFilter}
                    onChange={setBlockFilter}
                    matchCount={filterMatchCount}
                    onClose={() => { setBlockFilterOpen(false); setBlockFilter(null); clearPinnedBlocks() }}
                  />
                )}

                {editBarOpen && selection && mergedPlottedData && (
                  <GanttActionBar
                    selection={selection}
                    actions={vehiclesActionSpec.getActions(selection, mergedPlottedData, () => setSelection(null))}
                    onDismiss={() => setSelection(null)}
                  />
                )}

                {editBarOpen && canEditGantt && !selection && headwayRangeInfo && (
                  <HeadwayRangeBar
                    count={headwayRangeInfo.trips.length}
                    singleLine={headwayRangeInfo.singleLine}
                    onDistribute={handleDistributeHeadway}
                  />
                )}

                {lineFreqOpen && freqIndex && (
                  <LineFreqPanel
                    index={freqIndex}
                    focusedSegId={focusedSegId}
                    onFocusChange={(segId) => { setTripSeqAnchor(null); setFocusedSegId(segId) }}
                    rangeSegIds={tripSeqRangeIds}
                  />
                )}
              </>
            )}
          </div>

          {freqPanelOpen && freqData && (
            <FrequencyPanel
              data={freqData} vp={ganttVp} focusedTripId={focusedSegId}
              deltaGroups={deltaGroups} deltaView={freqDeltaView}
            />
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
            onOpenComparison={(lineId) => {
              setLinesPanelOpen(false)
              setSelectedLineIds(new Set([lineId]))
              setEditBarOpen(true)
              setSummaryLineIds([lineId])
            }}
            onInspectDrift={(lineId) => setOsoCoverageModal({ lineId })}
          />
        )}

        {osoCoverageModal && (() => {
          const line    = ganttData?.plan?.lines?.find(l => l.lineId === osoCoverageModal.lineId)
          const plotted = selectedLineIds.has(osoCoverageModal.lineId)
          return (
            <OsoCoverageModal
              lineId={osoCoverageModal.lineId}
              lineCode={line?.line.code ?? ''}
              lineName={line?.line.name ?? ''}
              coverage={(plotted ? coverageByLine : persistedCoverage.coverageByLine).get(osoCoverageModal.lineId)}
              isLoading={plotted ? osoCoverageLoading : persistedCoverage.isLoading}
              blocks={(plotted ? mergedPlottedData?.blocks : ganttData?.blocks) ?? []}
              onClose={() => setOsoCoverageModal(null)}
            />
          )
        })()}

        {generateLineModal && (
          <LineScheduleGeneratorModal
            planId={id}
            lineIds={generateLineModal.lineIds}
            dayTypeCode={ganttData?.plan?.dayType?.code ?? ''}
            existingTripIds={
              (ganttData?.blocks ?? [])
                .flatMap(b => b.blockTrips)
                .filter(bt => generateLineModal.lineIds.includes(bt.trip.route.line.id))
                .map(bt => bt.trip.id)
            }
            hasPendingChanges={pendingCount > 0}
            onClose={() => setGenerateLineModal(null)}
            onPendingAdd={handlePendingAdd}
            onPendingDeleteTrips={(tripIds) => setPendingDeletes(prev => new Set([...prev, ...tripIds]))}
          />
        )}

        {redistributeModal && (() => {
          const line = ganttData?.plan?.lines?.find(l => l.lineId === redistributeModal.lineId)
          if (!line) return null
          return (
            <RedistributeModal
              lineId={redistributeModal.lineId}
              lineCode={line.line.code}
              lineName={line.line.name}
              lineMetrics={line.line.metrics}
              dayTypeCode={ganttData?.plan?.dayType?.code ?? ''}
              blocks={ganttData?.blocks ?? []}
              hasPendingChanges={pendingCount > 0}
              onClose={() => setRedistributeModal(null)}
              onPendingAdd={handlePendingAdd}
              onQueueTripDeletes={queueTripDeletes}
            />
          )
        })()}
      </div>
    </div>
  )
}