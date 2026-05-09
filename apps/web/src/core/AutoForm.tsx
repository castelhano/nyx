'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMetadata } from './useMetadata'
import { FieldRenderer } from './FieldRenderer'
import { Tabs } from '@/components/ui/tabs'
import type { MetadataField } from '@nyx/types'

interface Props {
  domain:         string
  resource:       string
  defaultValues?: Record<string, unknown>
  onSubmit:       (data: Record<string, unknown>) => Promise<void>
  formId?:        string
  resetSignal?:   number
}

export function AutoForm({ domain, resource, defaultValues, onSubmit, formId, resetSignal }: Props) {
  const { data: meta, isLoading } = useMetadata(domain, resource)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ defaultValues })

  useEffect(() => { if (defaultValues) reset(defaultValues) }, [JSON.stringify(defaultValues)])
  useEffect(() => { if (resetSignal) reset(defaultValues ?? {}) }, [resetSignal])

  if (isLoading) return <div className="text-sm text-gray-500">Loading form…</div>
  if (!meta) return null

  const visibleFields = meta.fields.filter((f) => f.showInForm)

  function fieldGrid(fields: MetadataField[], autoFocusFirst = false) {
    return (
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(140px,max-content)_1fr] md:items-start">
        {fields.map((field, i) => (
          <FieldRenderer
            key={field.name}
            field={field}
            register={register(field.name, { required: field.required })}
            error={errors[field.name]?.message as string | undefined}
            autoFocus={autoFocusFirst && i === 0}
          />
        ))}
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

    return <Tabs tabs={tabs.map((g) => ({ label: g.label, content: fieldGrid(g.fields) }))} />
  }

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(onSubmit as any)}
      autoComplete="off"
    >
      {buildContent()}
      {!formId && (
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando…' : 'Salvar'}
        </button>
      )}
    </form>
  )
}
