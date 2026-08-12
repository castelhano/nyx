'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import { useConfirm } from '@/lib/confirm-context'
import { useToast } from '@/lib/toast-context'
import { extractError } from '@/lib/utils'
import { useSolverStream } from './useSolverStream'
import type { SolverBaseline } from '../components/SolverProposalDialog'
import type { VehiclePlanGanttData } from '../views/vehicles.view'
import type { SolverParams } from '../components/GenerateModal'

interface UseSolverControllerParams {
  id:           string
  canUpdate:    boolean
  record:       Record<string, unknown> | undefined
  ganttData:    VehiclePlanGanttData | undefined
  refetchGantt: () => Promise<unknown>
  setIsPending: (v: boolean) => void
}

export function useSolverController({ id, canUpdate, record, ganttData, refetchGantt, setIsPending }: UseSolverControllerParams) {
  const router       = useRouter()
  const queryClient   = useQueryClient()
  const { toast }     = useToast()
  const confirm       = useConfirm()

  const [activeJobId,       setActiveJobId]       = useState<string | null>(null)
  const [isSolverDone,      setIsSolverDone]      = useState(false)
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [detailsOpen,       setDetailsOpen]       = useState(false)
  const [baselineSnapshot,  setBaselineSnapshot]  = useState<SolverBaseline | null>(null)

  const onSolverDone = useCallback(() => {
    setIsSolverDone(true)
    setIsPending(false)
  }, [setIsPending])

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
        deadrunKm:    ganttData.blocks.reduce((sum, b) => sum + (b.summary?.deadrunKm ?? 0), 0),
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
      setDetailsOpen(false)
      toast.success('Melhor solução assumida')
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
      await refetchGantt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao assumir solução')
    } finally {
      setIsPending(false)
    }
  }

  async function handleDiscard() {
    if (!activeJobId) return
    try {
      await apiFetch(`/transit/vehicle-plan/${id}/stop`, {
        method: 'POST',
        body:   JSON.stringify({ jobId: activeJobId }),
      })
    } catch { /* ignore */ }
    setActiveJobId(null)
    setIsSolverDone(false)
    setDetailsOpen(false)
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

  async function handleActivate(force: boolean = false) {
    // Passed directly as a topbar button's onClick (page.tsx), which may invoke it
    // with a click event as the first arg instead of a boolean — guard against that.
    if (typeof force !== 'boolean') force = false
    if (!canUpdate) return
    setIsPending(true)
    try {
      const res  = await apiFetch(`/transit/vehicle-plan/${id}/activate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ force }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }

      const json = await res.json().catch(() => null)

      if (json?.conflict) {
        const label = json.conflict.description || json.conflict.id || 'outro planejamento'
        const ok = await confirm({
          title:        'Substituir planejamento ativo',
          description:  `"${label}" está ativo e será desativado. Deseja continuar?`,
          confirmLabel: 'Continuar',
          variant:      'safeConfirm',
        })
        if (ok) await handleActivate(true)
        return
      }

      toast.success('Planejamento ativado')
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ativar')
    } finally {
      setIsPending(false)
    }
  }

  return {
    activeJobId,
    isSolverDone,
    generateModalOpen, setGenerateModalOpen,
    detailsOpen, setDetailsOpen,
    baselineSnapshot,
    solverProgress,
    handleGenerate, handleClearMetrics, handleStop, handleAssumeBest, handleDiscard, handleDelete, handleActivate,
  }
}
