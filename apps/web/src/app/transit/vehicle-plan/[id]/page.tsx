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
import { GanttBoard }        from './components/GanttBoard'
import { LinesPanel }        from './components/LinesPanel'
import { FrequencyPanel }    from './components/FrequencyPanel'
import { Button } from '@/components/ui/button'
import type { VehiclePlanGanttData } from './views/vehicles.view'
import type { ViewportSnapshot }     from './engine/gantt.types'

const INITIAL_VP: ViewportSnapshot = { scrollX: 0, scrollY: 0, pixelsPerMinute: 1.2, width: 0, dayStartMinute: 0 }

// ── solver progress via SSE ───────────────────────────────────────────────────

interface SolverProgress {
  type:        'progress' | 'improvement' | 'done'
  attempt?:    number
  bestScore?:  number
  bestFleet?:  number
  deadrunKm?:  number
  elapsed?:    number
  stopReason?: string
}

function useSolverStream(planId: string, jobId: string | null, onDone: () => void) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const [progress, setProgress] = useState<SolverProgress | null>(null)

  useEffect(() => {
    if (!jobId) {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      setProgress(null)
      return
    }

    const token = getToken()
    const url   = `/api/transit/vehicle-plan/${planId}/stream?jobId=${jobId}&token=${encodeURIComponent(token)}`
    const es    = new EventSource(url)

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as SolverProgress
        if (data.type === 'progress') setProgress(data)
        if (data.type === 'done') {
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

  return progress
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
    <span
      onDoubleClick={startEdit}
      title={disabled ? undefined : 'Duplo clique para editar'}
      className={disabled ? undefined : 'cursor-text'}
    >
      {value
        ? <span className="text-foreground tracking-wide uppercase">{value}</span>
        : <span className="italic text-muted-foreground/60">Descrição</span>
      }
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

  const [isPending,       setIsPending]       = useState(false)
  const [activeJobId,     setActiveJobId]     = useState<string | null>(null)
  const [isSolverDone,    setIsSolverDone]    = useState(false)
  const [linesPanelOpen,  setLinesPanelOpen]  = useState(false)
  const [freqPanelOpen,   setFreqPanelOpen]   = useState(false)
  const [ganttVp,         setGanttVp]         = useState<ViewportSnapshot>(INITIAL_VP)

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

  async function handleGenerate() {
    if (!canUpdate) return
    setIsPending(true)
    const jobId = crypto.randomUUID()
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/generate`, {
        method: 'POST',
        body:   JSON.stringify({ jobId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      setActiveJobId(jobId)
      setIsSolverDone(false)
      setIsPending(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao iniciar geração')
      setIsPending(false)
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
  }

  // ── topbar ───────────────────────────────────────────────────────────────────

  const status    = record?.status as string | undefined
  const planLines = ganttData?.plan?.lines ?? []

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
    // generate
    ...(!activeJobId && canUpdate && status === 'DRAFT' ? [
      {
        label:    isPending ? 'Gerando…' : 'Gerar',
        icon:     Icons.Play,
        onClick:  handleGenerate,
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
              <span className="text-blue-600 animate-pulse">
                {solverProgress?.attempt != null
                  ? `Tentativa ${solverProgress.attempt}`
                  : 'Calculando…'}
                {solverProgress?.bestFleet != null && ` — ${solverProgress.bestFleet} blocos`}
                {solverProgress?.bestScore != null && `, score ${solverProgress.bestScore.toFixed(1)}`}
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

          {freqPanelOpen && ganttData && (
            <FrequencyPanel data={ganttData} vp={ganttVp} />
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
