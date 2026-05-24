'use client'

import { Controller, type Control } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { IMaskInput } from 'react-imask'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MetadataField, PaginatedResult } from '@nyx/types'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { apiFetch } from '@/lib/auth'
import { inputBaseCls } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface Props {
  field:       MetadataField
  register:    UseFormRegisterReturn
  control?:    Control<any>
  readonly?:   boolean
  error?:      string
  autoFocus?:  boolean
}

const readonlyCls = 'opacity-60 cursor-not-allowed bg-muted'
const fieldInputCls = `${inputBaseCls} w-full`

type MaskDef = string | { mask: string }[]

const MASKS: Record<string, MaskDef> = {
  'cnpj':      '00.000.000/0000-00',
  'cnpj-base': '00.000.000',
  'cpf':       '000.000.000-00',
  'cep':       '00000-000',
  'phone':     [{ mask: '(00) 0000-0000' }, { mask: '(00) 00000-0000' }],
}

export function KeyHint({ k, className }: { k: string; className?: string }) {
  return (
    <span className={cn(
      'pointer-events-none select-none absolute top-1/2 -translate-y-1/2 right-3',
      'hidden md:inline-flex items-center rounded-sm border border-border/70 bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground/80',
      className,
    )}>
      {k.toUpperCase()}
    </span>
  )
}

function MaskedInput({
  field, control, autoFocus, className, readonly, containerClassName,
}: {
  field: MetadataField; control: Control<any>; autoFocus?: boolean; className: string; readonly?: boolean; containerClassName?: string
}) {
  return (
    <Controller
      name={field.name}
      control={control}
      rules={{ required: field.required }}
      render={({ field: ctrl }) => (
        <div className={cn('relative', containerClassName)}>
          <IMaskInput
            mask={MASKS[field.mask!] as any}
            value={ctrl.value ?? ''}
            inputRef={ctrl.ref}
            onAccept={(val: string) => ctrl.onChange(val)}
            onBlur={ctrl.onBlur}
            id={field.name}
            autoComplete="off"
            autoFocus={autoFocus}
            placeholder={field.placeholder}
            readOnly={readonly}
            className={cn(className, field.keybind && 'md:pr-10', readonly && readonlyCls)}
          />
          {field.keybind && <KeyHint k={field.keybind} />}
        </div>
      )}
    />
  )
}

function RelationSelect({
  field, control, autoFocus, className, readonly, containerClassName,
}: {
  field: MetadataField; control: Control<any>; autoFocus?: boolean; className: string; readonly?: boolean; containerClassName?: string
}) {
  const { data } = useQuery<PaginatedResult<Record<string, unknown>>>({
    queryKey:  ['relation', field.resource],
    queryFn:   async () => {
      const res = await apiFetch(`/${field.domain ?? 'core'}/${field.resource}?pageSize=999`)
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
        <div className={cn('relative', containerClassName)}>
          <select
            id={field.name}
            autoFocus={autoFocus}
            value={ctrl.value ?? ''}
            onChange={ctrl.onChange}
            onBlur={ctrl.onBlur}
            ref={ctrl.ref}
            disabled={readonly}
            className={cn(className, 'appearance-none', field.keybind ? 'md:pr-20' : 'pr-9', readonly && readonlyCls)}
          >
            <option value="">{field.placeholder ?? 'Selecione…'}</option>
            {options.map((opt) => (
              <option key={String(opt.id)} value={String(opt.id)}>
                {String(opt[labelField] ?? opt.id)}
              </option>
            ))}
          </select>
          {field.keybind && <KeyHint k={field.keybind} className="right-8" />}
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        </div>
      )}
    />
  )
}

export function FieldRenderer({ field, register, control, readonly, error, autoFocus }: Props) {
  if (field.widget === 'switch' && control) {
    return (
      <div className="md:col-start-2 flex items-center gap-2 pt-1">
        <Controller
          name={field.name}
          control={control}
          render={({ field: ctrl }) => (
            <>
              <Switch
                checked={Boolean(ctrl.value)}
                onToggle={() => ctrl.onChange(!ctrl.value)}
                disabled={readonly}
              />
              <span
                className={cn('text-sm select-none', !readonly && 'cursor-pointer')}
                onClick={() => !readonly && ctrl.onChange(!ctrl.value)}
              >
                {field.label}
              </span>
            </>
          )}
        />
        {error && <p className="text-xs text-destructive ml-1">{error}</p>}
      </div>
    )
  }

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
        <div className="space-y-1">
          <div className={cn('relative', field.className)}>
            <select
              id={field.name}
              autoFocus={autoFocus}
              disabled={readonly}
              {...register}
              className={cn(fieldInputCls, 'appearance-none', field.keybind ? 'md:pr-20' : 'pr-9', readonly && readonlyCls)}
            >
              <option value="">{field.placeholder ?? 'Selecione…'}</option>
              {field.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {field.keybind && <KeyHint k={field.keybind} className="right-8" />}
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
    field.widget === 'email'    ? 'email'    :
    field.type   === 'number'   ? 'number'   :
    field.type   === 'date'     ? 'date'     : 'text'

  let controlEl: React.ReactNode

  if (field.resource && control) {
    controlEl = <RelationSelect field={field} control={control} autoFocus={autoFocus} className={fieldInputCls} readonly={readonly} containerClassName={field.className} />
  } else if (field.mask && control) {
    controlEl = <MaskedInput field={field} control={control} autoFocus={autoFocus} className={fieldInputCls} readonly={readonly} containerClassName={field.className} />
  } else if (field.widget === 'textarea') {
    controlEl = (
      <div className={cn('relative', field.className)}>
        <textarea
          id={field.name}
          autoFocus={autoFocus}
          readOnly={readonly}
          {...register}
          rows={3}
          placeholder={field.placeholder}
          className={cn(fieldInputCls, field.keybind && 'md:pr-10', readonly && readonlyCls)}
        />
        {field.keybind && <KeyHint k={field.keybind} className="top-3 -translate-y-0" />}
      </div>
    )
  } else {
    controlEl = (
      <div className={cn('relative', field.className)}>
        <input
          id={field.name}
          type={inputType}
          autoComplete="off"
          autoFocus={autoFocus}
          readOnly={readonly}
          {...register}
          placeholder={field.placeholder}
          className={cn(fieldInputCls, field.keybind && 'md:pr-10', readonly && readonlyCls)}
        />
        {field.keybind && <KeyHint k={field.keybind} />}
      </div>
    )
  }

  return (
    <>
      <label htmlFor={field.name} className="text-sm font-medium pt-2">{field.label}</label>
      <div className="space-y-1">
        {controlEl}
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </>
  )
}
