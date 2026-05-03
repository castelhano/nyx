'use client'

import { useForm } from 'react-hook-form'
import { useMetadata } from './useMetadata'
import { FieldRenderer } from './FieldRenderer'

interface Props {
  domain:        string
  resource:      string
  defaultValues?: Record<string, unknown>
  onSubmit:      (data: Record<string, unknown>) => Promise<void>
}

export function AutoForm({ domain, resource, defaultValues, onSubmit }: Props) {
  const { data: meta, isLoading } = useMetadata(domain, resource)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues })

  if (isLoading) return <div className="text-sm text-gray-500">Loading form…</div>
  if (!meta) return null

  const visibleFields = meta.fields.filter((f) => f.showInForm)

  return (
    <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4">
      {visibleFields.map((field) => (
        <FieldRenderer
          key={field.name}
          field={field}
          register={register(field.name, { required: field.required })}
          error={errors[field.name]?.message as string | undefined}
        />
      ))}
      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
