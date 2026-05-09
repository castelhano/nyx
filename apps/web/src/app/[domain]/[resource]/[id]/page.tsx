'use client'

import { useRouter } from 'next/navigation'
import { AutoForm } from '@/core/AutoForm'
import { useMetadata } from '@/core/useMetadata'
import { apiFetch } from '@/lib/auth'

export default function ResourceDetailPage({ params }: { params: { domain: string; resource: string; id: string } }) {
  const { domain, resource, id } = params
  const router = useRouter()
  const isNew = id === 'new'
  const { data: meta } = useMetadata(domain, resource)

  async function handleSubmit(data: Record<string, unknown>) {
    const path = isNew ? `/${domain}/${resource}s` : `/${domain}/${resource}s/${id}`
    await apiFetch(path, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    router.push(`/${domain}/${resource}`)
  }

  const title = meta?.label ?? resource

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-semibold mb-4">{isNew ? `New ${title}` : `Edit ${title}`}</h1>
      <AutoForm domain={domain} resource={resource} onSubmit={handleSubmit} />
    </div>
  )
}
