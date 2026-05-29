'use client'

import { useRef } from 'react'
import { notFound, useRouter, useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { DomainCard } from '@/components/ui/domain-card'
import { useCardNavigation } from '@/core/useCardNavigation'
import { useShortcut } from '@/lib/keywatch'
import { useDiscovery } from '@/core/useDiscovery'

export default function DomainPage() {
  const { domain: domainKey } = useParams<{ domain: string }>()
  const router  = useRouter()
  const gridRef = useRef<HTMLDivElement>(null)
  const { data: domains } = useDiscovery()

  const config = domains.find((d) => d.key === domainKey)
  if (domains.length > 0 && !config) notFound()

  const resources = config?.resources ?? []

  const { active } = useCardNavigation(
    resources.length,
    (i) => router.push(`/${domainKey}/${resources[i].key}`),
    gridRef,
  )

  useShortcut('alt+v', () => router.push('/'), {
    desc:    'Voltar',
    icon:    ArrowLeft,
    origin:  'apps/web/src/app/[domain]/page',
  })

  if (!config) return null

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb segments={[
        { label: 'Início', href: '/' },
        { label: config.label },
      ]} />
      <h1 className="text-xl font-semibold">{config.label}</h1>
      <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {resources.map((res, i) => (
          <DomainCard
            key={res.key}
            label={res.label}
            icon={res.icon}
            href={`/${domainKey}/${res.key}`}
            active={i === active}
          />
        ))}
      </div>
    </div>
  )
}
