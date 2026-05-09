'use client'

import { ChevronDown } from 'lucide-react'
import type { MetadataField } from '@nyx/types'
import type { UseFormRegisterReturn } from 'react-hook-form'

interface Props {
  field:       MetadataField
  register:    UseFormRegisterReturn
  error?:      string
  autoFocus?:  boolean
}

const inputBase = 'w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

export function FieldRenderer({ field, register, error, autoFocus }: Props) {
  if (field.type === 'boolean') {
    return (
      <div className="md:col-start-2 flex items-center gap-2 pt-1">
        <input id={field.name} type="checkbox" autoFocus={autoFocus} {...register} className="rounded" />
        <label htmlFor={field.name} className="text-sm select-none cursor-pointer">{field.label}</label>
        {error && <p className="text-xs text-destructive ml-1">{error}</p>}
      </div>
    )
  }

  if (field.type === 'enum' && field.options) {
    return (
      <>
        <label htmlFor={field.name} className="text-sm font-medium pt-2">{field.label}</label>
        <div className={`space-y-1 ${field.width ?? ''}`}>
          <div className="relative">
            <select id={field.name} autoFocus={autoFocus} {...register} className={`${inputBase} appearance-none pr-9`}>
              <option value="">{field.placeholder ?? 'Selecione…'}</option>
              {field.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
          {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </>
    )
  }

  const inputType =
    field.widget === 'password' ? 'password' :
    field.type   === 'number'   ? 'number'   :
    field.type   === 'date'     ? 'date'     : 'text'

  const control = field.widget === 'textarea'
    ? <textarea id={field.name} autoFocus={autoFocus} {...register} rows={3} placeholder={field.placeholder} className={inputBase} />
    : <input id={field.name} type={inputType} autoFocus={autoFocus} {...register} placeholder={field.placeholder} className={inputBase} />

  return (
    <>
      <label htmlFor={field.name} className="text-sm font-medium pt-2">{field.label}</label>
      <div className={`space-y-1 ${field.width ?? ''}`}>
        {control}
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </>
  )
}
