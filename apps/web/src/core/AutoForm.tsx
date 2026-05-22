'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useMetadata } from './useMetadata'
import { FieldRenderer } from './FieldRenderer'
import { Tabs, type TabsHandle } from '@/components/ui/tabs'
import { useKeywatch } from '@/lib/keywatch/context'
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

  const visibleFields = meta?.fields.filter((f) => f.showInForm) ?? []

  // Mescla defaults do schema com os valores externos.
  // Usa meta?.resource como dep para re-calcular quando o resource muda,
  // e defaultValues para sync com dados do servidor.
  const mergedValues = useMemo(() => {
    const schemaDefaults = meta
      ? Object.fromEntries(
          meta.fields
            .filter((f) => f.defaultValue !== undefined && !(f.name in (defaultValues ?? {})))
            .map((f) => [f.name, f.defaultValue]),
        )
      : {}
    return { ...schemaDefaults, ...(defaultValues ?? {}) }
  }, [meta?.resource, defaultValues]) // eslint-disable-line react-hooks/exhaustive-deps

  // `values` (RHF 7.31+): sincroniza o form com dados externos via deep-equal,
  // eliminando os useEffects manuais de reset que havia antes.
  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({
    values: mergedValues,
  })

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
          const isReadonly = readOnly || readonlySet.has(field.name)
          const giveFocus  = autoFocusFirst && !focusGiven && !isReadonly
          if (giveFocus) focusGiven = true
          return (
            <FieldRenderer
              key={field.name}
              field={field}
              register={register(field.name, { required: field.required })}
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
        tabs={tabs.map((g) => ({ label: g.label, content: fieldGrid(g.fields, false) }))}
      />
    )
  }

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit as any)} autoComplete="off">
      {buildContent()}
      {!formId && (
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 bg-primary text-primary-foreground px-4 py-2 rounded-[--radius] text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando…' : 'Salvar'}
        </button>
      )}
    </form>
  )
}
