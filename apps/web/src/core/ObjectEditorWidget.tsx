'use client'

// NOTE: despite the "generic" framing, this widget is not a true recursive JSON-schema
// editor — each Sub*Editor below was hand-written to match one specific shape found in
// TransitLine.metrics (the only field using widget: 'object-editor' in the whole app
// today), and the dispatch in ObjectEditorWidget picks between them by sniffing
// field.fields shapes rather than a clean type-driven switch. It works for what it
// currently serves, but if a second schema field ever needs this widget, treat that as
// the trigger to refactor into a real recursive renderer first — bolting one more
// shape-specific Sub*Editor onto this file is how it stops being tractable.

import { Controller, type Control } from 'react-hook-form'
import { cn } from '@/lib/utils'
import type { MetadataField } from '@nyx/types'
import { inputBaseCls } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const readonlyCls = 'opacity-60 cursor-not-allowed bg-muted'
const fieldInputCls = `${inputBaseCls} w-full`

export function SubObjectEditor({
  field, value, onChange, readonly,
}: {
  field: MetadataField
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  readonly?: boolean
}) {
  const handle = (key: string, raw: string, type: MetadataField['type']) => {
    const val = raw === '' ? undefined : type === 'number' ? Number(raw) : raw
    onChange({ ...value, [key]: val })
  }

  return (
    <div>
      <p className="font-semibold text-muted-foreground mb-2">{field.label}</p>
      <div className="flex flex-wrap gap-3">
        {field.fields?.filter(f => f.showInForm !== false).map((f) => (
          <div key={f.name} className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{f.label}</label>
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              value={value[f.name] != null ? String(value[f.name]) : ''}
              onChange={(e) => handle(f.name, e.target.value, f.type)}
              readOnly={readonly}
              step={f.type === 'number' ? 'any' : undefined}
              min={f.min}
              max={f.max}
              placeholder={f.placeholder}
              className={cn(fieldInputCls, 'w-32', readonly && readonlyCls)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Group of named sub-objects, e.g. metrics.renewalIndex = { OUTBOUND: Stat, INBOUND: Stat, ... } —
 *  same shape as SubSectionEditor but nesting SubObjectEditor (objects) instead of SubArrayEditor (arrays). */
export function SubGroupEditor({
  field, value, onChange, readonly,
}: {
  field:    MetadataField
  value:    Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  readonly?: boolean
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{field.label}</p>
      <div className="flex flex-wrap gap-6">
        {field.fields?.map(sub => {
          if (sub.type !== 'object') return null
          return (
            <SubObjectEditor
              key={sub.name}
              field={sub}
              value={(value[sub.name] ?? {}) as Record<string, unknown>}
              onChange={v => onChange({ ...value, [sub.name]: v })}
              readonly={readonly}
            />
          )
        })}
      </div>
    </div>
  )
}

export function SubSectionEditor({
  field, value, onChange, readonly,
}: {
  field:    MetadataField
  value:    Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  readonly?: boolean
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{field.label}</p>
      {field.fields?.map(sub => {
        if (sub.type !== 'array') return null
        return (
          <SubArrayEditor
            key={sub.name}
            field={sub}
            value={(value[sub.name] ?? []) as Record<string, unknown>[]}
            onChange={v => onChange({ ...value, [sub.name]: v })}
            readonly={readonly}
          />
        )
      })}
    </div>
  )
}

export function SubArrayEditor({
  field, value, onChange, readonly,
}: {
  field: MetadataField
  value: Record<string, unknown>[]
  onChange: (v: Record<string, unknown>[]) => void
  readonly?: boolean
}) {
  const addRow    = () => onChange([...value, {}])
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const updateRow = (i: number, key: string, raw: string, type: MetadataField['type']) => {
    const val = raw === '' ? undefined : type === 'number' ? Number(raw) : raw
    onChange(value.map((row, idx) => idx === i ? { ...row, [key]: val } : row))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground">{field.label}</p>
        {!readonly && (
          <Button type="button" onClick={addRow} variant='ghost' size="sm">Add</Button>
        )}
      </div>
      {value.length === 0 && !readonly && (
        <p className="text-xs text-muted-foreground italic">Nenhuma faixa cadastrada.</p>
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
                      <input
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={row[f.name] != null ? String(row[f.name]) : ''}
                        onChange={(e) => updateRow(i, f.name, e.target.value, f.type)}
                        readOnly={readonly}
                        step={f.type === 'number' ? 'any' : undefined}
                        min={f.min}
                        max={f.max}
                        placeholder={f.placeholder}
                        className={cn(fieldInputCls, 'w-full', readonly && readonlyCls)}
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

/** Dynamic-keyed group of sub-sections, e.g. metrics.windows = { <dayTypeCode>: { OUTBOUND:
 *  [...], INBOUND: [...] }, ... } — the value shape per key (`field.fields`) is static and
 *  introspected server-side, but which keys exist is data (DayType.code is a free-text
 *  resource, not a fixed enum), so keys are read from `value` itself rather than from the
 *  schema. Existing keys only — this editor corrects/inspects windows already imported via
 *  cycle-map, it doesn't originate a new dayType's data from scratch. */
export function SubRecordEditor({
  field, value, onChange, readonly,
}: {
  field:    MetadataField
  value:    Record<string, Record<string, unknown>>
  onChange: (v: Record<string, Record<string, unknown>>) => void
  readonly?: boolean
}) {
  const keys = Object.keys(value)

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{field.label}</p>
      {keys.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Nenhum dado cadastrado.</p>
      )}
      {keys.map((key) => (
        <div key={key} className="pl-3 border-l-2 border-border space-y-4">
          <p className="text-xs font-medium text-muted-foreground">Tipo de dia: {key}</p>
          {field.fields?.map(sub => {
            if (sub.type !== 'array') return null
            return (
              <SubArrayEditor
                key={sub.name}
                field={sub}
                value={((value[key]?.[sub.name] ?? []) as Record<string, unknown>[])}
                onChange={v => onChange({ ...value, [key]: { ...(value[key] ?? {}), [sub.name]: v } })}
                readonly={readonly}
              />
            )
          })}
        </div>
      ))}
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

        const handleKey = (key: string, val: unknown) => {
          ctrl.onChange({ ...value, [key]: val })
        }

        return (
          <div className="space-y-5">
            {field.fields?.map((sub) => {
              if (sub.type === 'object') {
                if (sub.fields?.some(f => f.type === 'array')) {
                  return (
                    <SubSectionEditor
                      key={sub.name}
                      field={sub}
                      value={(value[sub.name] ?? {}) as Record<string, unknown>}
                      onChange={(v) => handleKey(sub.name, v)}
                      readonly={readonly}
                    />
                  )
                }
                if (sub.fields?.some(f => f.type === 'object')) {
                  return (
                    <SubGroupEditor
                      key={sub.name}
                      field={sub}
                      value={(value[sub.name] ?? {}) as Record<string, unknown>}
                      onChange={(v) => handleKey(sub.name, v)}
                      readonly={readonly}
                    />
                  )
                }
                return (
                  <SubObjectEditor
                    key={sub.name}
                    field={sub}
                    value={(value[sub.name] ?? {}) as Record<string, unknown>}
                    onChange={(v) => handleKey(sub.name, v)}
                    readonly={readonly}
                  />
                )
              }
              if (sub.type === 'array') {
                return (
                  <SubArrayEditor
                    key={sub.name}
                    field={sub}
                    value={(value[sub.name] ?? []) as Record<string, unknown>[]}
                    onChange={(v) => handleKey(sub.name, v)}
                    readonly={readonly}
                  />
                )
              }
              if (sub.type === 'record') {
                return (
                  <SubRecordEditor
                    key={sub.name}
                    field={sub}
                    value={(value[sub.name] ?? {}) as Record<string, Record<string, unknown>>}
                    onChange={(v) => handleKey(sub.name, v)}
                    readonly={readonly}
                  />
                )
              }
              return null
            })}
          </div>
        )
      }}
    />
  )
}
