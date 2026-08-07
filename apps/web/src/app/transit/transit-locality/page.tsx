'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Icons } from '@/lib/icons'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { usePageGuard } from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { downloadCsv } from '@/lib/csv'
import { SnapSyncModal } from './SnapSyncModal'

const DOMAIN   = 'transit'
const RESOURCE = 'transit-locality'

export default function TransitLocalityPage() {
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { guardNode, meta } = usePageGuard(DOMAIN, RESOURCE)

  const [snapOpen, setSnapOpen] = useState(false)

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
      label:   'Sync Snap',
      icon:    Icons.MapPin,
      onClick: () => setSnapOpen(true),
      variant: 'ghost' as const,
    },
    ...(meta?.permissions?.create !== false ? [{
      label:   'Nova',
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
  ], [meta?.permissions?.create, meta?.allowCsv])

  useShortcut('alt+n', () => {
    if (meta?.permissions?.create !== false) router.push(`/${DOMAIN}/${RESOURCE}/new`)
  }, { desc: 'Nova localidade', icon: Icons.Plus })

  useShortcut('alt+v', () => router.push(`/${DOMAIN}`), { desc: 'Voltar', display: false })

  useShortcut('alt+d', handleDownloadCsv, {
    desc:   'Baixar dados em CSV',
    icon:   Icons.Download,
    origin: 'apps/web/src/app/transit/transit-locality/page',
  })

  if (guardNode) return guardNode

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain={DOMAIN} resource={RESOURCE} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? 'Localidades'}</h1>
      <AutoList
        domain={DOMAIN}
        resource={RESOURCE}
        onEdit={(id) => router.push(`/${DOMAIN}/${RESOURCE}/${id}`)}
      />
      {snapOpen && (
        <SnapSyncModal
          onClose={() => setSnapOpen(false)}
          onApplied={() => queryClient.invalidateQueries({ queryKey: [DOMAIN, RESOURCE] })}
        />
      )}
    </div>
  )
}
