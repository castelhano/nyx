'use client'

import { Controller, type Control } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { IMaskInput } from 'react-imask'
import { ChevronDown } from 'lucide-react'
import type { MetadataField, PaginatedResult } from '@nyx/types'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { apiFetch } from '@/lib/auth'

interface Props {
  field:       MetadataField
  register:    UseFormRegisterReturn
  control?:    Control<any>
  readonly?:   boolean
  error?:      string
  autoFocus?:  boolean
}

const inputBase = 'w-full border border-input rounded-[--radius] px-3 py-2 text-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring'
const readonlyCls = 'opacity-60 cursor-not-allowed bg-muted'

type MaskDef = string | { mask: string }[]

const MASKS: Record<string, MaskDef> = {
  'cnpj':      '00.000.000/0000-00',
  'cnpj-base': '00.000.000',
  'cpf':       '000.000.000-00',
  'cep':       '00000-000',
  'phone':     [{ mask: '(00) 0000-0000' }, { mask: '(00) 00000-0000' }],
}

function MaskedInput({
  field, control, autoFocus, className, readonly,
}: {
  field: MetadataField; control: Control<any>; autoFocus?: boolean; className: string; readonly?: boolean
}) {
  return (
    <Controller
      name={field.name}
      control={control}
      rules={{ required: field.required }}
      render={({ field: ctrl }) => (
        <IMaskInput
          mask={MASKS[field.mask!] as any}
          value={ctrl.value ?? ''}
          inputRef={ctrl.ref}
          onAccept={(val: string) => ctrl.onChange(val)}
          onBlur={ctrl.onBlur}
          id={field.name}
          autoFocus={autoFocus}
          placeholder={field.placeholder}
          readOnly={readonly}
          className={`${className} ${readonly ? readonlyCls : ''}`}
        />
      )}
    />
  )
}

function RelationSelect({
  field, control, autoFocus, className, readonly,
}: {
  field: MetadataField; control: Control<any>; autoFocus?: boolean; className: string; readonly?: boolean
}) {
  const { data } = useQuery<PaginatedResult<Record<string, unknown>>>({
    queryKey:  ['relation', field.resource],
    queryFn:   async () => {
      const res = await apiFetch(`/core/${field.resource}?pageSize=999`)
      if (!res.ok) throw new Error('Failed to fetch relation')
      return res.json()
    },
    staleTime: 30_000,
  })

  const options    = data?.data ?? []
  const labelField = field.labelField ?? 'name'

  return (
    <Controller
      name={field.name}
      control={control}
      rules={{ required: field.required }}
      render={({ field: ctrl }) => (
        <div className="relative">
          <select
            id={field.name}
            autoFocus={autoFocus}
            value={ctrl.value ?? ''}
            onChange={ctrl.onChange}
            onBlur={ctrl.onBlur}
            ref={ctrl.ref}
            disabled={readonly}
            className={`${className} appearance-none pr-9 ${readonly ? readonlyCls : ''}`}
          >
            <option value="">{field.placeholder ?? 'Selecione…'}</option>
            {options.map((opt) => (
              <option key={String(opt.id)} value={String(opt.id)}>
                {String(opt[labelField] ?? opt.id)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        </div>
      )}
    />
  )
}

export function FieldRenderer({ field, register, control, readonly, error, autoFocus }: Props) {
  if (field.type === 'boolean') {
    return (
      <div className="md:col-start-2 flex items-center gap-2 pt-1">
        <input
          id={field.name}
          type="checkbox"
          autoFocus={autoFocus}
          disabled={readonly}
          {...register}
          className={`rounded ${readonly ? readonlyCls : ''}`}
        />
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
            <select
              id={field.name}
              autoFocus={autoFocus}
              disabled={readonly}
              {...register}
              className={`${inputBase} appearance-none pr-9 ${readonly ? readonlyCls : ''}`}
            >
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

  let controlEl: React.ReactNode

  if (field.resource && control) {
    controlEl = <RelationSelect field={field} control={control} autoFocus={autoFocus} className={inputBase} readonly={readonly} />
  } else if (field.mask && control) {
    controlEl = <MaskedInput field={field} control={control} autoFocus={autoFocus} className={inputBase} readonly={readonly} />
  } else if (field.widget === 'textarea') {
    controlEl = (
      <textarea
        id={field.name}
        autoFocus={autoFocus}
        readOnly={readonly}
        {...register}
        rows={3}
        placeholder={field.placeholder}
        className={`${inputBase} ${readonly ? readonlyCls : ''}`}
      />
    )
  } else {
    controlEl = (
      <input
        id={field.name}
        type={inputType}
        autoFocus={autoFocus}
        readOnly={readonly}
        {...register}
        placeholder={field.placeholder}
        className={`${inputBase} ${readonly ? readonlyCls : ''}`}
      />
    )
  }

  return (
    <>
      <label htmlFor={field.name} className="text-sm font-medium pt-2">{field.label}</label>
      <div className={`space-y-1 ${field.width ?? ''}`}>
        {controlEl}
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </>
  )
}
