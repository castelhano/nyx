'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowLeft, Download, RefreshCw } from 'lucide-react'
import { AutoList }        from '@/core/AutoList'
import { AutoBreadcrumb }  from '@/core/AutoBreadcrumb'
import { usePageGuard }    from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }     from '@/lib/keywatch'
import { apiFetch }        from '@/lib/auth'
import { downloadCsv }     from '@/lib/csv'
import { useToast }        from '@/lib/toast-context'
import { extractError }    from '@/lib/utils'
import { useJobProgress }  from '@/lib/use-job-progress'
import { JobProgressBar }  from '@/components/ui/job-progress-bar'

const DOMAIN   = 'transit'
const RESOURCE = 'travel-time-matrix'

export default function TravelTimeMatrixPage() {
  const router       = useRouter()
  const { toast }    = useToast()
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

  async function handleGenerate() {
    if (isRunning) return
    setJobId(null)
    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}/generate`, { method: 'POST' })
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
      icon:     RefreshCw,
      onClick:  handleGenerate,
      disabled: isRunning,
    },
    ...(meta?.permissions?.create !== false ? [{
      label:   'Novo',
      icon:    Plus,
      onClick: () => router.push(`/${DOMAIN}/${RESOURCE}/new`),
      primary: true,
    }] : []),
    ...(meta?.allowCsv ? [{
      label:   'CSV',
      icon:    Download,
      onClick: handleDownloadCsv,
      variant: 'ghost' as const,
    }] : []),
  ], [meta?.permissions?.create, meta?.allowCsv, isRunning])

  useShortcut('alt+n', () => { if (meta?.permissions?.create !== false) router.push(`/${DOMAIN}/${RESOURCE}/new`) }, {
    desc:   'Novo registro',
    icon:   Plus,
    origin: 'apps/web/src/app/transit/travel-time-matrix/page',
  })

  useShortcut('alt+v', () => router.push(`/${DOMAIN}`), {
    desc:   'Voltar',
    icon:   ArrowLeft,
    origin: 'apps/web/src/app/transit/travel-time-matrix/page',
  })

  useShortcut('alt+d', handleDownloadCsv, {
    desc:   'Baixar dados em CSV',
    icon:   Download,
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
