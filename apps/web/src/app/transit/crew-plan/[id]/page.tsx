'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CrewRole, ReliefPoint } from '@nyx/schemas'
import { Icons }            from '@/lib/icons'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { usePageGuard }     from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { useConfirm }       from '@/lib/confirm-context'
import { extractError }     from '@/lib/utils'
import type { CrewBoardData, BoardBlock, BoardDuty } from './board.types'
import { CrewBoard, type PieceDraftStart } from './components/CrewBoard'
import { AssignPieceModal, type AssignTarget } from './components/AssignPieceModal'
import { BreakModal, type BreakDraft } from './components/BreakModal'
import { VehicleSwapModal } from './components/VehicleSwapModal'
import { OptimizeCrewModal, type OptimizeTab, type SolverJob } from './components/OptimizeCrewModal'
import { BACKGROUND_JOBS_KEY } from '@/components/layout/background-jobs'
import { DutyPanel, DUTY_FORM_ID, type DutyPatch, type ActivityInput } from './components/DutyPanel'
import { PlanPanel } from './components/PlanPanel'
import { DutyBoard } from './components/DutyBoard'
import { useTimeRange, LABEL_W } from './components/Timeline'
import { CrewFilterBar } from './components/CrewFilterBar'
import { EMPTY_FILTER, isFilterActive, blockMatches, dutyMatches, type CrewFilter } from './filters'
import { lineColorMap, dutyLineCodes } from './board.types'
import { InlineDescription } from '../../vehicle-plan/[id]/components/InlineDescription'
import { Badge } from '@/components/ui/badge'
import { BusyOverlay } from '@/components/ui/busy-overlay'
import { vigenceBadge } from '@/lib/plan-vigence'
import { ActivationModal } from '../../activation-modal'
import { PlanCsvModal } from '../../plan-csv-modal'

// Logical crew schedule of a VehiclePlan. Every edit
// is written immediately (no pending queue) — the server recalculates staleness, issues
// and coverage on each write, and the board is refetched from it.

const ORIGIN = 'apps/web/src/app/transit/crew-plan/[id]/page'
// per-viewer display preferences (Exibir menu) — browser only, never required
const LINE_COLORS_KEY = 'crew-plan:line-colors'
// px per minute; ZOOM_100 (1.2) is the 100% reference, ZOOM_DEFAULT (75%) the initial level
const ZOOMS        = [0.6, 0.9, 1.2, 1.8, 2.4]
const ZOOM_100     = 2
const ZOOM_DEFAULT = 1

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(extractError(json))
  }
  return res.status === 204 ? null : res.json().catch(() => null)
}

// elapsed ms → mm:ss
const fmtClock = (ms: number) => {
  const sec = Math.floor(ms / 1000)
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

export default function CrewPlanPage() {
  const { id }    = useParams<{ id: string }>()
  const router    = useRouter()
  // vehicle view (one row per block, default) or duty view (one row per duty) — kept in the
  // URL so a reload or a shared link opens the same view
  const searchParams = useSearchParams()
  const view      = searchParams.get('view') === 'duties' ? 'duties' : 'vehicles'
  // ?optimize=1 (from the topbar's background generations) opens the optimize modal on Cenários
  const optimizeFromUrl = searchParams.get('optimize') === '1'
  const setView   = (v: 'vehicles' | 'duties') => {
    setDraftStart(null) // a piece being picked belongs to the vehicle view
    router.replace(v === 'duties' ? '?view=duties' : '?', { scroll: false })
  }
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const confirm   = useConfirm()

  // the first load of each crew plan asks the server to recalculate (picks up upstream
  // changes); later refetches follow our own writes, which already recalculated
  const recalculated = useRef(new Set<string>())
  const boardScroll  = useRef<HTMLDivElement>(null)
  const { data, error, refetch } = useQuery<CrewBoardData>({
    queryKey: ['transit', 'crew-plan', id, 'board'],
    queryFn:  async () => {
      const first = !recalculated.current.has(id)
      const res   = await apiFetch(`/transit/crew-plan/${id}/board${first ? '?recalculate=1' : ''}`)
      if (res.ok) recalculated.current.add(id)
      if (!res.ok) throw Object.assign(new Error('Falha ao carregar a escala'), { status: res.status })
      return res.json() as Promise<CrewBoardData>
    },
  })

  const { guardNode, canUpdate, canDelete } = usePageGuard('transit', 'crew-plan', false, error ?? undefined)
  // a substituted crew plan is history — read only (the API refuses writes too)
  const canEdit = canUpdate && data?.plan.status !== 'SUPERSEDED'

  // the plan's crew solver generation — it runs on the server whether or not the modal is
  // open; polled while running so the Otimizar button shows it
  const { data: solverJob = null, refetch: refetchSolverJobQuery, isFetched: solverJobFetched } = useQuery<SolverJob | null>({
    queryKey: ['transit', 'crew-plan', id, 'solver-current'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/crew-plan/${id}/solver/current`)
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

  const [selectedDutyId, setSelectedDutyId] = useState<string | null>(null)
  const [draftStart, setDraftStart]         = useState<PieceDraftStart | null>(null)
  const [assignDraft, setAssignDraft]       = useState<{ block: BoardBlock; start: ReliefPoint; end: ReliefPoint } | null>(null)
  const [breakDraft, setBreakDraft]         = useState<BreakDraft | null>(null)
  const [saving, setSaving]                 = useState(false)
  const [busyMessage, setBusyMessage]       = useState<string | null>(null)
  const [zoomIdx, setZoomIdx]               = useState(ZOOM_DEFAULT)
  const [resetSignal, setResetSignal]       = useState(0)
  const [activationOpen, setActivationOpen] = useState(false)
  const [csvExportOpen, setCsvExportOpen]   = useState(false)
  const [swapOpen, setSwapOpen]             = useState(false)
  const [optimizeTabState, setOptimizeTab]  = useState<OptimizeTab | null>(null)
  const optimizeTab: OptimizeTab | null = optimizeTabState ?? (optimizeFromUrl && canEdit ? 'scenarios' : null)
  const closeOptimize = () => {
    setOptimizeTab(null)
    if (optimizeFromUrl) router.replace(view === 'duties' ? '?view=duties' : '?', { scroll: false })
  }
  const [filterOpen, setFilterOpen]         = useState(false)
  const [filter, setFilter]                 = useState<CrewFilter>(EMPTY_FILTER)
  const [pinnedBlockIds, setPinnedBlockIds] = useState<Set<string>>(new Set())
  const [pinnedDutyIds, setPinnedDutyIds]   = useState<Set<string>>(new Set())
  const [showLineColors, setShowLineColors] = useState(false)

  // restored after mount — localStorage isn't available during the server render
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(LINE_COLORS_KEY) === '1') setShowLineColors(true)
    } catch { /* storage blocked — keep the default */ }
  }, [])

  function toggleLineColors() {
    setShowLineColors(v => {
      try { localStorage.setItem(LINE_COLORS_KEY, v ? '0' : '1') } catch { /* storage blocked */ }
      return !v
    })
  }

  // "X"/F7-close: full reset (criteria + pins), same as the vehicle plan's filter bar
  function toggleFilter() {
    if (filterOpen) { setFilter(EMPTY_FILTER); setPinnedBlockIds(new Set()); setPinnedDutyIds(new Set()) }
    setFilterOpen(v => !v)
  }

  function togglePin(set: React.Dispatch<React.SetStateAction<Set<string>>>, rowId: string) {
    set(prev => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId)
      return next
    })
  }

  const selectedDuty = data?.duties.find(d => d.id === selectedDutyId) ?? null

  // one time range for both views, so switching keeps the same scale and position
  const timeSpans = useMemo(() => [
    ...(data?.blocks ?? []).map(b => b.window).filter((w): w is NonNullable<typeof w> => !!w),
    ...(data?.duties ?? []).flatMap(d => [...d.pieces, ...d.activities]),
  ], [data])
  const range = useTimeRange(timeSpans)

  // selecting from the duty list: bring the duty into view, roughly centered — its own row on
  // the duty view, its first vehicle's row on the vehicle view (rows hidden by the filter:
  // horizontal only); a duty wider than the screen is aligned by its start instead
  function focusDuty(duty: BoardDuty) {
    setSelectedDutyId(duty.id)
    const el = boardScroll.current
    const spans = [...duty.pieces.filter(p => !p.isStale), ...duty.activities]
    if (!el || spans.length === 0) return
    const start = Math.min(...spans.map(s => s.startMinutes)), end = Math.max(...spans.map(s => s.endMinutes))
    const px    = ZOOMS[zoomIdx]
    const viewW = el.clientWidth - LABEL_W
    const left  = (end - start) * px > viewW - 48
      ? (start - range.start) * px - 24
      : ((start + end) / 2 - range.start) * px - viewW / 2
    const rowId = view === 'duties' ? duty.id : duty.pieces.find(p => !p.isStale && p.vehicleBlockId)?.vehicleBlockId
    const row   = rowId ? el.querySelector<HTMLElement>(`[data-row="${rowId}"]`) : null
    const top   = row ? row.offsetTop - (el.clientHeight - row.offsetHeight) / 2 : el.scrollTop
    el.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' })
  }

  const blockById = useMemo(() => new Map((data?.blocks ?? []).map(b => [b.id, b])), [data?.blocks])

  // lines each duty operates (panel, filter) and the lines the plan runs (filter options)
  const dutyLines = useMemo(
    () => new Map((data?.duties ?? []).map(d => [d.id, dutyLineCodes(d, blockById, data?.lineCodes ?? [])])),
    [data, blockById],
  )
  const planLineCodes = useMemo(() => {
    const used = new Set((data?.blocks ?? []).flatMap(b => b.trips.map(t => t.lineCode)))
    // numeric-aware: 032 < 301 < A01
    return (data?.lineCodes ?? []).filter(c => used.has(c)).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  }, [data])

  // indexed over the lines the plan runs — same as the vehicle plan Gantt
  const lineColors = useMemo(
    () => showLineColors ? lineColorMap(planLineCodes) : null,
    [showLineColors, planLineCodes],
  )

  // rows left after the filter (pinned rows always stay); count excludes pins
  const { visibleBlocks, visibleDuties, matchCount } = useMemo(() => {
    const blocks = data?.blocks ?? [], duties = data?.duties ?? []
    if (!filterOpen || !isFilterActive(filter, view)) return { visibleBlocks: blocks, visibleDuties: duties, matchCount: 0 }
    if (view === 'vehicles') {
      const uncoveredIds = new Set((data?.plan.summary?.uncovered ?? []).map(u => u.vehicleBlockId))
      const matched = blocks.filter(b => blockMatches(filter, b, uncoveredIds.has(b.id)))
      const ids = new Set(matched.map(b => b.id))
      return { visibleBlocks: blocks.filter(b => ids.has(b.id) || pinnedBlockIds.has(b.id)), visibleDuties: duties, matchCount: matched.length }
    }
    const matched = duties.filter(d => dutyMatches(filter, d, dutyLines.get(d.id) ?? []))
    const ids = new Set(matched.map(d => d.id))
    return { visibleBlocks: blocks, visibleDuties: duties.filter(d => ids.has(d.id) || pinnedDutyIds.has(d.id)), matchCount: matched.length }
  }, [data, dutyLines, filter, filterOpen, view, pinnedBlockIds, pinnedDutyIds])

  // side panel list: duty criteria apply on either view
  const panelDuties = useMemo(() => {
    const duties = data?.duties ?? []
    if (!filterOpen || !isFilterActive(filter, 'duties')) return duties
    return duties.filter(d => dutyMatches(filter, d, dutyLines.get(d.id) ?? []) || pinnedDutyIds.has(d.id))
  }, [data, dutyLines, filter, filterOpen, pinnedDutyIds])

  function toggleDutyFlag(key: 'withIssues' | 'staleOnly') {
    setFilter(f => ({ ...f, [key]: !(filterOpen && f[key]) }))
    setFilterOpen(true)
  }

  const localityName = useMemo(() => {
    const map = new Map((data?.localities ?? []).map(l => [l.id, l.abbr || l.name]))
    return (localityId: string) => map.get(localityId) ?? '?'
  }, [data?.localities])

  // runs a mutation, surfaces its error as a toast and refreshes the board either way
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | null> => {
    setSaving(true)
    try {
      const result = await fn()
      if (success) toast.success(success)
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
      return null
    } finally {
      setSaving(false)
      await refetch()
    }
  }, [refetch, toast])

  // ── piece creation ─────────────────────────────────────────────────────────
  // One click = the piece's end; its start is inferred as the beginning of the uncovered
  // stretch before it — the end of the previous DRIVER piece on the block, or the start of
  // the vehicle's service span (after its own interval / depot time), whichever is later.
  // Shift+click picks the start explicitly instead (then a second click ends the piece).

  function inferStart(block: BoardBlock, end: ReliefPoint): ReliefPoint | null {
    const span = block.serviceSpans.find(s => end.minutes > s.startMinutes && end.minutes <= s.endMinutes)
    if (!span || !data) return null
    let from = span.startMinutes
    let fromLocalityId: string | null = null
    for (const duty of data.duties) {
      if (duty.role !== 'DRIVER') continue
      for (const p of duty.pieces) {
        if (p.vehicleBlockId !== block.id || p.isStale) continue
        if (p.startMinutes < end.minutes && p.endMinutes > end.minutes) return null // point already covered
        if (p.endMinutes <= end.minutes && p.endMinutes >= from) { from = p.endMinutes; fromLocalityId = p.endLocalityId }
      }
    }
    const candidates = block.points.filter(p => p.minutes >= from && p.minutes < end.minutes)
    if (candidates.length === 0) return null
    const first = candidates[0].minutes
    // relieving at the previous piece's end locality keeps the handover in one place
    return candidates.find(p => p.minutes === first && p.localityId === fromLocalityId)
      ?? candidates.find(p => p.minutes === first)!
  }

  function handlePointClick(block: BoardBlock, point: ReliefPoint, pickStart: boolean) {
    if (pickStart) { setDraftStart({ blockId: block.id, point }); return }

    if (draftStart && draftStart.blockId === block.id) {
      const a = draftStart.point
      if (a.minutes === point.minutes) { setDraftStart(null); return }
      const [start, end] = a.minutes < point.minutes ? [a, point] : [point, a]
      setAssignDraft({ block, start, end })
      return
    }

    const start = inferStart(block, point)
    if (start) { setDraftStart(null); setAssignDraft({ block, start, end: point }); return }
    toast.error('Sem trecho descoberto antes deste ponto — use Shift+clique para escolher o início')
  }

  async function handleAssign(target: AssignTarget) {
    if (!assignDraft) return
    const { block, start, end } = assignDraft
    const dutyId = await run(async () => {
      let targetId: string
      let created = false
      if (target.kind === 'new') {
        const duty = await api('/transit/duty', {
          method: 'POST',
          body:   JSON.stringify({ crewPlanId: id, role: target.role, kind: target.dutyKind }),
        }) as { id: string }
        targetId = duty.id
        created  = true
      } else {
        targetId = target.dutyId
      }
      try {
        await api('/transit/duty-piece', {
          method: 'POST',
          body:   JSON.stringify({
            dutyId: targetId, vehicleBlockId: block.id,
            startMinutes: start.minutes, endMinutes: end.minutes,
            startLocalityId: start.localityId, endLocalityId: end.localityId,
          }),
        })
      } catch (err) {
        // don't leave an empty duty behind when its first piece was rejected
        if (created) await api(`/transit/duty/${targetId}`, { method: 'DELETE' }).catch(() => null)
        throw err
      }
      return targetId
    })
    if (dutyId) {
      setSelectedDutyId(dutyId)
      setAssignDraft(null)
      setDraftStart(null)
    }
  }

  // ── duty / piece / activity ────────────────────────────────────────────────

  async function handleSaveDuty(patch: DutyPatch) {
    if (!selectedDuty) return
    await run(() => api(`/transit/duty/${selectedDuty.id}`, { method: 'PATCH', body: JSON.stringify(patch) }), 'Jornada salva')
  }

  async function handleDeleteDuty() {
    if (!selectedDuty) return
    const ok = await confirm({ title: 'Excluir jornada', description: 'A jornada, suas pegadas e atividades serão removidas.', confirmLabel: 'Excluir', variant: 'destructive' })
    if (!ok) return
    const done = await run(() => api(`/transit/duty/${selectedDuty.id}`, { method: 'DELETE' }).then(() => true))
    if (done) setSelectedDutyId(null)
  }

  async function handleCreateDuty(role: CrewRole) {
    const duty = await run(() => api('/transit/duty', { method: 'POST', body: JSON.stringify({ crewPlanId: id, role }) }) as Promise<{ id: string }>)
    if (duty) setSelectedDutyId(duty.id)
  }

  async function handleDeletePiece(pieceId: string) {
    await run(() => api(`/transit/duty-piece/${pieceId}`, { method: 'DELETE' }))
  }

  // creates the activity; a meal break away from a meal locality is saved but flagged
  // (DutyIssue MEAL_LOCATION) — warned right away, read from the board run() just refetched
  async function createActivity(dutyId: string, input: ActivityInput, success?: string): Promise<boolean> {
    const created = await run(() => api('/transit/duty-activity', { method: 'POST', body: JSON.stringify({ dutyId, ...input }) }) as Promise<{ id: string }>, success)
    if (!created) return false
    const board = queryClient.getQueryData<CrewBoardData>(['transit', 'crew-plan', id, 'board'])
    const flagged = board?.duties.find(d => d.id === dutyId)?.issues.some(i => i.code === 'MEAL_LOCATION' && i.activityId === created.id)
    if (flagged) toast.warning('Refeição fora de local permitido — a jornada ficou com pendência')
    return true
  }

  async function handleAddActivity(input: ActivityInput): Promise<boolean> {
    return selectedDuty ? createActivity(selectedDuty.id, input) : false
  }

  // break inside a piece, from the duty view's idle stretches
  async function handleAddBreak(input: ActivityInput) {
    if (breakDraft && await createActivity(breakDraft.duty.id, input, 'Intervalo adicionado')) setBreakDraft(null)
  }

  async function handleToggleLock() {
    if (!selectedDuty) return
    await run(() => api(`/transit/duty/${selectedDuty.id}/lock`, { method: 'POST', body: JSON.stringify({ locked: !selectedDuty.locked }) }))
  }

  async function handleDeleteActivity(activityId: string) {
    await run(() => api(`/transit/duty-activity/${activityId}`, { method: 'DELETE' }))
  }

  // ── plan-level actions ─────────────────────────────────────────────────────

  async function handleActivate() {
    const s = data?.plan.summary
    if (s && s.issueDutyCount > 0) {
      const ok = await confirm({
        title:        'Ativar escala com pendências',
        description:  `${s.issueDutyCount} jornada(s) não atendem a todos os critérios de jornada. Ativar mesmo assim?`,
        confirmLabel: 'Ativar',
      })
      if (!ok) return
    }
    setActivationOpen(true)
  }

  async function handleDeletePlan() {
    const ok = await confirm({ title: 'Excluir escala', description: 'A escala e todas as suas jornadas serão removidas.', confirmLabel: 'Excluir', variant: 'destructive' })
    if (!ok || !data) return
    setBusyMessage('Excluindo escala…')
    const done = await run(() => api(`/transit/crew-plan/${id}`, { method: 'DELETE' }).then(() => true))
    // on success the overlay stays up until the navigation unmounts the page
    if (done) router.push(`/transit/vehicle-plan/${data.vehiclePlan.id}`)
    else setBusyMessage(null)
  }

  async function handleNewVersion() {
    if (!data) return
    const plan = await run(() => api('/transit/crew-plan', {
      method: 'POST',
      body:   JSON.stringify({ vehiclePlanId: data.vehiclePlan.id, description: 'Nova escala' }),
    }) as Promise<{ id: string }>)
    if (plan) router.push(`/transit/crew-plan/${plan.id}`)
  }

  async function handleDuplicate() {
    const plan = await run(() => api(`/transit/crew-plan/${id}/duplicate`, { method: 'POST' }) as Promise<{ id: string }>, 'Escala duplicada')
    if (plan) router.push(`/transit/crew-plan/${plan.id}`)
  }

  // ── topbar & shortcuts ─────────────────────────────────────────────────────

  const isActive = data?.plan.status === 'ACTIVE'
  const isDraft  = data?.plan.status === 'DRAFT'
  const versions = data?.versions ?? []

  useTopbarActions([
    ...(data ? [{
      label:    'Veículos',
      icon:     Icons.ArrowRightLeft,
      size:     'sm' as const,
      variant:  'ghost' as const,
      onClick:  () => router.push(`/transit/vehicle-plan/${data.vehiclePlan.id}`),
      position: 'start' as const,
    }] : []),
    // view toggle — shows the current view; fixed width so the label swap doesn't reflow
    ...(data ? [{
      label:     view === 'duties' ? 'Jornadas' : 'Carros',
      icon:      view === 'duties' ? Icons.Users : Icons.Bus,
      size:      'sm' as const,
      // variant:   'outline' as const,
      onClick:   () => setView(view === 'duties' ? 'vehicles' : 'duties'),
      position:  'start' as const,
      className: 'md:w-25',
    }] : []),
    ...(data ? [{
      label:    'Filtro',
      icon:     Icons.Filter,
      size:     'icon' as const,
      variant:  (filterOpen ? 'default' : 'ghost') as 'default' | 'ghost',
      onClick:  toggleFilter,
      keybind:  'F7',
      position: 'start' as const,
    }] : []),
    ...(data ? [{
      label:    'Exibir',
      icon:     Icons.Eye,
      size:     'sm' as const,
      variant:  'ghost' as const,
      menuOnly: true,
      menu: [
        { label: 'Cores das linhas', onClick: toggleLineColors, checked: showLineColors },
      ],
    }] : []),
    ...(data ? [{
      label:   `Versão (${versions.length})`,
      icon:    Icons.GitBranch,
      size:    'sm' as const,
      variant: 'ghost' as const,
      menu: [
        ...versions.map(v => ({
          label:    `${v.id === id ? '• ' : ''}${v.description || 'Sem descrição'}${v.status === 'ACTIVE' ? ' (ativa)' : ''}`,
          onClick:  () => { if (v.id !== id) router.push(`/transit/crew-plan/${v.id}`) },
        })),
        ...(canEdit ? [
          { label: 'Nova escala', icon: Icons.Plus, onClick: () => void handleNewVersion() },
          { label: 'Duplicar',    icon: Icons.Copy, onClick: () => void handleDuplicate() },
        ] : []),
      ],
    }] : []),
    { label: '', separator: true },
    { label: 'Menos zoom', icon: Icons.ZoomOut, size: 'icon' as const, variant: 'ghost' as const, disabled: zoomIdx === 0, onClick: () => setZoomIdx(i => Math.max(0, i - 1)) },
    // current level — clicking it resets to the initial level
    { label: `${Math.round((ZOOMS[zoomIdx] / ZOOMS[ZOOM_100]) * 100)}%`, size: 'sm' as const, variant: 'ghost' as const, onClick: () => setZoomIdx(ZOOM_DEFAULT) },
    { label: 'Mais zoom', icon: Icons.ZoomIn, size: 'icon' as const, variant: 'ghost' as const, disabled: zoomIdx === ZOOMS.length - 1, onClick: () => setZoomIdx(i => Math.min(ZOOMS.length - 1, i + 1)) },
    // split button — main action: generate a new version (crew solver); tail swaps edit the
    // VehiclePlan, so they are limited to the approved (ACTIVE) crew plan
    ...(canEdit && data ? [{
      // a generation in progress or waiting to be used shows here; clicking picks it up
      label:    solverJob?.running
        ? `Gerando… ${fmtClock(solverJob.progress?.elapsed ?? 0)}`
        : solverJob?.hasProposal ? 'Otimizar • proposta pronta' : 'Otimizar',
      icon:     solverJob?.running ? Icons.Loader2 : Icons.Sparkles,
      size:     'sm' as const,
      variant:  'ghost' as const,
      onClick:  () => setOptimizeTab(solverJob ? 'scenarios' : 'panel'),
      menu: [
        { label: 'Gerar escala',  icon: Icons.Play,      onClick: () => setOptimizeTab('panel') },
        { label: 'Configurações', icon: Icons.Settings2, onClick: () => setOptimizeTab('config') },
        {
          label:    isActive ? 'Reduzir trocas de carro' : 'Reduzir trocas de carro',
          icon:     Icons.ArrowLeftRight,
          onClick:  () => setSwapOpen(true),
          disabled: !isActive || saving,
        },
      ],
    }] : []),
    ...(selectedDuty && canEdit ? [{
      label:    saving ? 'Salvando…' : 'Salvar',
      icon:     Icons.Save,
      type:     'submit' as const,
      form:     DUTY_FORM_ID,
      primary:  true,
      disabled: saving,
      keybind:  'Alt+G',
    }] : []),
    ...(canEdit && data && isDraft ? [{
      label:    'Ativar',
      icon:     Icons.CheckCircle,
      onClick:  () => void handleActivate(),
      disabled: saving || data.vehiclePlan.status === 'DRAFT',
      overflow: true,
    }] : []),
    ...(data ? [{
      label:    'Exportar Escala',
      icon:     Icons.FileSpreadsheet,
      onClick:  () => setCsvExportOpen(true),
      overflow: true,
    }] : []),
    ...(canDelete && data && isDraft ? [{ label: '', separator: true, overflow: true }, {
      label:    'Excluir',
      icon:     Icons.Trash2,
      onClick:  () => void handleDeletePlan(),
      disabled: saving,
      variant:  'destructive' as const,
      overflow: true,
    }] : []),
  ], [data, id, saving, canEdit, canDelete, selectedDuty?.id, zoomIdx, view, filterOpen, showLineColors, solverJob])

  useShortcut('alt+g', () => {
    (document.getElementById(DUTY_FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar jornada', icon: Icons.Save, origin: ORIGIN, enabled: !!selectedDuty && canEdit })
  useShortcut('alt+v', () => router.push('/transit/vehicle-plan'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN })
  useShortcut('alt+l', () => setResetSignal(s => s + 1), { display: false, origin: ORIGIN })
  useShortcut('f7', toggleFilter, { desc: 'Filtro', icon: Icons.Filter, origin: ORIGIN })
  useShortcut('esc', () => {
    if (draftStart) setDraftStart(null)
    else if (selectedDutyId) setSelectedDutyId(null)
  }, { display: false, origin: ORIGIN, enabled: !assignDraft && !breakDraft && !optimizeTab && !swapOpen })

  // ── render ─────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  const summary = data?.plan.summary
  const flaggedBlocks = data?.blocks.filter(b => b.issues.length > 0).length ?? 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {busyMessage && <BusyOverlay message={busyMessage} />}
      {csvExportOpen && (
        <PlanCsvModal
          title="Exportar Escala"
          endpoint={`/transit/crew-plan/${id}/csv?view=${view}`}
          onClose={() => setCsvExportOpen(false)}
        />
      )}
      {activationOpen && (
        <ActivationModal
          title="Ativar escala"
          endpoint={`/transit/crew-plan/${id}/activate`}
          confirmLabel="Ativar"
          onClose={() => setActivationOpen(false)}
          onDone={() => { setActivationOpen(false); toast.success('Escala ativada'); void refetch() }}
        />
      )}

      {assignDraft && data && (
        <AssignPieceModal
          block={assignDraft.block}
          start={assignDraft.start}
          end={assignDraft.end}
          duties={data.duties}
          defaultDutyId={selectedDutyId}
          localityName={localityName}
          saving={saving}
          onConfirm={(t) => void handleAssign(t)}
          onClose={() => setAssignDraft(null)}
        />
      )}

      {optimizeTab && data && solverJobFetched && (
        <OptimizeCrewModal
          crewPlanId={id}
          initialTab={optimizeTab}
          planStatus={data.plan.status}
          job={solverJob}
          onJobChanged={() => void refetchSolverJob()}
          onApplied={() => { closeOptimize(); setSelectedDutyId(null); void refetchSolverJob(); void refetch(); toast.success('Proposta aplicada na escala') }}
          current={data.plan.summary}
          lockedCount={data.duties.filter(d => d.locked).length}
          flaggedBlocks={flaggedBlocks}
          vehiclePlanId={data.vehiclePlan.id}
          onSettingsSaved={() => void refetch()}
          onCreated={(newId) => { closeOptimize(); void refetchSolverJob(); toast.success('Nova versão da escala criada'); router.push(`/transit/crew-plan/${newId}`) }}
          onClose={() => { closeOptimize(); void refetchSolverJob() }}
        />
      )}

      {swapOpen && data && (
        <VehicleSwapModal
          crewPlanId={id}
          duties={data.duties}
          onApplied={() => void refetch()}
          onClose={() => setSwapOpen(false)}
        />
      )}

      {breakDraft && (
        <BreakModal
          draft={breakDraft}
          saving={saving}
          onConfirm={(input) => void handleAddBreak(input)}
          onClose={() => setBreakDraft(null)}
        />
      )}

      <div className="px-6 pt-4 pb-2 shrink-0 space-y-1">
        <AutoBreadcrumb
          domain="transit" resource="crew-plan" id={id}
          recordName={data?.plan.description ?? undefined}
          contextParams={data ? { vehiclePlanId: data.vehiclePlan.id } : {}}
        />
        {data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <InlineDescription
              value={data.plan.description ?? undefined}
              disabled={!canEdit}
              onSave={async (val) => {
                await api(`/transit/crew-plan/${id}`, { method: 'PATCH', body: JSON.stringify({ description: val }) })
                await refetch()
              }}
            />
            <Badge {...vigenceBadge(data.plan.status, data.plan.validFrom, data.plan.validTo)} />
            <span>Planejamento: {data.vehiclePlan.description || data.vehiclePlan.dayTypeName}{data.vehiclePlan.status === 'ACTIVE' ? ' (ativo)' : ''}</span>
            {summary && summary.uncoveredMinutes > 0 && (
              <span className="text-red-600 dark:text-red-400">{summary.uncovered.length} trecho(s) sem motorista</span>
            )}
            {flaggedBlocks > 0 && (
              <Link href={`/transit/vehicle-plan/${data.vehiclePlan.id}`} className="text-amber-600 dark:text-amber-400 hover:underline" title="Erros de lançamento no planejamento de veículos — veja o ícone na linha do carro">
                {flaggedBlocks} carro(s) com lançamento a revisar
              </Link>
            )}
            {summary && summary.staleDutyCount > 0 && (
              <span className="text-red-600 dark:text-red-400">{summary.staleDutyCount} jornada(s) desatualizada(s)</span>
            )}
            {view === 'duties'
              ? null
              : draftStart
              ? <span className="text-amber-600 dark:text-amber-400">Selecione o ponto de fim da pegada (Esc cancela)</span>
              : canEdit && <span>Clique num ponto de troca para fechar uma pegada · Shift+clique escolhe o início</span>}
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 border-t overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {filterOpen && data && (
            <div className="shrink-0 px-2 py-1.5 border-b border-border">
              <CrewFilterBar
                view={view}
                filter={filter}
                onChange={setFilter}
                matchCount={matchCount}
                operators={data.operators}
                lineCodes={planLineCodes}
                onClose={toggleFilter}
              />
            </div>
          )}
          <div className="flex-1 min-h-0">
          {data ? (
            view === 'duties' ? (
              <DutyBoard
                range={range}
                blockById={blockById}
                duties={visibleDuties}
                signOnMinutes={data.plan.signOnMinutes}
                signOffMinutes={data.plan.signOffMinutes}
                localityName={localityName}
                pxPerMinute={ZOOMS[zoomIdx]}
                selectedDutyId={selectedDutyId}
                onSelectDuty={(duty) => setSelectedDutyId(duty.id)}
                lineColors={lineColors}
                canEdit={canEdit && !saving}
                onSlotClick={(duty, slot) => { setSelectedDutyId(duty.id); setBreakDraft({ duty, ...slot }) }}
                scrollRef={boardScroll}
                pinnable={filterOpen}
                pinnedIds={pinnedDutyIds}
                onTogglePin={(dutyId) => togglePin(setPinnedDutyIds, dutyId)}
              />
            ) : data.blocks.length > 0 ? (
              <CrewBoard
                range={range}
                blocks={visibleBlocks}
                duties={data.duties}
                uncovered={summary?.uncovered ?? []}
                localityName={localityName}
                pxPerMinute={ZOOMS[zoomIdx]}
                selectedDutyId={selectedDutyId}
                draftStart={draftStart}
                canEdit={canEdit && !saving}
                onPointClick={handlePointClick}
                onPieceClick={(duty) => setSelectedDutyId(duty.id)}
                lineColors={lineColors}
                scrollRef={boardScroll}
                pinnable={filterOpen}
                pinnedIds={pinnedBlockIds}
                onTogglePin={(blockId) => togglePin(setPinnedBlockIds, blockId)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">O planejamento não tem blocos</div>
            )
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Carregando…</div>
          )}
          </div>
        </div>

        {data && (selectedDuty ? (
          <DutyPanel
            duty={selectedDuty}
            blockById={blockById}
            lineCodes={dutyLines.get(selectedDuty.id) ?? []}
            operators={data.operators}
            localityName={localityName}
            canEdit={canEdit}
            resetSignal={resetSignal}
            onSave={(p) => void handleSaveDuty(p)}
            onDelete={() => void handleDeleteDuty()}
            onDeletePiece={(pid) => void handleDeletePiece(pid)}
            onAddActivity={handleAddActivity}
            onDeleteActivity={(aid) => void handleDeleteActivity(aid)}
            onClose={() => setSelectedDutyId(null)}
            onToggleLock={() => void handleToggleLock()}
          />
        ) : (
          <PlanPanel
            data={data}
            duties={panelDuties}
            issuesActive={filterOpen && filter.withIssues}
            staleActive={filterOpen && filter.staleOnly}
            onToggleIssues={() => toggleDutyFlag('withIssues')}
            onToggleStale={() => toggleDutyFlag('staleOnly')}
            canEdit={canEdit}
            onSelect={focusDuty}
            onCreate={(role) => void handleCreateDuty(role)}
          />
        ))}
      </div>
    </div>
  )
}
