'use client'

import { useRouter }        from 'next/navigation'
import { AutoList }         from '@/core/AutoList'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { usePageGuard }     from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { Icons }            from '@/lib/icons'

export default function TransitLineListPage() {
  const router              = useRouter()
  const { guardNode, meta } = usePageGuard('transit', 'transit-line')

  if (guardNode) return guardNode

  useTopbarActions([
    ...(meta?.permissions?.create !== false ? [{
      label:   'Nova',
      icon:    Icons.Plus,
      onClick: () => router.push('/transit/transit-line/new'),
      primary: true,
    }] : []),
    {
      label:   'Atualizar Ciclos',
      icon:    Icons.RefreshCw,
      onClick: () => router.push('/transit/transit-line/cycle-map'),
      variant: 'ghost' as const,
    },
  ], [meta?.permissions?.create])

  useShortcut('alt+n', () => {
    if (meta?.permissions?.create !== false) router.push('/transit/transit-line/new')
  }, { desc: 'Nova linha', icon: Icons.Plus })

  useShortcut('alt+v', () => router.push('/transit'), { desc: 'Voltar', display: false })

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="transit" resource="transit-line" />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? 'Linhas'}</h1>
      <AutoList
        domain="transit"
        resource="transit-line"
        onEdit={(id) => router.push(`/transit/transit-line/${id}`)}
      />
    </div>
  )
}
