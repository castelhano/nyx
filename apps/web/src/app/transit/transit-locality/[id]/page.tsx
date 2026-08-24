'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import { Save, ArrowLeft, LayoutList, Trash2 } from 'lucide-react'
import { AutoForm }           from '@/core/AutoForm'
import { AutoBreadcrumb }     from '@/core/AutoBreadcrumb'
import { usePageGuard }       from '@/core/usePageGuard'
import { useRecordQuery }     from '@/core/useRecordQuery'
import { useDiscovery }       from '@/core/useDiscovery'
import { apiFetch }           from '@/lib/auth'
import { useTopbarActions }   from '@/components/layout/topbar-actions-context'
import { useShortcut, useKeywatch } from '@/lib/keywatch'
import { useToast }           from '@/lib/toast-context'
import { useConfirm }         from '@/lib/confirm-context'
import { msgs }               from '@/lib/messages'
import { extractError }       from '@/lib/utils'
import { resolveIcon }        from '@/lib/icons'

const DOMAIN   = 'transit'
const RESOURCE = 'transit-locality'
const FORM_ID  = 'transit-locality-form'

const RouteIcon = resolveIcon('Route')

interface LocalityRoute {
  route: {
    id:        string
    name:      string
    direction: string
    line:      { id: string; code: string; name: string }
  }
}

export default function TransitLocalityDetailPage() {
  const { id }       = useParams<{ id: string }>()
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
  const listPath = `/${DOMAIN}/${RESOURCE}${contextQuery}`

  const newRecordDefaults = useMemo(
    () => isNew ? { ...contextParams, ...derivedDefaults } : undefined,
    [isNew, searchParams], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const { data: domains } = useDiscovery()

  const { data: record, error: recordError } = useRecordQuery(
    [DOMAIN, RESOURCE, id],
    `/${DOMAIN}/${RESOURCE}/${id}`,
    { enabled: !isNew },
  )

  const { data: localityRoutes } = useRecordQuery<LocalityRoute[]>(
    [DOMAIN, RESOURCE, id, 'routes'],
    `/${DOMAIN}/${RESOURCE}/${id}/routes`,
    { enabled: !isNew },
  )

  const lines = useMemo(() => {
    const byLine = new Map<string, { id: string; code: string; name: string }>()
    for (const { route } of localityRoutes ?? []) byLine.set(route.line.id, route.line)
    return [...byLine.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [localityRoutes])

  const { guardNode, meta, canCreate, canUpdate, canDelete } = usePageGuard(DOMAIN, RESOURCE, isNew, recordError ?? undefined)

  const recordName = record && meta ? String(record[meta.nameField] ?? '') : undefined

  const effectiveListPath = useMemo(() => {
    if (contextQuery || !meta?.breadcrumb?.length || !record) return listPath
    const params = new URLSearchParams()
    for (const bc of meta.breadcrumb) {
      const val = record[bc.contextField]
      if (val) params.set(bc.contextField, String(val))
    }
    return params.size ? `/${DOMAIN}/${RESOURCE}?${params}` : listPath
  }, [contextQuery, listPath, meta?.breadcrumb, record])

  const visibleChildren = useMemo(
    () => meta?.children?.filter((child) => {
      if (!child.privatePermissions) return true
      const childDomain = child.domain ?? DOMAIN
      return domains.some((d) => d.key === childDomain && d.resources.some((r) => r.key === child.resource))
    }) ?? [],
    [meta?.children, domains],
  )

  const childActions = (!isNew && record?.id)
    ? visibleChildren.map((child) => {
        const childDomain = child.domain ?? DOMAIN
        const href = `/${childDomain}/${child.resource}?${child.contextField}=${record.id}`
        return {
          label:   child.label,
          icon:    LayoutList,
          onClick: () => router.push(href),
          variant: 'ghost' as const,
          primary: false,
          ...(child.keybind  ? { keybind:  child.keybind.toUpperCase() } : {}),
          ...(child.overflow ? { overflow: true }                       : {}),
        }
      })
    : []

  async function handleDelete() {
    const ok = await confirm({ title: `Excluir ${meta?.label ?? 'registro'}?` })
    if (!ok) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw json
      }
      toast.success(msgs.deleted())
      router.push(effectiveListPath)
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
      const href = `/${child.domain ?? DOMAIN}/${child.resource}?${child.contextField}=${record.id}`
      core.bind(child.keybind, () => router.push(href), {
        desc: child.label, icon: LayoutList, group, order: 4,
      })
    }
    return () => { core.unbindGroup('_children_kb') }
  }, [isNew, visibleChildren, record?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useShortcut('alt+g', () => {
    if (isNew ? canCreate : canUpdate)
      (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar registro', icon: Save, origin: 'apps/web/src/app/transit/transit-locality/[id]/page', context: 'all' })

  useShortcut('alt+l', () => setResetSignal((s) => s + 1), {
    display: false,
    origin:  'apps/web/src/app/transit/transit-locality/[id]/page',
  })

  useShortcut('alt+v', () => router.push(effectiveListPath), {
    desc: 'Voltar', icon: ArrowLeft,
    origin: 'apps/web/src/app/transit/transit-locality/[id]/page', context: 'all',
  })

  if (guardNode) return guardNode

  async function handleSubmit(data: Record<string, unknown>) {
    setIsPending(true)
    try {
      const path = isNew ? `/${DOMAIN}/${RESOURCE}` : `/${DOMAIN}/${RESOURCE}/${id}`
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
        router.push(effectiveListPath)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : msgs.error.save())
      setIsPending(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb
        domain={DOMAIN}
        resource={RESOURCE}
        id={id}
        recordName={recordName}
        contextParams={contextParams}
      />

      {lines.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lines.map((line) => (
            <button
              key={line.id}
              type="button"
              title={line.name}
              onClick={() => router.push(`/transit/transit-line/${line.id}`)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <RouteIcon className="w-3 h-3" />
              {line.code}
            </button>
          ))}
        </div>
      )}

      <AutoForm
        domain={DOMAIN}
        resource={RESOURCE}
        defaultValues={isNew ? newRecordDefaults : record}
        readonlyFields={readonlyFields}
        readOnly={!isNew && !canUpdate}
        isNew={isNew}
        onSubmit={handleSubmit}
        formId={FORM_ID}
        resetSignal={resetSignal}
      />
    </div>
  )
}
