'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Save, ArrowLeft } from 'lucide-react'
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
  const router      = useRouter()
  const searchParams = useSearchParams()
  const isNew        = id === 'new'

  const [isPending,    setIsPending]    = useState(false)
  const [resetSignal,  setResetSignal]  = useState(0)

  // Separa params de contexto (pré-preenchimento readonly) dos defaults derivados (_campo)
  const contextParams:  Record<string, string>  = {}
  const derivedDefaults: Record<string, unknown> = {}
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith('_')) derivedDefaults[key.slice(1)] = value
    else                     contextParams[key]             = value
  }

  const newRecordDefaults = isNew
    ? { ...contextParams, ...derivedDefaults }
    : undefined

  const readonlyFields  = isNew ? Object.keys(contextParams) : []
  const contextQuery    = Object.keys(contextParams).length
    ? `?${new URLSearchParams(contextParams)}`
    : ''
  const listPath = `/${domain}/${resource}${contextQuery}`

  const { data: meta }   = useMetadata(domain, resource)
  const { data: record } = useQuery<Record<string, unknown>>({
    queryKey: [domain, resource, id],
    queryFn:  async () => {
      const res = await apiFetch(`/${domain}/${resource}/${id}`)
      if (!res.ok) throw new Error('Failed to fetch record')
      return res.json()
    },
    enabled: !isNew,
  })

  const recordName = record && meta ? String(record[meta.nameField] ?? '') : undefined

  useTopbarActions(
    <div className="flex items-center gap-2">
      {!isNew && meta?.children?.map((child) => {
        const childDomain = child.domain ?? domain
        const href = `/${childDomain}/${child.resource}?${child.contextField}=${record?.id}`
        return (
          <Button key={child.resource} variant="ghost" size="sm" onClick={() => router.push(href)}>
            {child.label}
          </Button>
        )
      })}
      <Button type="submit" form={FORM_ID} size="sm" disabled={isPending}>
        <Save className="w-3.5 h-3.5" />
        {isPending ? 'Gravar…' : 'Gravar'}
      </Button>
    </div>,
    [isNew, meta?.children, record?.id, isPending],
  )

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar registro', icon: Save, origin: 'apps/web/src/app/[domain]/[resource]/[id]/page', context: 'all' })

  useShortcut('alt+l', () => setResetSignal((s) => s + 1), {
    display: false,
    origin:  'apps/web/src/app/[domain]/[resource]/[id]/page',
  })

  useShortcut('alt+v', () => router.push(listPath), {
    desc: 'Voltar', icon: ArrowLeft,
    origin: 'apps/web/src/app/[domain]/[resource]/[id]/page', context: 'all',
  })

  async function handleSubmit(data: Record<string, unknown>) {
    setIsPending(true)
    try {
      const path = isNew ? `/${domain}/${resource}` : `/${domain}/${resource}/${id}`
      const res  = await apiFetch(path, {
        method:  isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to save')
      router.push(listPath)
    } catch {
      setIsPending(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb
        domain={domain}
        resource={resource}
        id={id}
        recordName={recordName}
        contextParams={contextParams}
      />
      <AutoForm
        domain={domain}
        resource={resource}
        defaultValues={isNew ? newRecordDefaults : record}
        readonlyFields={readonlyFields}
        onSubmit={handleSubmit}
        formId={FORM_ID}
        resetSignal={resetSignal}
      />
    </div>
  )
}
