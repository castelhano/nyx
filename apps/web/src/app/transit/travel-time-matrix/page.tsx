'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

const DOMAIN   = 'transit'
const RESOURCE = 'travel-time-matrix'

export default function TravelTimeMatrixPage() {
  const router    = useRouter()
  const { toast } = useToast()
  const { guardNode, meta } = usePageGuard(DOMAIN, RESOURCE)

  const [generating, setGenerating] = useState(false)

  async function handleGenerate() {
    if (generating) return
    setGenerating(true)
    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}/generate`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const { generated, skipped } = await res.json() as { generated: number; skipped: number }
      const msg = skipped > 0
        ? `${generated} pares gerados — ${skipped} pontos ignorados (sem coordenadas)`
        : `${generated} pares gerados`
      toast.success(msg)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar matriz')
    } finally {
      setGenerating(false)
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
      label:    generating ? 'Gerando…' : 'Gerar Matriz',
      icon:     RefreshCw,
      onClick:  handleGenerate,
      disabled: generating,
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
  ], [meta?.permissions?.create, meta?.allowCsv, generating])

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
      <AutoList
        domain={DOMAIN}
        resource={RESOURCE}
        onEdit={(id) => router.push(`/${DOMAIN}/${RESOURCE}/${id}`)}
      />
    </div>
  )
}
