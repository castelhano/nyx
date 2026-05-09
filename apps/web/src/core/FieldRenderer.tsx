'use client'

import type { MetadataField } from '@nyx/types'
import type { UseFormRegisterReturn } from 'react-hook-form'

interface Props {
  field:    MetadataField
  register: UseFormRegisterReturn
  error?:   string
}

export function FieldRenderer({ field, register, error }: Props) {
  const base = 'w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm select-none">
        <input type="checkbox" {...register} className="rounded" />
        {field.label}
        {error && <span className="text-red-500 text-xs ml-2">{error}</span>}
      </label>
    )
  }

  if (field.type === 'enum' && field.options) {
    return (
      <div>
        <label className="block text-sm font-medium mb-1">{field.label}</label>
        <select {...register} className={base}>
          <option value="">Select…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {error && <span className="text-red-500 text-xs">{error}</span>}
      </div>
    )
  }

  const inputType =
    field.widget === 'password' ? 'password' :
    field.type   === 'number'   ? 'number'   :
    field.type   === 'date'     ? 'date'     : 'text'

  return (
    <div>
      <label className="block text-sm font-medium mb-1">{field.label}</label>
      <input type={inputType} {...register} className={base} />
      {error && <span className="text-red-500 text-xs">{error}</span>}
    </div>
  )
}
