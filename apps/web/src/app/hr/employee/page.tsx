'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { SyncModal } from '@/core/SyncModal'
import { usePageGuard } from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { downloadCsv } from '@/lib/csv'

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

  const bc       = meta?.breadcrumb?.[meta.breadcrumb.length - 1]
  const parentId = bc ? filters[bc.contextField] : undefined
  const backPath = bc && parentId ? `/${bc.domain ?? 'hr'}/${bc.resource}/${parentId}` : '/hr'

  async function handleDownloadCsv() {
    if (!meta) return
    const params = new URLSearchParams({ page: '1', pageSize: '9999' })
    if (Object.keys(filters).length) {
      for (const [k, v] of Object.entries(filters)) params.set(k, v)
    }
    const res = await apiFetch(`/hr/employee?${params}`)
    if (!res.ok) return
    const { data } = await res.json()
    downloadCsv(data, meta.fields, meta.labelPlural)
  }

  useTopbarActions([
    ...(meta?.permissions?.create !== false ? [{ label: 'Novo', icon: Icons.Plus, onClick: () => router.push('/hr/employee/new'), primary: true }] : []),
    ...(meta?.permissions?.create !== false ? [{ label: 'Sincronizar', icon: Icons.Upload, onClick: () => setSyncOpen(true), variant: 'ghost' as const }] : []),
    ...(meta?.allowCsv ? [{ label: 'CSV', icon: Icons.Download, onClick: handleDownloadCsv, variant: 'ghost' as const }] : []),
  ], [meta?.permissions?.create, meta?.allowCsv])

  useShortcut('alt+v', () => router.push(backPath), {
    desc:   'Voltar',
    icon:   Icons.ArrowLeft,
    origin: 'app/hr/employee/page',
  })

  useShortcut('alt+n', () => { if (meta?.permissions?.create !== false) router.push('/hr/employee/new') }, {
    desc:   'Novo funcionário',
    icon:   Icons.Plus,
    origin: 'app/hr/employee/page',
  })

  useShortcut('alt+d', handleDownloadCsv, {
    desc:   'Baixar dados em CSV',
    icon:   Icons.Download,
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
