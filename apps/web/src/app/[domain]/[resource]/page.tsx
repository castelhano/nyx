'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, ArrowLeft, Download } from 'lucide-react'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { SettingsPanel } from '@/core/SettingsPanel'
import { Forbidden } from '@/components/ui/forbidden'
import { useMetadata } from '@/core/useMetadata'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { downloadCsv } from '@/lib/csv'
import type { ResourceMetadata } from '@nyx/types'

// Renderiza a lista padrão de um recurso. Componente separado para isolar hooks
// e permitir que [resource]/page.tsx delegue para SettingsPanel sem conflito.
function ResourceListContent({ domain, resource, meta, filters, contextQuery }: {
  domain:       string
  resource:     string
  meta:         ResourceMetadata | undefined
  filters:      Record<string, string>
  contextQuery: string
}) {
  const router  = useRouter()
  const newPath = `/${domain}/${resource}/new${contextQuery}`

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

  useTopbarActions([
    ...(meta?.permissions?.create !== false ? [{ label: 'Novo', icon: Plus, onClick: () => router.push(newPath), primary: true }] : []),
    ...(meta?.allowCsv ? [{ label: 'CSV', icon: Download, onClick: handleDownloadCsv, variant: 'ghost' as const, primary: false }] : []),
  ], [meta?.allowCsv, meta?.permissions?.create, newPath])

  useShortcut('alt+n', () => { if (meta?.permissions?.create !== false) router.push(newPath) }, {
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

// Ponto de entrada. Só chama useMetadata aqui — os demais hooks ficam nos
// componentes filhos para evitar conflito de topbar entre lista e singleton.
export default function ResourceListPage({ params }: { params: { domain: string; resource: string } }) {
  const { domain, resource } = params
  const searchParams = useSearchParams()
  const { data: meta, error } = useMetadata(domain, resource)

  if ((error as any)?.status === 403 || (meta && !meta.permissions?.read)) return <Forbidden />

  const filters: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (!key.startsWith('_')) filters[key] = value
  }
  const contextQuery = Object.keys(filters).length
    ? `?${new URLSearchParams(filters)}`
    : ''

  if (meta?.isSingleton) {
    return <SettingsPanel domain={domain} resource={resource} />
  }

  return (
    <ResourceListContent
      domain={domain}
      resource={resource}
      meta={meta}
      filters={filters}
      contextQuery={contextQuery}
    />
  )
}
