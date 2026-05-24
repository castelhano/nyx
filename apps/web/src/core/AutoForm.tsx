'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useMetadata } from './useMetadata'
import { FieldRenderer } from './FieldRenderer'
import { Tabs, type TabsHandle } from '@/components/ui/tabs'
import { useKeywatch } from '@/lib/keywatch/context'
import { uploadFile } from '@/lib/auth'
import type { MetadataField } from '@nyx/types'

interface Props {
  domain:          string
  resource:        string
  defaultValues?:  Record<string, unknown>
  readonlyFields?: string[]
  readOnly?:       boolean
  onSubmit:        (data: Record<string, unknown>) => Promise<void>
  formId?:         string
  resetSignal?:    number
}

export function AutoForm({ domain, resource, defaultValues, readonlyFields, readOnly, onSubmit, formId, resetSignal }: Props) {
  const { data: meta, isLoading } = useMetadata(domain, resource)
  const { coreRef }  = useKeywatch()
  const keybindGroup = useRef(`autoform-${resource}`)
  const tabsRef      = useRef<TabsHandle>(null)

  const visibleFields  = meta?.fields.filter((f) => f.showInForm) ?? []
  const virtualNames   = useMemo(
    () => new Set(meta?.fields.filter((f) => f.virtual).map((f) => f.name) ?? []),
    [meta],
  )

  // Mescla defaults do schema com os valores externos.
  // Usa meta?.resource como dep para re-calcular quando o resource muda,
  // e defaultValues para sync com dados do servidor.
  const mergedValues = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    const schemaDefaults = meta
      ? Object.fromEntries(
          meta.fields
            .filter((f) => f.defaultValue !== undefined && !(f.name in (defaultValues ?? {})))
            .map((f) => [f.name, f.defaultValue === '$today' ? today : f.defaultValue]),
        )
      : {}
    const merged = { ...schemaDefaults, ...(defaultValues ?? {}) }

    // Deriva campos virtuais a partir dos objetos relacionados já incluídos pela API.
    // Ex: branchId.dependsOn='companyId' + relatedDisplayFields=['companyId']
    //     → API retorna branch.companyId → preenceh virtual companyId sem fetch extra.
    if (meta) {
      const virtualSet = new Set(meta.fields.filter((f) => f.virtual).map((f) => f.name))
      for (const field of meta.fields) {
        const parentName = field.dependsOn
        if (!parentName || !virtualSet.has(parentName)) continue
        if (!field.relatedDisplayFields?.includes(parentName)) continue
        if (merged[parentName] !== undefined && merged[parentName] !== '') continue
        const relationName = field.name.replace(/Id$/, '')
        const relObj = (defaultValues ?? {})[relationName]
        if (relObj && typeof relObj === 'object' && !Array.isArray(relObj)) {
          const val = (relObj as Record<string, unknown>)[parentName]
          if (val !== undefined) merged[parentName] = val
        }
      }
    }

    // Normaliza datas ISO do servidor para YYYY-MM-DD (formato do <input type="date">)
    for (const field of meta?.fields ?? []) {
      if (field.type === 'date' && typeof merged[field.name] === 'string') {
        const raw = merged[field.name] as string
        if (raw.includes('T')) merged[field.name] = raw.split('T')[0]
      }
    }
    return merged
  }, [meta?.resource, defaultValues]) // eslint-disable-line react-hooks/exhaustive-deps

  // `values` (RHF 7.31+): sincroniza o form com dados externos via deep-equal,
  // eliminando os useEffects manuais de reset que havia antes.
  const methods = useForm({ values: mergedValues })
  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = methods

  // Reset explícito apenas quando o sinal de reset muda (alt+l)
  useEffect(() => {
    if (!resetSignal) return
    reset(mergedValues)
  }, [resetSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Registra Ctrl+Shift+[keybind] para campos que declaram keybind no schema.
  // Se o campo estiver em outra aba, troca de aba antes de focar.
  useEffect(() => {
    if (!meta) return
    const core = coreRef.current
    if (!core) return
    const group = keybindGroup.current

    const tabIndexMap = new Map<string, number>()
    if (meta.groups?.length) {
      const groupedNames = new Set(meta.groups.flatMap((g) => g.fields))
      const hasUngrouped = visibleFields.some((f) => !groupedNames.has(f.name))
      const offset       = hasUngrouped ? 1 : 0

      meta.groups.forEach((g, i) => {
        g.fields.forEach((name) => tabIndexMap.set(name, i + offset))
      })
      if (hasUngrouped) {
        visibleFields
          .filter((f) => !groupedNames.has(f.name))
          .forEach((f) => tabIndexMap.set(f.name, 0))
      }
    }

    meta.fields
      .filter((f) => f.showInForm && f.keybind)
      .forEach((f) => {
        core.bind(`ctrl+shift+${f.keybind}`, () => {
          const tabIdx = tabIndexMap.get(f.name) ?? -1
          if (tabIdx >= 0 && tabsRef.current) {
            tabsRef.current.switchTo(tabIdx)
            requestAnimationFrame(() => document.getElementById(f.name)?.focus())
          } else {
            document.getElementById(f.name)?.focus()
          }
        }, {
          desc:    `Focar: ${f.label}`,
          display: false,
          group,
          origin:  'apps/web/src/core/AutoForm',
        })
      })

    return () => { core.unbindGroup(group) }
  }, [meta?.resource]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando…</div>
  if (!meta) return null

  const readonlySet = new Set(readonlyFields ?? [])

  function fieldGrid(fields: MetadataField[], autoFocusFirst = false) {
    let focusGiven = false
    return (
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(140px,max-content)_1fr] md:items-start">
        {fields.map((field) => {
          const isReadonly  = readOnly || readonlySet.has(field.name)
          // lazyEdit fields with a value will render as locked (no focusable input) — skip them
          const willBeLocked = field.lazyEdit && !!mergedValues[field.name]
          const giveFocus   = autoFocusFirst && !focusGiven && !isReadonly && !willBeLocked
          if (giveFocus) focusGiven = true
          return (
            <FieldRenderer
              // remount lazyEdit fields on reset so isEditing state reverts to locked
              key={field.lazyEdit ? `${field.name}-${resetSignal ?? 0}` : field.name}
              field={field}
              register={register(field.name, { required: field.required ? 'Campo obrigatório' : false })}
              control={control}
              readonly={isReadonly}
              error={errors[field.name]?.message as string | undefined}
              autoFocus={giveFocus}
            />
          )
        })}
      </div>
    )
  }

  function buildContent() {
    if (!meta?.groups?.length) return fieldGrid(visibleFields, true)

    const groupedNames = new Set(meta.groups.flatMap((g) => g.fields))
    const ungrouped    = visibleFields.filter((f) => !groupedNames.has(f.name))

    const tabs = meta.groups
      .map((g) => ({
        label:  g.label,
        fields: g.fields.map((n) => visibleFields.find((f) => f.name === n)).filter(Boolean) as MetadataField[],
      }))
      .filter((g) => g.fields.length > 0)

    if (ungrouped.length > 0) tabs.unshift({ label: 'Geral', fields: ungrouped })

    return (
      <Tabs
        ref={tabsRef}
        tabs={tabs.map((g) => ({
          label:      g.label,
          content:    fieldGrid(g.fields, false),
          errorCount: g.fields.filter((f) => errors[f.name]).length || undefined,
        }))}
      />
    )
  }

  return (
    <FormProvider {...methods}>
    <form id={formId} onSubmit={handleSubmit(async (data) => {
      const payload: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(data)) {
        if (virtualNames.has(k)) continue
        if (v instanceof File) {
          const form = new FormData()
          form.append('file', v)
          const res = await uploadFile('/upload/image', form)
          if (!res.ok) throw new Error('Falha no upload da imagem')
          const json = await res.json()
          payload[k] = json.url
        } else {
          payload[k] = v
        }
      }
      await onSubmit(payload)
    })} autoComplete="off">
      {buildContent()}
      {!formId && (
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 bg-primary text-primary-foreground px-4 py-2 rounded-(--radius) text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando…' : 'Salvar'}
        </button>
      )}
    </form>
    </FormProvider>
  )
}
