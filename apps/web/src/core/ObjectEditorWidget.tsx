'use client'

// A true recursive JSON-schema-shaped editor, driven entirely by MetadataField.type — no
// shape-sniffing. `object` renders a labeled section that recurses into each of `field.fields`
// (whatever their own type is); `array` renders a table over `field.itemFields`; `record`
// renders a collapsible block per dynamic key, whose value shape is `field.fields`. Depth is
// unbounded: an object can nest another object/array/record and it just works, because every
// level dispatches through the same `FieldValueEditor`.

import { useState } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { cn } from '@/lib/utils'
import type { MetadataField } from '@nyx/types'
import { inputBaseCls } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'

const readonlyCls = 'opacity-60 cursor-not-allowed bg-muted'
const fieldInputCls = `${inputBaseCls} w-full`

const LEAF_TYPES: MetadataField['type'][] = ['string', 'number', 'boolean', 'date', 'enum', 'relation']
const isLeaf = (t: MetadataField['type']) => LEAF_TYPES.includes(t)

/** Bare input control for a leaf field — no label, callers own layout/labeling. */
function PrimitiveInput({
  field, value, onChange, readonly, className,
}: {
  field: MetadataField
  value: unknown
  onChange: (v: unknown) => void
  readonly?: boolean
  className?: string
}) {
  if (field.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        disabled={readonly}
        className={cn('rounded', className)}
      />
    )
  }

  if (field.type === 'enum' && field.options) {
    return (
      <select
        value={value != null ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        disabled={readonly}
        className={cn(fieldInputCls, className, readonly && readonlyCls)}
      >
        <option value="" />
        {field.options.map((opt) => (
          <option key={opt} value={opt}>{field.optionLabels?.[opt] ?? opt}</option>
        ))}
      </select>
    )
  }

  const handle = (raw: string) => {
    onChange(raw === '' ? undefined : field.type === 'number' ? Number(raw) : raw)
  }

  return (
    <input
      // 'relation' has no picker here (no nested resource fetch) — plain id text input
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={value != null ? String(value) : ''}
      onChange={(e) => handle(e.target.value)}
      readOnly={readonly}
      step={field.type === 'number' ? 'any' : undefined}
      min={field.min}
      max={field.max}
      placeholder={field.placeholder}
      className={cn(fieldInputCls, className, readonly && readonlyCls)}
    />
  )
}

/** Compact label+input cell, used when every sibling in an object is a leaf (flows inline). */
function CompactLeafCell({
  field, value, onChange, readonly,
}: {
  field: MetadataField
  value: unknown
  onChange: (v: unknown) => void
  readonly?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{field.label}</label>
      <PrimitiveInput field={field} value={value} onChange={onChange} readonly={readonly} className="w-32" />
    </div>
  )
}

function ObjectValueEditor({
  field, value, onChange, readonly, hideLabel,
}: {
  field: MetadataField
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  readonly?: boolean
  hideLabel?: boolean
}) {
  const children = field.fields ?? []
  const handleKey = (key: string, v: unknown) => onChange({ ...value, [key]: v })
  const allLeaf  = children.length > 0 && children.every((f) => isLeaf(f.type))
  // array/record children render as tables/blocks that read badly packed side by side
  // (e.g. metrics.windows.<dayType> = { OUTBOUND, INBOUND, CIRCULAR }, each an array) —
  // those always stack full-width; only a group of nested named objects (e.g.
  // metrics.renewalIndex = { OUTBOUND, INBOUND, CIRCULAR, overall }, each all-leaf) flows inline.
  const hasWideChild = children.some((f) => f.type === 'array' || f.type === 'record')

  return (
    <div className="space-y-2">
      {!hideLabel && <p className="font-semibold text-muted-foreground">{field.label}</p>}
      {allLeaf ? (
        <div className="flex flex-wrap gap-3">
          {children.map((sub) => (
            <CompactLeafCell
              key={sub.name}
              field={sub}
              value={value[sub.name]}
              onChange={(v) => handleKey(sub.name, v)}
              readonly={readonly}
            />
          ))}
        </div>
      ) : (
        <div className={hasWideChild ? 'space-y-4' : 'flex flex-wrap gap-6'}>
          {children.map((sub) => (
            <FieldValueEditor
              key={sub.name}
              field={sub}
              value={value[sub.name]}
              onChange={(v) => handleKey(sub.name, v)}
              readonly={readonly}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ArrayValueEditor({
  field, value, onChange, readonly,
}: {
  field: MetadataField
  value: Record<string, unknown>[]
  onChange: (v: Record<string, unknown>[]) => void
  readonly?: boolean
}) {
  const addRow    = () => onChange([...value, {}])
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const updateRow = (i: number, key: string, v: unknown) =>
    onChange(value.map((row, idx) => idx === i ? { ...row, [key]: v } : row))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground">{field.label}</p>
        {!readonly && (
          <Button type="button" onClick={addRow} variant="ghost" size="sm">Add</Button>
        )}
      </div>
      {value.length === 0 && !readonly && (
        <p className="text-xs text-muted-foreground italic">Nenhuma linha cadastrada.</p>
      )}
      {value.length > 0 && (
        <div className="rounded border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {field.itemFields?.map((f) => (
                  <th key={f.name} className="text-left text-xs font-medium text-muted-foreground px-3 py-2">
                    {f.label}
                  </th>
                ))}
                {!readonly && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              <tr className="h-2 pointer-events-none" aria-hidden="true"><td colSpan={(field.itemFields?.length || 0) + (readonly ? 0 : 1)} /></tr>
              {value.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {field.itemFields?.map((f) => (
                    <td key={f.name} className="px-2 py-1.5">
                      <PrimitiveInput
                        field={f}
                        value={row[f.name]}
                        onChange={(v) => updateRow(i, f.name, v)}
                        readonly={readonly}
                        className="w-full"
                      />
                    </td>
                  ))}
                  {!readonly && (
                    <td>
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="px-2 pt-0.5 pb-1.5 rounded-sm hover:bg-accent cursor-pointer"
                      >x</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Dynamic-keyed group, e.g. metrics.windows = { <dayTypeCode>: { OUTBOUND: [...], ... }, ... } —
 *  which keys exist is data (read from `value`, not the schema), but the shape under each key is
 *  static and described by `field.fields`, rendered recursively via ObjectValueEditor. */
function RecordValueEditor({
  field, value, onChange, readonly,
}: {
  field: MetadataField
  value: Record<string, Record<string, unknown>>
  onChange: (v: Record<string, Record<string, unknown>>) => void
  readonly?: boolean
}) {
  const keys = Object.keys(value)
  // collapsed by default — each key's detail (potentially several tables of rows) is
  // only worth the vertical space once the user actually wants to inspect that one
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setOpenKeys(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{field.label}</p>
      {keys.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Nenhum dado cadastrado.</p>
      )}
      {keys.map((key) => {
        const isOpen = openKeys.has(key)
        return (
          <div key={key} className="pl-3 border-l-2 border-border space-y-3">
            <button
              type="button"
              onClick={() => toggle(key)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Icons.ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')} />
              Tipo de dia: {key}
            </button>
            {isOpen && (
              <ObjectValueEditor
                field={{ ...field, type: 'object' }}
                value={value[key] ?? {}}
                onChange={(v) => onChange({ ...value, [key]: v })}
                readonly={readonly}
                hideLabel
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Dispatch by field.type alone — the only place composition depth is decided. */
function FieldValueEditor({
  field, value, onChange, readonly, hideLabel,
}: {
  field: MetadataField
  value: unknown
  onChange: (v: unknown) => void
  readonly?: boolean
  hideLabel?: boolean
}) {
  if (field.type === 'object') {
    return (
      <ObjectValueEditor
        field={field}
        value={(value ?? {}) as Record<string, unknown>}
        onChange={onChange as (v: Record<string, unknown>) => void}
        readonly={readonly}
        hideLabel={hideLabel}
      />
    )
  }
  if (field.type === 'array') {
    return (
      <ArrayValueEditor
        field={field}
        value={(value ?? []) as Record<string, unknown>[]}
        onChange={onChange as (v: Record<string, unknown>[]) => void}
        readonly={readonly}
      />
    )
  }
  if (field.type === 'record') {
    return (
      <RecordValueEditor
        field={field}
        value={(value ?? {}) as Record<string, Record<string, unknown>>}
        onChange={onChange as (v: Record<string, Record<string, unknown>>) => void}
        readonly={readonly}
      />
    )
  }
  // standalone leaf (top-level field, or a non-leaf sibling forced this object into the
  // stacked layout) — normal label + full-width input, distinct from CompactLeafCell
  return (
    <div className="flex flex-col gap-1 min-w-48">
      <label className="text-sm font-medium">{field.label}</label>
      <PrimitiveInput field={field} value={value} onChange={onChange} readonly={readonly} />
    </div>
  )
}

export function ObjectEditorWidget({
  field, control, readonly,
}: {
  field: MetadataField; control: Control<any>; readonly?: boolean
}) {
  return (
    <Controller
      name={field.name}
      control={control}
      render={({ field: ctrl }) => {
        const value = (ctrl.value ?? {}) as Record<string, unknown>
        const handleKey = (key: string, val: unknown) => ctrl.onChange({ ...value, [key]: val })

        return (
          <div className="space-y-5">
            {field.fields?.map((sub) => (
              <FieldValueEditor
                key={sub.name}
                field={sub}
                value={value[sub.name]}
                onChange={(v) => handleKey(sub.name, v)}
                readonly={readonly}
              />
            ))}
          </div>
        )
      }}
    />
  )
}
