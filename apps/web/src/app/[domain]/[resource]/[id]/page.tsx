'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Save, ArrowLeft, LayoutList, Trash2 } from 'lucide-react'
import { AutoForm } from '@/core/AutoForm'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { useMetadata } from '@/core/useMetadata'
import { useDiscovery } from '@/core/useDiscovery'
import { Forbidden } from '@/components/ui/forbidden'
import { apiFetch } from '@/lib/auth'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut, useKeywatch } from '@/lib/keywatch'
import { useToast } from '@/lib/toast-context'
import { msgs } from '@/lib/messages'

const FORM_ID = 'record-form'

export default function ResourceDetailPage() {
  const { domain, resource, id } = useParams<{ domain: string; resource: string; id: string }>()
  const router      = useRouter()
  const searchParams = useSearchParams()
  const isNew        = id === 'new'

  const [isPending,   setIsPending]   = useState(false)
  const [resetSignal, setResetSignal] = useState(0)
  const { toast } = useToast()

  const contextParams:  Record<string, string>  = {}
  const derivedDefaults: Record<string, unknown> = {}
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith('_')) derivedDefaults[key.slice(1)] = value
    else                     contextParams[key]             = value
  }

  const newRecordDefaults = isNew ? { ...contextParams, ...derivedDefaults } : undefined
  const readonlyFields    = isNew ? Object.keys(contextParams) : []
  const contextQuery      = Object.keys(contextParams).length
    ? `?${new URLSearchParams(contextParams)}`
    : ''
  const listPath = `/${domain}/${resource}${contextQuery}`

  const { data: meta, error } = useMetadata(domain, resource)
  const { data: domains }     = useDiscovery()

  if ((error as any)?.status === 403 || (meta && !meta.permissions?.read)) return <Forbidden />

  const canCreate = meta?.permissions?.create !== false
  const canUpdate = meta?.permissions?.update !== false
  const canDelete = meta?.permissions?.delete === true
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

  const visibleChildren = useMemo(
    () => meta?.children?.filter((child) => {
      if (!child.privatePermissions) return true  // herda do pai — sempre acessível
      const childDomain = child.domain ?? domain
      return domains.some((d) => d.key === childDomain && d.resources.some((r) => r.key === child.resource))
    }) ?? [],
    [meta?.children, domains, domain],
  )

  const childActions = (!isNew && record?.id)
    ? visibleChildren.map((child) => {
        const childDomain = child.domain ?? domain
        const href = `/${childDomain}/${child.resource}?${child.contextField}=${record.id}`
        return {
          label:   child.label,
          icon:    LayoutList,
          onClick: () => router.push(href),
          variant: 'ghost' as const,
          primary: false,
          ...(child.keybind ? { keybind: child.keybind.toUpperCase() } : {}),
        }
      })
    : []

  async function handleDelete() {
    if (!window.confirm(`Excluir este ${meta?.label ?? 'registro'}?`)) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/${domain}/${resource}/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      toast.success(msgs.deleted())
      router.push(listPath)
    } catch {
      toast.error(msgs.error.delete())
      setIsPending(false)
    }
  }

  useTopbarActions([
    ...childActions,
    ...(isNew ? canCreate : canUpdate) ? [{ label: isPending ? 'Gravar…' : 'Gravar', icon: Save, type: 'submit' as const, form: FORM_ID, disabled: isPending, primary: true }] : [],
    ...(!isNew && canDelete ? [{ label: 'Excluir', icon: Trash2, variant: 'destructive' as const, onClick: handleDelete, disabled: isPending }] : []),
  ], [isNew, visibleChildren, record?.id, isPending, canCreate, canUpdate, canDelete])

  const { coreRef } = useKeywatch()
  useEffect(() => {
    const core = coreRef.current
    if (!core || isNew || !visibleChildren.length || !record?.id) return
    const group = '_children_kb'
    for (const child of visibleChildren) {
      if (!child.keybind) continue
      const href = `/${child.domain ?? domain}/${child.resource}?${child.contextField}=${record.id}`
      core.bind(child.keybind, () => router.push(href), {
        desc: child.label, icon: LayoutList, group, order: 4,
      })
    }
    return () => { core.unbindGroup('_children_kb') }
  }, [isNew, visibleChildren, record?.id])

  useShortcut('alt+g', () => {
    if (isNew ? canCreate : canUpdate)
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
      toast.success(isNew ? msgs.created() : msgs.updated())
      router.push(listPath)
    } catch {
      toast.error(msgs.error.save())
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
        readOnly={!isNew && !canUpdate}
        onSubmit={handleSubmit}
        formId={FORM_ID}
        resetSignal={resetSignal}
      />
    </div>
  )
}
