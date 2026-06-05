'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Upload, ArrowLeft } from 'lucide-react'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { SyncModal } from '@/core/SyncModal'
import { usePageGuard } from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'

export default function VehiclePlanListPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [importOpen, setImportOpen] = useState(false)

  const { guardNode, meta } = usePageGuard('transit', 'vehicle-plan')
  if (guardNode) return guardNode

  const filters: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (!key.startsWith('_')) filters[key] = value
  }

  useTopbarActions([
    ...(meta?.permissions?.create !== false
      ? [{ label: 'Novo', icon: Plus, onClick: () => router.push('/transit/vehicle-plan/new'), primary: true }]
      : []),
    ...(meta?.permissions?.create !== false
      ? [{ label: 'Importar', icon: Upload, onClick: () => setImportOpen(true), variant: 'ghost' as const }]
      : []),
  ], [meta?.permissions?.create])

  useShortcut('alt+v', () => router.push('/transit'), {
    desc:   'Voltar',
    icon:   ArrowLeft,
    origin: 'app/transit/vehicle-plan/page',
  })

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="transit" resource="vehicle-plan" contextParams={filters} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? 'Planos de Veículos'}</h1>
      <AutoList
        domain="transit"
        resource="vehicle-plan"
        filters={Object.keys(filters).length ? filters : undefined}
        onEdit={(id) => router.push(`/transit/vehicle-plan/${id}`)}
      />
      {importOpen && (
        <SyncModal
          domain="transit"
          resource="vehicle-plan"
          label="Programação de Veículos"
          submitLabel="Importar"
          outputLabels={{ created: 'Blocos', updated: 'Viagens', deactivated: 'Linhas' }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  )
}
