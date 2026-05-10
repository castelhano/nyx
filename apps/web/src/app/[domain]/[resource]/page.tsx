'use client'

import { useRouter } from 'next/navigation'
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
  const router  = useRouter()
  const { data: meta } = useMetadata(domain, resource)

  const newPath = `/${domain}/${resource}/new`

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

  useShortcut('alt+v', () => router.push(`/${domain}`), {
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
      <AutoBreadcrumb domain={domain} resource={resource} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? resource}</h1>
      <AutoList
        domain={domain}
        resource={resource}
        onEdit={(id) => router.push(`/${domain}/${resource}/${id}`)}
      />
    </div>
  )
}
