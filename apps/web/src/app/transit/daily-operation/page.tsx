'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Icons } from '@/lib/icons'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { usePageGuard } from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'

const ORIGIN = 'app/transit/daily-operation/page'

// The generic list plus "Gerar escala" (the real roster generator)
export default function DailyOperationListPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { guardNode, meta } = usePageGuard('transit', 'daily-operation')

  const filters: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (!key.startsWith('_')) filters[key] = value
  }
  const canCreate = meta?.permissions?.create !== false

  useTopbarActions([
    ...(canCreate ? [{ label: 'Novo', icon: Icons.Plus, onClick: () => router.push('/transit/daily-operation/new'), primary: true }] : []),
    ...(canCreate ? [{ label: 'Gerar escala', icon: Icons.Sparkles, onClick: () => router.push('/transit/daily-operation/generate'), variant: 'ghost' as const }] : []),
  ], [canCreate])

  useShortcut('alt+n', () => { if (canCreate) router.push('/transit/daily-operation/new') }, { desc: 'Novo', icon: Icons.Plus, origin: ORIGIN })
  useShortcut('alt+v', () => router.push('/transit'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN })

  if (guardNode) return guardNode

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="transit" resource="daily-operation" contextParams={filters} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? 'Escalas Diárias'}</h1>
      <AutoList
        domain="transit"
        resource="daily-operation"
        filters={Object.keys(filters).length ? filters : undefined}
        onEdit={(id) => router.push(`/transit/daily-operation/${id}`)}
      />
    </div>
  )
}
