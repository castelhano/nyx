'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Upload } from 'lucide-react'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { SyncModal } from '@/core/SyncModal'
import { usePageGuard } from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'

export default function EmployeeListPage() {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const [syncOpen, setSyncOpen] = useState(false)

  const { guardNode, meta } = usePageGuard('hr', 'employee')
  if (guardNode) return guardNode

  const filters: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (!key.startsWith('_')) filters[key] = value
  }

  useTopbarActions([
    ...(meta?.permissions?.create !== false ? [{ label: 'Novo', icon: Plus, onClick: () => router.push('/hr/employee/new'), primary: true }] : []),
    ...(meta?.permissions?.create !== false ? [{ label: 'Sincronizar', icon: Upload, onClick: () => setSyncOpen(true), variant: 'ghost' as const }] : []),
  ], [meta?.permissions?.create])

  useShortcut('alt+n', () => { if (meta?.permissions?.create !== false) router.push('/hr/employee/new') }, {
    desc:   'Novo funcionário',
    icon:   Plus,
    origin: 'app/hr/employee/page',
  })

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="hr" resource="employee" contextParams={filters} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? 'Funcionários'}</h1>
      <AutoList
        domain="hr"
        resource="employee"
        filters={Object.keys(filters).length ? filters : undefined}
        onEdit={(id) => router.push(`/hr/employee/${id}`)}
      />
      {syncOpen && (
        <SyncModal
          domain="hr"
          resource="employee"
          label={meta?.labelPlural ?? 'Funcionários'}
          onClose={() => setSyncOpen(false)}
        />
      )}
    </div>
  )
}
