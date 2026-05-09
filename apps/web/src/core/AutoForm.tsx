'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMetadata } from './useMetadata'
import { FieldRenderer } from './FieldRenderer'


interface Props {
  domain:        string
  resource:      string
  defaultValues?: Record<string, unknown>
  onSubmit:      (data: Record<string, unknown>) => Promise<void>
  formId?:       string
}

export function AutoForm({ domain, resource, defaultValues, onSubmit, formId }: Props) {
  const { data: meta, isLoading } = useMetadata(domain, resource)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ defaultValues })

  useEffect(() => { if (defaultValues) reset(defaultValues) }, [JSON.stringify(defaultValues)])

  if (isLoading) return <div className="text-sm text-gray-500">Loading form…</div>
  if (!meta) return null

  const visibleFields = meta.fields.filter((f) => f.showInForm)

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(onSubmit as any)}
      className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(140px,max-content)_1fr] md:items-start"
      autoComplete='off'
    >
      {visibleFields.map((field) => (
        <FieldRenderer
          key={field.name}
          field={field}
          register={register(field.name, { required: field.required })}
          error={errors[field.name]?.message as string | undefined}
        />
      ))}
      {!formId && (
        <button
          type="submit"
          disabled={isSubmitting}
          className="md:col-start-2 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving…' : 'Save'}
        </button>
      )}
    </form>
  )
}
