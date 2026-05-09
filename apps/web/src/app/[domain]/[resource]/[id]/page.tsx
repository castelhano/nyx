'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { AutoForm } from '@/core/AutoForm'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { useMetadata } from '@/core/useMetadata'
import { apiFetch } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'

const FORM_ID = 'record-form'

export default function ResourceDetailPage({ params }: { params: { domain: string; resource: string; id: string } }) {
  const { domain, resource, id } = params
  const router  = useRouter()
  const isNew   = id === 'new'
  const [isPending, setIsPending] = useState(false)

  const { data: meta }   = useMetadata(domain, resource)
  const { data: record } = useQuery<Record<string, unknown>>({
    queryKey: [domain, resource, id],
    queryFn:  async () => {
      const res = await apiFetch(`/${domain}/${resource}s/${id}`)
      if (!res.ok) throw new Error('Failed to fetch record')
      return res.json()
    },
    enabled: !isNew,
  })

  const recordName = record && meta ? String(record[meta.nameField] ?? '') : undefined

  useTopbarActions(
    <Button type="submit" form={FORM_ID} size="sm" disabled={isPending}>
      <Save className="w-3.5 h-3.5" />
      {isPending ? 'Salvando…' : 'Salvar'}
    </Button>,
    [isPending],
  )

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar registro', context: 'all' })

  async function handleSubmit(data: Record<string, unknown>) {
    setIsPending(true)
    try {
      const path = isNew ? `/${domain}/${resource}s` : `/${domain}/${resource}s/${id}`
      const res  = await apiFetch(path, {
        method:  isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to save')
      router.push(`/${domain}/${resource}`)
    } catch {
      setIsPending(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain={domain} resource={resource} id={id} recordName={recordName} />
      <AutoForm domain={domain} resource={resource} defaultValues={record} onSubmit={handleSubmit} formId={FORM_ID} />
    </div>
  )
}
