'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Icons }             from '@/lib/icons'
import { AutoBreadcrumb }    from '@/core/AutoBreadcrumb'
import { usePageGuard }      from '@/core/usePageGuard'
import { useRecordQuery }    from '@/core/useRecordQuery'
import { useTopbarActions }  from '@/components/layout/topbar-actions-context'
import { useShortcut }       from '@/lib/keywatch'
import { apiFetch, getToken } from '@/lib/auth'
import { useConfirm }         from '@/lib/confirm-context'
import { useToast }          from '@/lib/toast-context'
import { extractError }      from '@/lib/utils'
import { GanttBoard }      from './components/GanttBoard'
import { LinesPanel }      from './components/LinesPanel'
import { FrequencyPanel }  from './components/FrequencyPanel'
import { GenerateModal }       from './components/GenerateModal'
import { SolverProposalDialog } from './components/SolverProposalDialog'
import type { SolverScenario, SolverBaseline } from './components/SolverProposalDialog'
import { Button }          from '@/components/ui/button'
import type { VehiclePlanGanttData } from './views/vehicles.view'
import type { ViewportSnapshot }     from './engine/gantt.types'
import type { SolverParams }         from './components/GenerateModal'

const INITIAL_VP: ViewportSnapshot = { scrollX: 0, scrollY: 0, pixelsPerMinute: 1.2, width: 0, dayStartMinute: 0 }

// ── solver progress via SSE ───────────────────────────────────────────────────

interface SolverMessage {
  type:           string
  stage?:         number
  stageLabel?:    string
  attempt?:       number
  bestScore?:     number
  bestFleet?:     number
  elapsed?:       number
  stopReason?:    string
  totalAttempts?: number
  proposalIndex?: number
  scenario?:      SolverScenario
}

interface SolverDisplayState {
  proposalCount:     number
  fleetCount:        number | null
  score:             number | null
  totalIterations:   number
  currentLevel:      number
  currentLevelLabel: string
  bestScenario:      SolverScenario | null
}

const SOLVER_DISPLAY_RESET: SolverDisplayState = {
  proposalCount: 0, fleetCount: null, score: null, totalIterations: 0,
  currentLevel: 1, currentLevelLabel: 'FLEET', bestScenario: null,
}

function useSolverStream(planId: string, jobId: string | null, onDone: () => void) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const hadProgressRef = useRef(false)
  const [state, setState] = useState<SolverDisplayState>(SOLVER_DISPLAY_RESET)

  useEffect(() => {
    if (!jobId) {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      hadProgressRef.current = false
      setState(SOLVER_DISPLAY_RESET)
      return
    }

    hadProgressRef.current = false
    const token = getToken()
    const url   = `/api/transit/vehicle-plan/${planId}/stream?jobId=${jobId}&token=${encodeURIComponent(token)}`
    const es    = new EventSource(url)

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as SolverMessage

        if (msg.type === 'progress') {
          hadProgressRef.current = true
          setState(s => ({
            ...s,
            totalIterations: msg.attempt ?? s.totalIterations,
            fleetCount:      msg.bestFleet ?? s.fleetCount,
            score:           msg.bestScore ?? s.score,
          }))
        }

        if (msg.type === 'proposal') {
          const isStochastic = hadProgressRef.current
          setState(s => ({
            ...s,
            proposalCount:   msg.proposalIndex ?? s.proposalCount,
            fleetCount:      msg.scenario?.fleetCount ?? s.fleetCount,
            score:           msg.scenario?.score      ?? s.score,
            bestScenario:    msg.scenario ? { ...msg.scenario } : s.bestScenario,
            // deterministic: no progress msgs — count proposals as iterations
            totalIterations: isStochastic ? s.totalIterations : (msg.proposalIndex ?? s.proposalCount + 1),
          }))
        }

        if (msg.type === 'improvement') {
          setState(s => ({
            ...s,
            proposalCount: msg.proposalIndex ?? s.proposalCount,
            fleetCount:    msg.scenario?.fleetCount ?? s.fleetCount,
            score:         msg.scenario?.score      ?? s.score,
            bestScenario:  msg.scenario ? { ...msg.scenario } : s.bestScenario,
          }))
        }

        if (msg.type === 'done') {
          es.close()
          onDone()
        }
      } catch { /* ignore */ }
    }

    es.onerror = () => {
      es.close()
      onDone()
    }

    eventSourceRef.current = es
    return () => es.close()
  }, [planId, jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

// ── creation form (shown when id === 'new') ───────────────────────────────────

interface DayType { id: string; name: string; code: string }

function NewPlanForm() {
  const router    = useRouter()
  const { toast } = useToast()

  const [dayTypeId, setDayTypeId] = useState('')
  const [isPending, setIsPending] = useState(false)

  const { data: dayTypes = [] } = useQuery<DayType[]>({
    queryKey: ['transit', 'day-type', 'list'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/day-type')
      if (!res.ok) throw new Error('Erro ao carregar tipos de dia')
      const json = await res.json()
      return json.data ?? json
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!dayTypeId && dayTypes.length > 0) setDayTypeId(dayTypes[0].id)
  }, [dayTypes, dayTypeId])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!dayTypeId) return
    setIsPending(true)
    try {
      const res = await apiFetch('/transit/vehicle-plan', {
        method: 'POST',
        body:   JSON.stringify({ dayTypeId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const created = await res.json()
      router.push(`/transit/vehicle-plan/${created.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar planejamento')
      setIsPending(false)
    }
  }

  return (
    <div className="flex flex justify-center p-8">
      <form
        onSubmit={handleCreate}
        className="w-full max-w-sm space-y-4 border border-border rounded-md p-6 bg-card"
      >
        <div>
          <h2 className="text-base font-semibold mb-2">Novo Planejamento</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Selecione o tipo de dia para iniciar.
          </p>
        </div>

        <div>
          <label htmlFor="dayTypeId" className="text-sm font-medium">
            Tipo de Dia <span className="ps-1">*</span>
          </label>
          <div className="relative mt-2">
            <select
              id="dayTypeId"
              value={dayTypeId}
              onChange={e => setDayTypeId(e.target.value)}
              required
              autoFocus
              className="w-full appearance-none border border-input rounded-sm text-sm bg-input-bg px-3 py-2 pe-8 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              {dayTypes.map(dt => (
                <option key={dt.id} value={dt.id}>{dt.name}</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>
        <div className="flex justify-end space-x-4">
          <Button type="submit" disabled={isPending || !dayTypeId} className="w-full" size="default">
          {isPending ? 'Criando…' : 'Criar Planejamento'}
          </Button>
          <Button type="button" className="w-full" size="default" variant='cancel' onClick={ () => router.push('/transit/vehicle-plan') }>
            Voltar
          </Button>
        </div>
      </form>
    </div>
  )
}

// ── inline description editor ─────────────────────────────────────────────────

function InlineDescription({
  value,
  disabled,
  onSave,
}: {
  value?:   string
  disabled?: boolean
  onSave:   (val: string) => Promise<void>
}) {
  const { toast }            = useToast()
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const inputRef              = useRef<HTMLInputElement>(null)

  function startEdit() {
    if (disabled) return
    setDraft(value ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === (value ?? '').trim()) return
    try {
      await onSave(trimmed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar descrição')
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur() }
          if (e.key === 'Escape') { setEditing(false) }
        }}
        className="text-sm border-b border-border bg-transparent focus:outline-none focus:border-ring min-w-32 max-w-64"
      />
    )
  }

  return (
    <span>
      <Icons.Option className="inline w-4 h-4 me-1 text-cyan-700" />
      <span
      onDoubleClick={startEdit}
      title={disabled ? undefined : 'Duplo clique para editar'}
      className={disabled ? undefined : 'cursor-text'}
      >
      {value
        ? <span className="text-foreground  uppercase">{value}</span>
        : <span className="italic text-muted-foreground/60">Descrição</span>
      }
      </span>
    </span>    
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function VehiclePlanPage() {
  const { id }      = useParams<{ id: string }>()
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { toast }   = useToast()
  const confirm     = useConfirm()

  const isNew = id === 'new'

  const [isPending,         setIsPending]         = useState(false)
  const [activeJobId,       setActiveJobId]       = useState<string | null>(null)
  const [isSolverDone,      setIsSolverDone]      = useState(false)
  const [linesPanelOpen,    setLinesPanelOpen]    = useState(false)
  const [freqPanelOpen,     setFreqPanelOpen]     = useState(false)
  const [ganttVp,           setGanttVp]           = useState<ViewportSnapshot>(INITIAL_VP)
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [detailsOpen,       setDetailsOpen]       = useState(false)
  const [baselineSnapshot,  setBaselineSnapshot]  = useState<SolverBaseline | null>(null)

  // Lines selection for display — all unchecked initially, nothing plotted
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set())
  const [plottedLineIds,  setPlottedLineIds]  = useState<Set<string> | null>(null)

  // ── data ────────────────────────────────────────────────────────────────────

  const { data: record, error: recordError } = useRecordQuery(
    ['transit', 'vehicle-plan', id],
    `/transit/vehicle-plan/${id}`,
    { enabled: !isNew, staleTime: 30_000 },
  )

  const { guardNode, canUpdate } = usePageGuard(
    'transit', 'vehicle-plan', isNew, recordError ?? undefined,
  )

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

  // Filtered data: only blocks that have at least one productive trip from a plotted line
  const plottedData = useMemo<VehiclePlanGanttData | null>(() => {
    if (!ganttData || plottedLineIds === null) return null
    if (plottedLineIds.size === 0) return { ...ganttData, blocks: [] }
    return {
      ...ganttData,
      blocks: ganttData.blocks.filter(b =>
        b.blockTrips.some(bt => !bt.isDeadhead && plottedLineIds.has(bt.trip.route.line.id))
      ),
    }
  }, [ganttData, plottedLineIds])

  // ── solver ──────────────────────────────────────────────────────────────────

  const onSolverDone = useCallback(() => {
    setIsSolverDone(true)
    setIsPending(false)
  }, [])

  const solverProgress = useSolverStream(id, activeJobId, onSolverDone)

  async function handleGenerate(params: SolverParams) {
    setGenerateModalOpen(false)
    if (!canUpdate) return

    const savedSummary = (record as any)?.summary as Record<string, number> | null | undefined
    if (savedSummary?.fleetCount != null) {
      setBaselineSnapshot({
        fleetCount:   savedSummary.fleetCount,
        score:        savedSummary.score        ?? 0,
        deadrunKm:    savedSummary.deadrunKm    ?? 0,
        productiveKm: savedSummary.productiveKm ?? 0,
        totalKm:      savedSummary.totalKm      ?? 0,
      })
    } else if (ganttData) {
      setBaselineSnapshot({
        fleetCount:   ganttData.blocks.length,
        score:        0,
        deadrunKm:    ganttData.blocks
          .flatMap(b => b.blockTrips.filter(bt => bt.isDeadhead))
          .reduce((sum, bt) => sum + (bt.deadheadKm ?? 0), 0),
        productiveKm: 0,
        totalKm:      0,
      })
    }

    if (activeJobId) {
      try {
        await apiFetch(`/transit/vehicle-plan/${id}/stop`, {
          method: 'POST',
          body:   JSON.stringify({ jobId: activeJobId }),
        })
      } catch { /* ignore */ }
      setActiveJobId(null)
    }
    setIsSolverDone(false)
    setIsPending(true)
    const jobId = crypto.randomUUID()
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/generate`, {
        method: 'POST',
        body:   JSON.stringify({ jobId, params }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      setActiveJobId(jobId)
      setIsPending(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao iniciar geração')
      setIsPending(false)
    }
  }

  async function handleClearMetrics() {
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ metrics: null }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
      toast.success('Configuração personalizada removida')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao limpar configuração')
    }
  }

  async function handleStop() {
    if (!activeJobId) return
    try {
      await apiFetch(`/transit/vehicle-plan/${id}/stop`, {
        method: 'POST',
        body:   JSON.stringify({ jobId: activeJobId }),
      })
    } catch { /* ignore */ }
  }

  async function handleAssumeBest() {
    if (!activeJobId) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/assume`, {
        method: 'POST',
        body:   JSON.stringify({ jobId: activeJobId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      setActiveJobId(null)
      setIsSolverDone(false)
      toast.success('Melhor solução assumida')
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
      await refetchGantt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao assumir solução')
    } finally {
      setIsPending(false)
    }
  }

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

  async function handleActivate() {
    if (!canUpdate) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/activate`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      toast.success('Planejamento ativado')
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ativar')
    } finally {
      setIsPending(false)
    }
  }

  function handlePlot() {
    setPlottedLineIds(new Set(selectedLineIds))
    setActiveJobId(null)
    setIsSolverDone(false)
  }

  // ── topbar ───────────────────────────────────────────────────────────────────

  const status           = record?.status as string | undefined
  const planLines        = ganttData?.plan?.lines ?? []
  const hasCustomMetrics = !!( (record as Record<string, unknown> | undefined)?.metrics )
  const fleetDelta       = baselineSnapshot != null && solverProgress.fleetCount != null
    ? solverProgress.fleetCount - baselineSnapshot.fleetCount
    : null

  useTopbarActions([
    // lines panel toggle
    ...(!isNew ? [{
      label:   'Linhas',
      icon:    Icons.List,
      onClick: () => setLinesPanelOpen(v => !v),
    }] : []),
    // plot button — visible when plan has lines
    ...(!isNew && planLines.length > 0 ? [{
      label:    'Plotar',
      icon:     Icons.BarChart2,
      onClick:  handlePlot,
      disabled: selectedLineIds.size === 0,
      primary:  true,
    }] : []),
    // parar: only while stream is open
    ...(activeJobId && !isSolverDone ? [{
      label:    'Parar',
      icon:     Icons.Square,
      onClick:  handleStop,
      disabled: isPending,
    }] : []),
    // assumir
    ...(activeJobId ? [{
      label:    'Assumir Melhor',
      icon:     Icons.Download,
      onClick:  handleAssumeBest,
      disabled: isPending,
    }] : []),
    // generate: show when idle or after solver stopped (done state)
    ...((!activeJobId || isSolverDone) && canUpdate && status === 'DRAFT' ? [
      {
        label:    isPending ? 'Gerando…' : 'Gerar',
        icon:     Icons.Play,
        onClick:  () => setGenerateModalOpen(true),
        disabled: isPending,
      },
    ] : []),
    // activate
    ...(!activeJobId && canUpdate && status === 'DRAFT' ? [
      {
        label:    isPending ? 'Ativando…' : 'Ativar',
        icon:     Icons.CheckCircle,
        onClick:  handleActivate,
        disabled: isPending,
      },
    ] : []),
    // delete
    ...(!activeJobId && canUpdate && status === 'DRAFT' ? [
      {
        label:    'Excluir',
        icon:     Icons.Trash2,
        onClick:  handleDelete,
        disabled: isPending,
        variant:  'destructive' as const,
      },
    ] : []),
  ], [isPending, activeJobId, isSolverDone, canUpdate, status, isNew, linesPanelOpen, planLines.length, selectedLineIds.size])

  // ── shortcuts ─────────────────────────────────────────────────────────────

  useShortcut('alt+v', () => router.push('/transit/vehicle-plan'), {
    desc:    'Voltar',
    icon:    Icons.ArrowLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    context: 'all',
  })

  useShortcut('ctrl+;', () => setFreqPanelOpen(v => !v), {
    desc:   'Frequência de atendimento',
    icon:   Icons.BarChart2,
    origin: 'apps/web/src/app/transit/vehicle-plan/[id]/page',
  })

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
      {generateModalOpen && (
        <GenerateModal
          hasCustomMetrics={hasCustomMetrics}
          onConfirm={handleGenerate}
          onClearMetrics={handleClearMetrics}
          onClose={() => setGenerateModalOpen(false)}
        />
      )}

      {detailsOpen && (
        <SolverProposalDialog
          baseline={baselineSnapshot}
          proposal={solverProgress.bestScenario}
          proposalCount={solverProgress.proposalCount}
          onClose={() => setDetailsOpen(false)}
        />
      )}

      <div className="px-6 pt-4 pb-2 shrink-0 space-y-1">
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
                {ganttData.blocks.reduce((sum, b) => sum + b.blockTrips.length, 0)} viagens
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
                {solverProgress.bestScenario && (
                  <button
                    onClick={() => setDetailsOpen(true)}
                    className="rounded px-1 py-0.5 bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  >
                    [Detalhes]
                  </button>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* gantt + lines panel */}
      <div className="flex flex-1 min-h-0 border-t overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0">
            {plottedData ? (
              plottedData.blocks.length > 0 ? (
                <GanttBoard data={plottedData} onViewportChange={setGanttVp} />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Nenhum bloco para as linhas selecionadas
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                {ganttData
                  ? 'Selecione linhas no painel e clique em Plotar'
                  : 'Carregando…'}
              </div>
            )}
          </div>

          {freqPanelOpen && plottedData && (
            <FrequencyPanel data={plottedData} vp={ganttVp} />
          )}
        </div>

        {linesPanelOpen && (
          <LinesPanel
            planLines={ganttData?.plan?.lines ?? []}
            selectedLineIds={selectedLineIds}
            onSelectionChange={setSelectedLineIds}
            onClose={() => setLinesPanelOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
