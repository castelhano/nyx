'use client'

import { useRouter } from 'next/navigation'
import { DomainCard } from '@/components/ui/domain-card'
import { useCardNavigation } from '@/core/useCardNavigation'
import { domains } from '@/core/domains'

const entries = Object.entries(domains)

export default function HomePage() {
  const router = useRouter()

  const { active } = useCardNavigation(
    entries.length,
    (i) => router.push(`/${entries[i][0]}`),
  )

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Início</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {entries.map(([key, config], i) => (
          <DomainCard
            key={key}
            label={config.label}
            icon={config.icon}
            href={`/${key}`}
            active={i === active}
          />
        ))}
      </div>
    </div>
  )
}
