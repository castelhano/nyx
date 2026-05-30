'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { Icons } from '@/lib/icons'
import { Input } from '@/components/ui/input'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { KeyHint } from '@/core/FieldRenderer'
import { usePageGuard } from '@/core/usePageGuard'
import { useRecordQuery } from '@/core/useRecordQuery'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut, useFieldKeybinds } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { msgs } from '@/lib/messages'
import { cn, extractError } from '@/lib/utils'
import { DayPatternInput } from '@/components/ui/day-pattern-input'
import type { DayTypePattern } from '@nyx/schemas'

const FORM_ID  = 'day-type-form'
const labelCls = 'text-sm font-medium pt-2'
const gridCls  = 'grid gap-x-6 gap-y-3 md:grid-cols-[minmax(140px,max-content)_1fr] md:items-start'

interface FormValues {
  code:        string
  name:        string
  description: string
  sortOrder:   number
  pattern:     DayTypePattern | null
}

export default function DayTypeDetailPage() {
  const { id }      = useParams<{ id: string }>()
  const router      = useRouter()
  const queryClient = useQueryClient()
  const isNew       = id === 'new'

  const [isPending, setIsPending] = useState(false)
  const { toast } = useToast()
  const confirm   = useConfirm()

  const formInit = { current: false }

  // ── data ──────────────────────────────────────────────────────────────────

  const { data: record, error: recordError } = useRecordQuery(
    ['transit', 'day-type', id],
    `/transit/day-type/${id}`,
    { enabled: !isNew, staleTime: 30_000 },
  )

  const { guardNode, meta, canCreate, canUpdate, canDelete } = usePageGuard(
    'transit', 'day-type', isNew, recordError ?? undefined,
  )

  const f   = (name: string) => meta?.fields.find((f) => f.name === name)
  const kb  = (name: string) => f(name)?.keybind     ?? ''
  const cls = (name: string) => f(name)?.className   ?? ''
  const ph  = (name: string) => f(name)?.placeholder ?? ''
  const lbl = (name: string) => f(name)?.label       ?? name
  const hlp = (name: string) => f(name)?.helpText    ?? ''

  // ── form ─────────────────────────────────────────────────────────────────

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      code: '', name: '', description: '', sortOrder: 0, pattern: null,
    },
  })

  useEffect(() => {
    if (!record || formInit.current) return
    reset({
      code:        String(record.code        ?? ''),
      name:        String(record.name        ?? ''),
      description: String(record.description ?? ''),
      sortOrder:   Number(record.sortOrder   ?? 0),
      pattern:     (record.pattern as DayTypePattern | null) ?? null,
    })
    formInit.current = true
  }, [record, reset]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── topbar & shortcuts ────────────────────────────────────────────────────

  async function handleDelete() {
    const ok = await confirm({ title: 'Excluir tipo de dia?' })
    if (!ok) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/transit/day-type/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(msgs.error.delete())
      toast.success(msgs.deleted())
      router.push('/transit/day-type')
    } catch {
      toast.error(msgs.error.delete())
      setIsPending(false)
    }
  }

  useTopbarActions([
    ...((isNew ? canCreate : canUpdate)
      ? [{ label: isPending ? 'Gravando…' : 'Gravar', icon: Icons.Save, type: 'submit' as const, form: FORM_ID, disabled: isPending, primary: true }]
      : []),
    ...(!isNew && canDelete
      ? [{ label: 'Excluir', icon: Icons.Trash2, variant: 'destructive' as const, onClick: handleDelete, disabled: isPending }]
      : []),
  ], [isPending, isNew, canCreate, canUpdate, canDelete])

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar registro', icon: Icons.Save, origin: 'apps/web/src/app/transit/day-type/[id]/page', context: 'all' })

  useShortcut('alt+l', () => {
    if (record) {
      reset({
        code:        String(record.code        ?? ''),
        name:        String(record.name        ?? ''),
        description: String(record.description ?? ''),
        sortOrder:   Number(record.sortOrder   ?? 0),
        pattern:     (record.pattern as DayTypePattern | null) ?? null,
      })
    }
  }, { display: false, origin: 'apps/web/src/app/transit/day-type/[id]/page' })

  useShortcut('alt+v', () => router.push('/transit/day-type'), {
    desc: 'Voltar', icon: Icons.ArrowLeft,
    origin: 'apps/web/src/app/transit/day-type/[id]/page', context: 'all',
  })

  useFieldKeybinds(
    (['code', 'name', 'description', 'sortOrder'] as const)
      .map((f) => ({ key: kb(f), fieldId: f }))
      .filter((b) => !!b.key),
    'transit/day-type/[id]',
  )

  // ── submit ────────────────────────────────────────────────────────────────

  async function onSubmit(data: FormValues) {
    setIsPending(true)
    try {
      const body = {
        code:        data.code,
        name:        data.name,
        description: data.description || null,
        sortOrder:   data.sortOrder,
        pattern:     data.pattern ?? null,
      }
      const path = isNew ? '/transit/day-type' : `/transit/day-type/${id}`
      const res  = await apiFetch(path, {
        method: isNew ? 'POST' : 'PATCH',
        body:   JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      await queryClient.invalidateQueries({ queryKey: ['transit', 'day-type', id] })
      toast.success(isNew ? msgs.created() : msgs.updated())
      router.push('/transit/day-type')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : msgs.error.save())
      setIsPending(false)
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  const recordName = record ? String(record.name ?? '') : undefined

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="transit" resource="day-type" id={id} recordName={recordName} />

      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} autoComplete="off">
        <div className={gridCls}>

          <label htmlFor="code" className={labelCls}>{lbl('code')}</label>
          <div className="space-y-1">
            <div className={cn('relative', cls('code'))}>
              <Input
                id="code"
                autoFocus={isNew}
                placeholder={ph('code')}
                className={cn('w-full', kb('code') && 'md:pr-10')}
                {...register('code', {
                  required: 'Código obrigatório',
                  onChange: (e) => { e.target.value = e.target.value.toUpperCase() },
                })}
              />
              {kb('code') && <KeyHint k={kb('code')} />}
            </div>
            {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
          </div>

          <label htmlFor="name" className={labelCls}>{lbl('name')}</label>
          <div className="space-y-1">
            <div className={cn('relative', cls('name'))}>
              <Input
                id="name"
                autoFocus={!isNew}
                placeholder={ph('name')}
                className={cn('w-full', kb('name') && 'md:pr-10')}
                {...register('name', { required: 'Nome obrigatório' })}
              />
              {kb('name') && <KeyHint k={kb('name')} />}
            </div>
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <label htmlFor="description" className={labelCls}>{lbl('description')}</label>
          <div className={cn('relative', cls('description'))}>
            <Input
              id="description"
              placeholder={ph('description')}
              className={cn('w-full', kb('description') && 'md:pr-10')}
              {...register('description')}
            />
            {kb('description') && <KeyHint k={kb('description')} />}
          </div>

          <label htmlFor="sortOrder" className={labelCls}>{lbl('sortOrder')}</label>
          <div className="space-y-1">
            <div className={cn('relative', cls('sortOrder'))}>
              <Input
                id="sortOrder"
                type="number"
                min={0}
                placeholder={ph('sortOrder')}
                className={cn('w-full', kb('sortOrder') && 'md:pr-10')}
                {...register('sortOrder', { valueAsNumber: true })}
              />
              {kb('sortOrder') && <KeyHint k={kb('sortOrder')} />}
            </div>
            {hlp('sortOrder') && <p className="text-xs text-muted-foreground">{hlp('sortOrder')}</p>}
          </div>

          <label className={labelCls}>{lbl('pattern')}</label>
          <div className="space-y-1">
            <Controller
              name="pattern"
              control={control}
              render={({ field }) => (
                <DayPatternInput
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!isNew && !canUpdate}
                />
              )}
            />
            {hlp('pattern') && <p className="text-xs text-muted-foreground">{hlp('pattern')}</p>}
          </div>

        </div>
      </form>
    </div>
  )
}
