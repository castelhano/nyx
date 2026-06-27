'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Icons } from '@/lib/icons'
import { AutoList }        from '@/core/AutoList'
import { AutoBreadcrumb }  from '@/core/AutoBreadcrumb'
import { usePageGuard }    from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }     from '@/lib/keywatch'
import { apiFetch }        from '@/lib/auth'
import { downloadCsv }     from '@/lib/csv'
import { useToast }        from '@/lib/toast-context'
import { useConfirm }      from '@/lib/confirm-context'
import { extractError }    from '@/lib/utils'
import { useJobProgress }  from '@/lib/use-job-progress'
import { JobProgressBar }  from '@/components/ui/job-progress-bar'

const DOMAIN   = 'transit'
const RESOURCE = 'travel-time-matrix'

export default function TravelTimeMatrixPage() {
  const router       = useRouter()
  const { toast }    = useToast()
  const confirm      = useConfirm()
  const queryClient  = useQueryClient()
  const { guardNode, meta } = usePageGuard(DOMAIN, RESOURCE)

  const [jobId, setJobId] = useState<string | null>(null)

  const { job, isRunning, isCompleted, isFailed } = useJobProgress(jobId, (j) => {
    if (j.status === 'COMPLETED') {
      const out       = j.output as { generated?: number; skipped?: number } | null
      const generated = out?.generated ?? 0
      const skipped   = out?.skipped   ?? 0
      toast.success(
        skipped > 0
          ? `${generated} pares gerados — ${skipped} pontos ignorados (sem coordenadas)`
          : `${generated} pares gerados`,
      )
      queryClient.invalidateQueries({ queryKey: [DOMAIN, RESOURCE] })
    } else {
      toast.error(j.error ?? 'Erro ao gerar matriz')
    }
  })

  async function handleSetSource(lock: boolean) {
    const ok = await confirm({
      title:        lock ? 'Travar todos os registros?' : 'Destravar todos os registros?',
      description:  lock
        ? 'Todos os registros com source OSRM serão alterados para MANUAL.'
        : 'Todos os registros com source MANUAL serão alterados para OSRM.',
      confirmLabel: lock ? 'Travar todos' : 'Destravar todos',
      variant:      'default',
    })
    if (!ok) return
    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}/set-source`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lock }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const { updated } = await res.json() as { updated: number }
      toast.success(`${updated} registro${updated !== 1 ? 's' : ''} ${lock ? 'travado' : 'destravado'}${updated !== 1 ? 's' : ''}`)
      queryClient.invalidateQueries({ queryKey: [DOMAIN, RESOURCE] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar source')
    }
  }

  async function handleGenerate(source: 'OSRM' | 'MANUAL' = 'OSRM') {
    if (isRunning) return
    const ok = await confirm({
      title:        'Gerar matriz de tempos?',
      description:  'Isso irá recalcular todos os pares origem-destino via OSRM.',
      confirmLabel: 'Gerar',
      variant:      'default',
    })
    if (!ok) return
    setJobId(null)
    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ source }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const { jobId: id } = await res.json() as { jobId: string }
      setJobId(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar matriz')
    }
  }

  async function handleDownloadCsv() {
    if (!meta) return
    const params = new URLSearchParams({ page: '1', pageSize: '9999' })
    const res = await apiFetch(`/${DOMAIN}/${RESOURCE}?${params}`)
    if (!res.ok) return
    const { data } = await res.json()
    downloadCsv(data, meta.fields, meta.labelPlural)
  }

  useTopbarActions([
    {
      label:    isRunning ? 'Gerando…' : 'Gerar Matriz',
      icon:     Icons.RefreshCw,
      onClick:  () => handleGenerate('OSRM'),
      disabled: isRunning,
    },
    {
      label:    'Travar todos',
      icon:     Icons.Lock,
      onClick:  () => handleSetSource(true),
      overflow: true,
    },
    {
      label:    'Destravar todos',
      icon:     Icons.LockOpen,
      onClick:  () => handleSetSource(false),
      overflow: true,
    },
    ...(meta?.permissions?.create !== false ? [{
      label:   'Novo',
      icon:    Icons.Plus,
      onClick: () => router.push(`/${DOMAIN}/${RESOURCE}/new`),
      primary: true,
    }] : []),
    ...(meta?.allowCsv ? [{
      label:   'CSV',
      icon:    Icons.Download,
      onClick: handleDownloadCsv,
      variant: 'ghost' as const,
    }] : []),
  ], [meta?.permissions?.create, meta?.allowCsv, isRunning])

  useShortcut('alt+n', () => { if (meta?.permissions?.create !== false) router.push(`/${DOMAIN}/${RESOURCE}/new`) }, {
    desc:   'Novo registro',
    icon:   Icons.Plus,
    origin: 'apps/web/src/app/transit/travel-time-matrix/page',
  })

  useShortcut('alt+v', () => router.push(`/${DOMAIN}`), {
    desc:   'Voltar',
    icon:   Icons.ArrowLeft,
    origin: 'apps/web/src/app/transit/travel-time-matrix/page',
  })

  useShortcut('alt+d', handleDownloadCsv, {
    desc:   'Baixar dados em CSV',
    icon:   Icons.Download,
    origin: 'apps/web/src/app/transit/travel-time-matrix/page',
  })

  if (guardNode) return guardNode

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain={DOMAIN} resource={RESOURCE} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? 'Matriz de Tempos'}</h1>
      {(isRunning || isCompleted || isFailed) && (
        <JobProgressBar
          job={job}
          isRunning={isRunning}
          isCompleted={isCompleted}
          isFailed={isFailed}
        />
      )}
      <AutoList
        domain={DOMAIN}
        resource={RESOURCE}
        onEdit={(id) => router.push(`/${DOMAIN}/${RESOURCE}/${id}`)}
      />
    </div>
  )
}
