'use client'

import { useState }             from 'react'
import { useRouter }            from 'next/navigation'
import { AutoList }             from '@/core/AutoList'
import { AutoBreadcrumb }       from '@/core/AutoBreadcrumb'
import { usePageGuard }         from '@/core/usePageGuard'
import { useTopbarActions }     from '@/components/layout/topbar-actions-context'
import { useShortcut }          from '@/lib/keywatch'
import { Icons }                from '@/lib/icons'
import { apiFetch }             from '@/lib/auth'
import { downloadCsv }          from '@/lib/csv'
import { ExtensionReviewModal } from './ExtensionReviewModal'
import { DemandImportModal }    from './DemandImportModal'

export default function TransitLineListPage() {
  const router              = useRouter()
  const { guardNode, meta } = usePageGuard('transit', 'transit-line')
  const [showExtModal,    setShowExtModal]    = useState(false)
  const [showDemandModal, setShowDemandModal] = useState(false)

  if (guardNode) return guardNode

  async function handleDownloadCsv() {
    if (!meta) return
    const params = new URLSearchParams({ page: '1', pageSize: '9999' })
    const res = await apiFetch(`/transit/transit-line?${params}`)
    if (!res.ok) return
    const { data } = await res.json()
    downloadCsv(data, meta.fields, meta.labelPlural)
  }

  useTopbarActions([
    ...(meta?.permissions?.create !== false ? [{
      label:   'Nova',
      icon:    Icons.Plus,
      onClick: () => router.push('/transit/transit-line/new'),
      primary: true,
    }] : []),
    {
      label:   'Revisar Demanda',
      icon:    Icons.BarChart2,
      overflow: true,
      onClick: () => setShowDemandModal(true),
      variant: 'ghost' as const,
    },
    {
      label:   'Revisar Extensões',
      icon:    Icons.SlidersHorizontal,
      overflow: true,
      onClick: () => setShowExtModal(true),
      variant: 'ghost' as const,
    },
    {
      label:   'Revisar Ciclos',
      icon:    Icons.RefreshCw,
      overflow: true,
      onClick: () => router.push('/transit/transit-line/cycle-map'),
      variant: 'ghost' as const,
    },
    ...(meta?.allowCsv ? [{ separator: true, overflow: true }] : []),
    ...(meta?.allowCsv ? [{
      label:   'CSV',
      icon:    Icons.Download,
      overflow: true,
      onClick: handleDownloadCsv,
      variant: 'ghost' as const,
    }] : []),
  ], [meta?.permissions?.create, meta?.allowCsv])

  useShortcut('alt+n', () => {
    if (meta?.permissions?.create !== false) router.push('/transit/transit-line/new')
  }, { desc: 'Nova linha', icon: Icons.Plus })

  useShortcut('alt+v', () => router.push('/transit'), { desc: 'Voltar', display: false })

  useShortcut('alt+d', handleDownloadCsv, {
    desc:   'Baixar dados em CSV',
    icon:   Icons.Download,
    origin: 'apps/web/src/app/transit/transit-line/page',
  })

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="transit" resource="transit-line" />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? 'Linhas'}</h1>
      <AutoList
        domain="transit"
        resource="transit-line"
        onEdit={(id) => router.push(`/transit/transit-line/${id}`)}
      />
      {showExtModal && (
        <ExtensionReviewModal
          onClose={() => setShowExtModal(false)}
          onApplied={() => setShowExtModal(false)}
        />
      )}
      {showDemandModal && (
        <DemandImportModal
          onClose={() => setShowDemandModal(false)}
          onApplied={() => setShowDemandModal(false)}
        />
      )}
    </div>
  )
}
