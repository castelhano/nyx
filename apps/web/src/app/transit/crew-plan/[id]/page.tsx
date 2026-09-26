'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
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
import { DutyPanel, DUTY_FORM_ID, type DutyPatch, type ActivityInput } from './components/DutyPanel'
import { PlanPanel } from './components/PlanPanel'
import { CrewSettingsModal } from './components/CrewSettingsModal'
import { DutyBoard } from './components/DutyBoard'
import { useTimeRange, LABEL_W } from './components/Timeline'
import { CrewFilterBar } from './components/CrewFilterBar'
import { EMPTY_FILTER, isFilterActive, blockMatches, dutyMatches, type CrewFilter } from './filters'
import { lineColorMap, dutyLineCodes } from './board.types'
import { InlineDescription } from '../../vehicle-plan/[id]/components/InlineDescription'

// Logical crew schedule of a VehiclePlan (docs/proposal/plan_crew_plan_v1.md). Every edit
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

export default function CrewPlanPage() {
  const { id }    = useParams<{ id: string }>()
  const router    = useRouter()
  // vehicle view (one row per block, default) or duty view (one row per duty) — kept in the
  // URL so a reload or a shared link opens the same view
  const view      = useSearchParams().get('view') === 'duties' ? 'duties' : 'vehicles'
  const setView   = (v: 'vehicles' | 'duties') => {
    setDraftStart(null) // a piece being picked belongs to the vehicle view
    router.replace(v === 'duties' ? '?view=duties' : '?', { scroll: false })
  }
  const { toast } = useToast()
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
  const canEdit = canUpdate

  const [selectedDutyId, setSelectedDutyId] = useState<string | null>(null)
  const [draftStart, setDraftStart]         = useState<PieceDraftStart | null>(null)
  const [assignDraft, setAssignDraft]       = useState<{ block: BoardBlock; start: ReliefPoint; end: ReliefPoint } | null>(null)
  const [breakDraft, setBreakDraft]         = useState<BreakDraft | null>(null)
  const [saving, setSaving]                 = useState(false)
  const [zoomIdx, setZoomIdx]               = useState(ZOOM_DEFAULT)
  const [resetSignal, setResetSignal]       = useState(0)
  const [settingsOpen, setSettingsOpen]     = useState(false)
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

  const lineColors = useMemo(
    () => showLineColors && data ? lineColorMap(data.lineCodes) : null,
    [showLineColors, data],
  )

  const blockById = useMemo(() => new Map((data?.blocks ?? []).map(b => [b.id, b])), [data?.blocks])

  // lines each duty operates (panel, filter) and the lines the plan runs (filter options)
  const dutyLines = useMemo(
    () => new Map((data?.duties ?? []).map(d => [d.id, dutyLineCodes(d, blockById, data?.lineCodes ?? [])])),
    [data, blockById],
  )
  const planLineCodes = useMemo(() => {
    const used = new Set((data?.blocks ?? []).flatMap(b => b.trips.map(t => t.lineCode)))
    return (data?.lineCodes ?? []).filter(c => used.has(c))
  }, [data])

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

  async function handleAddActivity(input: ActivityInput): Promise<boolean> {
    if (!selectedDuty) return false
    const res = await run(() => api('/transit/duty-activity', { method: 'POST', body: JSON.stringify({ dutyId: selectedDuty.id, ...input }) }).then(() => true))
    return !!res
  }

  // break inside a piece, from the duty view's idle stretches
  async function handleAddBreak(input: ActivityInput) {
    if (!breakDraft) return
    const res = await run(() => api('/transit/duty-activity', { method: 'POST', body: JSON.stringify({ dutyId: breakDraft.duty.id, ...input }) }).then(() => true), 'Intervalo adicionado')
    if (res) setBreakDraft(null)
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
    await run(() => api(`/transit/crew-plan/${id}/activate`, { method: 'POST' }), 'Escala ativada')
  }

  async function handleDeletePlan() {
    const ok = await confirm({ title: 'Excluir escala', description: 'A escala e todas as suas jornadas serão removidas.', confirmLabel: 'Excluir', variant: 'destructive' })
    if (!ok || !data) return
    const done = await run(() => api(`/transit/crew-plan/${id}`, { method: 'DELETE' }).then(() => true))
    if (done) router.push(`/transit/vehicle-plan/${data.vehiclePlan.id}`)
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
    ...(selectedDuty && canEdit ? [{
      label:    saving ? 'Salvando…' : 'Salvar',
      icon:     Icons.Save,
      type:     'submit' as const,
      form:     DUTY_FORM_ID,
      primary:  true,
      disabled: saving,
      keybind:  'Alt+G',
    }] : []),
    ...(data ? [{
      label:    'Configurações',
      icon:     Icons.Settings2,
      onClick:  () => setSettingsOpen(true),
      overflow: true,
    }] : []),
    ...(canEdit && data && !isActive ? [{
      label:    'Ativar',
      icon:     Icons.CheckCircle,
      onClick:  () => void handleActivate(),
      disabled: saving || data.vehiclePlan.status !== 'ACTIVE',
      overflow: true,
    }] : []),
    ...(canDelete && data && !isActive ? [{
      label:    'Excluir',
      icon:     Icons.Trash2,
      onClick:  () => void handleDeletePlan(),
      disabled: saving,
      variant:  'destructive' as const,
      overflow: true,
    }] : []),
  ], [data, id, saving, canEdit, canDelete, selectedDuty?.id, zoomIdx, view, filterOpen, showLineColors])

  useShortcut('alt+g', () => {
    (document.getElementById(DUTY_FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar jornada', icon: Icons.Save, origin: ORIGIN, enabled: !!selectedDuty && canEdit })
  useShortcut('alt+v', () => router.push('/transit/vehicle-plan'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN })
  useShortcut('alt+l', () => setResetSignal(s => s + 1), { display: false, origin: ORIGIN })
  useShortcut('f7', toggleFilter, { desc: 'Filtro', icon: Icons.Filter, origin: ORIGIN })
  useShortcut('esc', () => {
    if (draftStart) setDraftStart(null)
    else if (selectedDutyId) setSelectedDutyId(null)
  }, { display: false, origin: ORIGIN, enabled: !assignDraft && !breakDraft && !settingsOpen })

  // ── render ─────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  const summary = data?.plan.summary

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {settingsOpen && (
        <CrewSettingsModal
          crewPlanId={id}
          canEdit={canEdit}
          onChanged={() => void refetch()}
          onClose={() => setSettingsOpen(false)}
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
            <span>{isActive ? 'Ativa' : 'Rascunho'}</span>
            <span>Planejamento: {data.vehiclePlan.description || data.vehiclePlan.dayTypeName}{data.vehiclePlan.status === 'ACTIVE' ? ' (ativo)' : ''}</span>
            {summary && summary.uncoveredMinutes > 0 && (
              <span className="text-red-600 dark:text-red-400">{summary.uncovered.length} trecho(s) sem motorista</span>
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
          />
        ) : (
          <PlanPanel
            data={data}
            canEdit={canEdit}
            onSelect={focusDuty}
            onCreate={(role) => void handleCreateDuty(role)}
          />
        ))}
      </div>
    </div>
  )
}
