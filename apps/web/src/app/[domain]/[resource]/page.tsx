'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, ArrowLeft, Download } from 'lucide-react'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { useMetadata } from '@/core/useMetadata'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/auth'
import { downloadCsv } from '@/lib/csv'

export default function ResourceListPage({ params }: { params: { domain: string; resource: string } }) {
  const { domain, resource } = params
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { data: meta } = useMetadata(domain, resource)

  const filters: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (!key.startsWith('_')) filters[key] = value
  }

  const contextQuery = Object.keys(filters).length
    ? `?${new URLSearchParams(filters)}`
    : ''

  const newPath = `/${domain}/${resource}/new${contextQuery}`

  // Sobe para o pai declarado no breadcrumb quando há contexto; senão vai para o domain
  const bc       = meta?.breadcrumb?.[meta.breadcrumb.length - 1]
  const parentId = bc ? filters[bc.contextField] : undefined
  const backPath = bc && parentId
    ? `/${bc.domain ?? domain}/${bc.resource}/${parentId}`
    : `/${domain}`

  async function handleDownloadCsv() {
    if (!meta) return
    const params = new URLSearchParams({ page: '1', pageSize: '9999' })
    const res = await apiFetch(`/${domain}/${resource}?${params}`)
    if (!res.ok) return
    const { data } = await res.json()
    downloadCsv(data, meta.fields, meta.labelPlural)
  }

  useTopbarActions(
    <div className="flex items-center gap-2">
      <Button onClick={() => router.push(newPath)} size="sm">
        <Plus className="w-3.5 h-3.5" />
        Novo
      </Button>
      {meta?.allowCsv && (
        <Button variant="ghost" size="sm" onClick={handleDownloadCsv}>
          <Download className="w-3.5 h-3.5" />
          CSV
        </Button>
      )}
    </div>,
    [meta?.allowCsv],
  )

  useShortcut('alt+n', () => router.push(newPath), {
    desc:   'Novo registro',
    icon:   Plus,
    origin: 'apps/web/src/app/[domain]/[resource]/page',
  })

  useShortcut('alt+v', () => router.push(backPath), {
    desc:   'Voltar',
    icon:   ArrowLeft,
    origin: 'apps/web/src/app/[domain]/[resource]/page',
  })

  useShortcut('alt+d', () => handleDownloadCsv(), {
    desc:   'Baixar dados em CSV',
    icon:   Download,
    origin: 'apps/web/src/app/[domain]/[resource]/page',
  })

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain={domain} resource={resource} contextParams={filters} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? resource}</h1>
      <AutoList
        domain={domain}
        resource={resource}
        filters={Object.keys(filters).length ? filters : undefined}
        onEdit={(id) => router.push(`/${domain}/${resource}/${id}${contextQuery}`)}
      />
    </div>
  )
}
