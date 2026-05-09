'use client'

import { useRouter } from 'next/navigation'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { useMetadata } from '@/core/useMetadata'
import { useShortcut } from '@/lib/keywatch'
import { ArrowLeft } from 'lucide-react'

export default function ResourceListPage({ params }: { params: { domain: string; resource: string } }) {
  const { domain, resource } = params
  const router = useRouter()
  const { data: meta } = useMetadata(domain, resource)

  useShortcut('alt+v', () => router.push('/'), {
    desc:    'Voltar',
    icon:    ArrowLeft,
    origin:  'apps/web/src/app/[domain]/[resource]/page',
    context: 'all',
  })

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain={domain} resource={resource} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? resource}</h1>
      <AutoList
        domain={domain}
        resource={resource}
        onEdit={(id) => router.push(`/${domain}/${resource}/${id}`)}
        onNew={() => router.push(`/${domain}/${resource}/new`)}
      />
    </div>
  )
}
