'use client'

import { useRouter } from 'next/navigation'
import { DomainCard } from '@/components/ui/domain-card'
import { useCardNavigation } from '@/core/useCardNavigation'
import { useDiscovery } from '@/core/useDiscovery'

export default function HomePage() {
  const router  = useRouter()
  const { data: domains } = useDiscovery()

  const { active } = useCardNavigation(
    domains.length,
    (i) => router.push(`/${domains[i].key}`),
  )

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Início</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {domains.map((domain, i) => (
          <DomainCard
            key={domain.key}
            label={domain.label}
            icon={domain.icon}
            href={`/${domain.key}`}
            active={i === active}
          />
        ))}
      </div>
    </div>
  )
}
