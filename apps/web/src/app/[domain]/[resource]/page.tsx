'use client'

import { useRouter } from 'next/navigation'
import { AutoList } from '@/core/AutoList'
import { useMetadata } from '@/core/useMetadata'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default function ResourceListPage({ params }: { params: { domain: string; resource: string } }) {
  const { domain, resource } = params
  const router = useRouter()
  const { data: meta } = useMetadata(domain, resource)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">{meta?.labelPlural ?? resource}</h1>
        <Button onClick={() => router.push(`/${domain}/${resource}/new`)} size="icon">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <AutoList
        domain={domain}
        resource={resource}
        onEdit={(id) => router.push(`/${domain}/${resource}/${id}`)}
      />
    </div>
  )
}
