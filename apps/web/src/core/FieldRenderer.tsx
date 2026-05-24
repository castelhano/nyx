'use client'

import { useEffect, useRef, useState } from 'react'
import { Controller, useWatch, useFormContext, type Control } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { IMaskInput } from 'react-imask'
import { ChevronDown, UserRound, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MetadataField } from '@nyx/types'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { inputBaseCls } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiFetch } from '@/lib/auth'
import { useFieldOptions } from './useFieldOptions'

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

function AvatarUpload({
  field, control, readonly,
}: {
  field: MetadataField; control: Control<any>; readonly?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <Controller
      name={field.name}
      control={control}
      render={({ field: ctrl }) => {
        const previewUrl = ctrl.value instanceof File
          ? URL.createObjectURL(ctrl.value)
          : (ctrl.value as string) || null

        return (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={readonly}
              onClick={() => fileRef.current?.click()}
              className="w-14 h-14 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 border border-border hover:opacity-80 transition-opacity disabled:cursor-not-allowed"
            >
              {previewUrl
                ? <img src={previewUrl} alt="Avatar" className="w-full h-full object-cover" />
                : <UserRound className="w-7 h-7 text-muted-foreground" />
              }
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) ctrl.onChange(file)
                e.target.value = ''
              }}
            />
            {ctrl.value && !readonly && (
              <button type="button" onClick={() => ctrl.onChange('')} className="text-xs text-muted-foreground hover:text-destructive">
                Remover
              </button>
            )}
          </div>
        )
      }}
    />
  )
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
      rules={{ required: field.required ? 'Campo obrigatório' : false }}
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

function RelationSelectControl({
  field, ctrl, options, dependsOnValue, autoFocus, className, readonly, containerClassName,
}: {
  field: MetadataField
  ctrl: { value: string | undefined; onChange: (v: unknown) => void; onBlur: () => void; ref: React.Ref<any> }
  options: Record<string, unknown>[]
  dependsOnValue: string | undefined
  autoFocus?: boolean
  className: string
  readonly?: boolean
  containerClassName?: string
}) {
  const prevRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!field.dependsOn) return
    if (prevRef.current !== undefined && prevRef.current !== dependsOnValue) {
      ctrl.onChange('')
    }
    prevRef.current = dependsOnValue
  }, [dependsOnValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const isDisabled = readonly || (!!field.dependsOn && !dependsOnValue && !ctrl.value)
  const labelField = field.labelField ?? 'name'

  return (
    <div className={cn('relative', containerClassName)}>
      <select
        id={field.name}
        autoFocus={autoFocus}
        value={ctrl.value ?? ''}
        onChange={ctrl.onChange}
        onBlur={ctrl.onBlur}
        ref={ctrl.ref}
        disabled={isDisabled}
        className={cn(className, 'appearance-none', field.keybind ? 'md:pr-20' : 'pr-9', isDisabled && readonlyCls)}
      >
        <option value="">{field.placeholder ?? 'Selecione…'}</option>
        {options.map((opt: Record<string, unknown>) => (
          <option key={String(opt.id)} value={String(opt.id)}>
            {String(opt[labelField] ?? opt.id)}
          </option>
        ))}
      </select>
      {field.keybind && <KeyHint k={field.keybind} className="right-8" />}
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
    </div>
  )
}

function RelationSelect({
  field, control, autoFocus, className, readonly, containerClassName,
}: {
  field: MetadataField; control: Control<any>; autoFocus?: boolean; className: string; readonly?: boolean; containerClassName?: string
}) {
  const rawWatched      = useWatch({ control, name: field.dependsOn ?? '' })
  const rawChildValue   = useWatch({ control, name: field.name })
  const dependsOnValue: string | undefined  = field.dependsOn ? ((rawWatched as string) || undefined) : undefined
  const hasCurrentValue = field.dependsOn ? !!rawChildValue : false
  const { options }     = useFieldOptions(field, dependsOnValue, { hasCurrentValue })

  return (
    <Controller
      name={field.name}
      control={control}
      rules={{ required: field.required && !field.virtual ? 'Campo obrigatório' : false }}
      render={({ field: ctrl }) => (
        <RelationSelectControl
          field={field}
          ctrl={ctrl}
          options={options}
          dependsOnValue={dependsOnValue}
          autoFocus={autoFocus}
          className={className}
          readonly={readonly}
          containerClassName={containerClassName}
        />
      )}
    />
  )
}

function LockedDisplay({
  field, value, onEdit, readonly, containerClassName,
}: {
  field: MetadataField
  value: string
  onEdit: () => void
  readonly?: boolean
  containerClassName?: string
}) {
  const { data, isLoading } = useQuery<Record<string, unknown>>({
    queryKey:  ['relation-single', field.domain ?? 'core', field.resource, value],
    queryFn:   async () => {
      const res = await apiFetch(`/${field.domain ?? 'core'}/${field.resource}/${value}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
    enabled:   !!value,
    staleTime: 60_000,
  })

  const label = isLoading ? '…' : (data ? String(data[field.labelField ?? 'name'] ?? value) : value)

  return (
    <div className={cn('relative', containerClassName)}>
      <div className={cn(fieldInputCls, 'flex items-center gap-2', readonlyCls)}>
        <span className="flex-1 truncate">{label}</span>
      </div>
      {!readonly && (
        <button
          id={field.name}
          type="button"
          title="Edit"
          onClick={onEdit}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

function LockedRelationSelect({
  field, control, autoFocus, className, readonly, containerClassName,
}: {
  field: MetadataField; control: Control<any>; autoFocus?: boolean; className: string; readonly?: boolean; containerClassName?: string
}) {
  const [isEditing, setIsEditing] = useState(false)
  const { setValue } = useFormContext()

  const currentValue = useWatch({ control, name: field.name }) as string
  const parentValue  = useWatch({ control, name: field.dependsOn ?? '' }) as string
  const prevParentRef = useRef<string | undefined>(undefined)

  // When the parent field changes to a different value, clear own value and unlock.
  // This covers the case where the user changes company while branch is still locked.
  useEffect(() => {
    if (!field.dependsOn) return
    const prev = prevParentRef.current
    prevParentRef.current = parentValue
    if (prev !== undefined && prev !== parentValue && parentValue) {
      setValue(field.name, '')
      setIsEditing(true)
    }
  }, [parentValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const showLocked = !!currentValue && !isEditing

  if (!showLocked) {
    return (
      <RelationSelect
        field={field}
        control={control}
        autoFocus={autoFocus}
        className={className}
        readonly={readonly}
        containerClassName={containerClassName}
      />
    )
  }

  return (
    <Controller
      name={field.name}
      control={control}
      rules={{ required: field.required && !field.virtual ? 'Campo obrigatório' : false }}
      render={({ field: ctrl }) => (
        <LockedDisplay
          field={field}
          value={ctrl.value as string}
          onEdit={() => setIsEditing(true)}
          readonly={readonly}
          containerClassName={containerClassName}
        />
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
                <option key={o} value={o}>{field.optionLabels?.[o] ?? o}</option>
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

  if (field.widget === 'avatar' && control) {
    controlEl = <AvatarUpload field={field} control={control} readonly={readonly} />
  } else if (field.resource && control) {
    controlEl = field.lazyEdit
      ? <LockedRelationSelect field={field} control={control} autoFocus={autoFocus} className={fieldInputCls} readonly={readonly} containerClassName={field.className} />
      : <RelationSelect field={field} control={control} autoFocus={autoFocus} className={fieldInputCls} readonly={readonly} containerClassName={field.className} />
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
