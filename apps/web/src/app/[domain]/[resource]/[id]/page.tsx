'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import { Save, ArrowLeft, LayoutList, Trash2 } from 'lucide-react'
import { AutoForm } from '@/core/AutoForm'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { usePageGuard } from '@/core/usePageGuard'
import { useRecordQuery } from '@/core/useRecordQuery'
import { useDiscovery } from '@/core/useDiscovery'
import { apiFetch } from '@/lib/auth'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut, useKeywatch } from '@/lib/keywatch'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { msgs } from '@/lib/messages'
import { extractError } from '@/lib/utils'

const FORM_ID = 'record-form'

export default function ResourceDetailPage() {
  const { domain, resource, id } = useParams<{ domain: string; resource: string; id: string }>()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const isNew        = id === 'new'

  const [isPending,   setIsPending]   = useState(false)
  const [resetSignal, setResetSignal] = useState(0)
  const { toast } = useToast()
  const confirm   = useConfirm()

  const contextParams:   Record<string, string>  = {}
  const derivedDefaults: Record<string, unknown> = {}
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith('_')) derivedDefaults[key.slice(1)] = value
    else                     contextParams[key]             = value
  }

  const readonlyFields = isNew ? Object.keys(contextParams) : []
  const contextQuery   = Object.keys(contextParams).length
    ? `?${new URLSearchParams(contextParams)}`
    : ''
  const listPath = `/${domain}/${resource}${contextQuery}`

  // Memoizado para referência estável — evita resets desnecessários no AutoForm (prop values)
  const newRecordDefaults = useMemo(
    () => isNew ? { ...contextParams, ...derivedDefaults } : undefined,
    [isNew, searchParams], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── Todos os hooks chamados incondicionalmente ────────────────────────────

  const { data: domains } = useDiscovery()

  const { data: record, error: recordError } = useRecordQuery(
    [domain, resource, id],
    `/${domain}/${resource}/${id}`,
    { enabled: !isNew },
  )

  const { guardNode, meta, canCreate, canUpdate, canDelete } = usePageGuard(domain, resource, isNew, recordError ?? undefined)

  const recordName = record && meta ? String(record[meta.nameField] ?? '') : undefined

  const visibleChildren = useMemo(
    () => meta?.children?.filter((child) => {
      if (!child.privatePermissions) return true
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
    const ok = await confirm({ title: `Excluir ${meta?.label ?? 'registro'}?` })
    if (!ok) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/${domain}/${resource}/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw json
      }
      toast.success(msgs.deleted())
      router.push(listPath)
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, msgs.error.delete()))
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
  }, [isNew, visibleChildren, record?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Render ────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  async function handleSubmit(data: Record<string, unknown>) {
    setIsPending(true)
    try {
      const path = isNew ? `/${domain}/${resource}` : `/${domain}/${resource}/${id}`
      const res  = await apiFetch(path, {
        method: isNew ? 'POST' : 'PATCH',
        body:   JSON.stringify(data),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const created = await res.json()
      toast.success(isNew ? msgs.created() : msgs.updated())
      if (isNew && meta?.afterCreate) {
        const redirect = meta.afterCreate.replace(/\{(\w+)\}/g, (_, key) => String(created[key] ?? ''))
        router.push(redirect)
      } else {
        router.push(listPath)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : msgs.error.save())
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
