'use client'

import { notFound, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { DomainCard } from '@/components/ui/domain-card'
import { useCardNavigation } from '@/core/useCardNavigation'
import { useShortcut } from '@/lib/keywatch'
import { domains } from '@/core/domains'

export default function DomainPage({ params }: { params: { domain: string } }) {
  const { domain } = params
  const router = useRouter()
  const config = domains[domain]

  if (!config) notFound()

  const resources = config.resources

  const { active } = useCardNavigation(
    resources.length,
    (i) => router.push(`/${domain}/${resources[i].key}`),
  )

  useShortcut('alt+v', () => router.push('/'), {
    desc:    'Voltar',
    icon:    ArrowLeft,
    origin:  'apps/web/src/app/[domain]/page',
  })

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb segments={[
        { label: 'Início', href: '/' },
        { label: config.label },
      ]} />
      <h1 className="text-xl font-semibold">{config.label}</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {resources.map((res, i) => (
          <DomainCard
            key={res.key}
            label={res.label}
            icon={res.icon}
            href={`/${domain}/${res.key}`}
            active={i === active}
          />
        ))}
      </div>
    </div>
  )
}
