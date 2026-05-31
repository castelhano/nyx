'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Icons }             from '@/lib/icons'
import { AutoBreadcrumb }    from '@/core/AutoBreadcrumb'
import { usePageGuard }      from '@/core/usePageGuard'
import { useRecordQuery }    from '@/core/useRecordQuery'
import { useTopbarActions }  from '@/components/layout/topbar-actions-context'
import { useShortcut }       from '@/lib/keywatch'
import { apiFetch }          from '@/lib/auth'
import { useToast }          from '@/lib/toast-context'
import { extractError }      from '@/lib/utils'
import { GanttBoard }        from './components/GanttBoard'
import type { VehiclePlanGanttData } from './views/vehicles.view'

// ── solver progress via SSE ───────────────────────────────────────────────────

interface SolverProgress {
  type:       'progress' | 'best' | 'done' | 'error'
  score?:     number
  iteration?: number
  message?:   string
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

    const token = document.cookie.match(/token=([^;]+)/)?.[1] ?? ''
    const url   = `/api/transit/vehicle-plan/${planId}/stream?jobId=${jobId}&token=${encodeURIComponent(token)}`
    const es    = new EventSource(url)

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as SolverProgress
        setProgress(data)
        if (data.type === 'done' || data.type === 'error') {
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

// ── page ──────────────────────────────────────────────────────────────────────

export default function VehiclePlanPage() {
  const { id }      = useParams<{ id: string }>()
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { toast }   = useToast()

  const isNew = id === 'new'

  const [isPending,   setIsPending]   = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

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

  // ── solver ──────────────────────────────────────────────────────────────────

  const onSolverDone = useCallback(async () => {
    setActiveJobId(null)
    setIsPending(false)
    await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
    await refetchGantt()
  }, [id, queryClient, refetchGantt])

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
      toast.success('Melhor solução assumida')
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
      await refetchGantt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao assumir solução')
    } finally {
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

  // ── topbar ───────────────────────────────────────────────────────────────────

  const status = record?.status as string | undefined

  useTopbarActions([
    // stop + assume visible only while solver is running
    ...(activeJobId ? [
      {
        label:   'Parar',
        icon:    Icons.Square,
        onClick: handleStop,
        disabled: isPending,
      },
      {
        label:   'Assumir Melhor',
        icon:    Icons.Download,
        onClick: handleAssumeBest,
        disabled: isPending,
      },
    ] : []),
    // generate visible when not running and can update
    ...(!activeJobId && canUpdate && status === 'DRAFT' ? [
      {
        label:   isPending ? 'Gerando…' : 'Gerar',
        icon:    Icons.Play,
        onClick: handleGenerate,
        disabled: isPending,
        primary: true,
      },
    ] : []),
    // activate only for DRAFT plans not currently solving
    ...(!activeJobId && canUpdate && status === 'DRAFT' ? [
      {
        label:   isPending ? 'Ativando…' : 'Ativar',
        icon:    Icons.CheckCircle,
        onClick: handleActivate,
        disabled: isPending,
      },
    ] : []),
  ], [isPending, activeJobId, canUpdate, status])

  // ── shortcuts ─────────────────────────────────────────────────────────────

  useShortcut('alt+v', () => router.push('/transit/vehicle-plan'), {
    desc: 'Voltar', icon: Icons.ArrowLeft,
    origin: 'apps/web/src/app/transit/vehicle-plan/[id]/page',
    context: 'all',
  })

  // ── render ─────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  const recordName = record ? String(record.status ?? '') : undefined

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-4 pb-2 shrink-0 space-y-1">
        <AutoBreadcrumb domain="transit" resource="vehicle-plan" id={id} recordName={recordName} />

        {/* summary bar */}
        {record && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              Status:{' '}
              <span className={status === 'ACTIVE' ? 'text-green-600 font-medium' : 'font-medium'}>
                {status === 'ACTIVE' ? 'Ativo' : 'Rascunho'}
              </span>
            </span>
            {ganttData?.blocks && (
              <span>{ganttData.blocks.length} blocos</span>
            )}
            {ganttData?.plan?.lines && (
              <span>{ganttData.plan.lines.length} linhas</span>
            )}
            {activeJobId && solverProgress && (
              <span className="text-blue-600 animate-pulse">
                {solverProgress.type === 'progress' && solverProgress.iteration
                  ? `Iteração ${solverProgress.iteration}`
                  : 'Calculando…'}
                {solverProgress.score != null && ` — score ${solverProgress.score.toFixed(2)}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* gantt board takes remaining height */}
      <div className="flex-1 min-h-0 border-t">
        {ganttData ? (
          <GanttBoard data={ganttData} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {isNew
              ? 'Salve o planejamento antes de visualizar o Gantt.'
              : 'Carregando…'}
          </div>
        )}
      </div>
    </div>
  )
}
