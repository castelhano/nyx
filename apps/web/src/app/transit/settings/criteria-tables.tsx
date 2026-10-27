'use client'

import { useState, useRef } from 'react'
import { Icons } from '@/lib/icons'
import { Switch } from '@/components/ui/switch'
import { DurationInput } from '@/components/ui/duration-input'
import { cn } from '@/lib/utils'
import type { AnchoredCriterion, RangeCriterion } from '@nyx/schemas'

// Criteria editors shared by the transit settings page and the crew plan settings modal.

// ── Small components ─────────────────────────────────────────────────────────

export function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  )
}

function HintPopover({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0, right: 0 })
  const btnRef          = useRef<HTMLButtonElement>(null)

  function handleOpen() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setOpen((o) => !o)
  }

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <Icons.Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-56 rounded border bg-popover p-2.5 text-xs text-muted-foreground shadow-md"
            style={{ top: pos.top, right: pos.right }}
          >
            {hint}
          </div>
        </>
      )}
    </div>
  )
}


// meta unit of a minutes field edited as H:MM (DurationInput) instead of a plain number
export const DURATION_UNIT = 'h:mm'

// onRestore makes the dot a button that brings back the reference value. Its hit area (20px,
// ghost-button hover) is laid over the dot, so the row keeps the dot's 6px. -ml-1 mr-1 moves the
// dot 4px left without moving the label — centered between a px-4 row's edge and its gap-2 label;
// the table cells, with less room on the left, cancel it (mx-0).
export function DiffDot({ show, onRestore, className }: { show: boolean; onRestore?: () => void; className?: string }) {
  if (!show) return <span className="w-1.5" />
  if (!onRestore) return <span className={cn('w-1.5 h-1.5 -ml-1 mr-1 rounded-full bg-amber-700 flex-shrink-0', className)} title="Difere do global" />
  return (
    <span className={cn('relative w-1.5 h-1.5 -ml-1 mr-1 flex-shrink-0', className)}>
      <button
        type="button"
        onClick={onRestore}
        title="Difere do global — clique para usar o valor do global"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-sm flex items-center justify-center cursor-pointer hover:bg-accent/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-700" />
      </button>
    </span>
  )
}

export function NumberInput({ value, onChange, min = 0, max, step = 1, disabled }: {
  value:     number
  onChange:  (v: number) => void
  min?:      number
  max?:      number
  step?:     number
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const v = parseFloat(e.target.value)
        if (!isNaN(v)) onChange(Math.max(min, max !== undefined ? Math.min(max, v) : v))
      }}
      className={cn(
        'h-8 w-20 rounded-sm border border-input bg-input-bg text-center text-sm',
        'focus:outline-none focus:ring-1 focus:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
      )}
    />
  )
}

// ── AnchoredTable ────────────────────────────────────────────────────────────

type AnchoredMeta = Record<string, { label: string; unit: string; hint: string }>

export function AnchoredTable<T extends Record<string, AnchoredCriterion>>({ data, globalData, meta, onChange, onRestore, disabled }: {
  data:       T
  globalData: T
  meta:       AnchoredMeta
  onChange?:  (key: keyof T, field: keyof AnchoredCriterion, value: unknown) => void
  // brings a row back to its globalData values (DiffDot)
  onRestore?: (key: keyof T) => void
  disabled?:  boolean
}) {
  const keys = Object.keys(meta) as (keyof T)[]

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="w-1.5" />
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Critério</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-16">Ativo</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-28">Ideal até (%)</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-28">Ceiling (%)</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-24">Peso</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {keys.map((key) => {
            const m         = meta[key as string]
            const row       = data[key]
            const globalRow = globalData[key]
            const isDiff    = !disabled && (
              row.active              !== globalRow.active ||
              row.idealMaxOverPercent !== globalRow.idealMaxOverPercent ||
              row.ceilingOverPercent  !== globalRow.ceilingOverPercent ||
              row.weight              !== globalRow.weight
            )

            const set = (field: keyof AnchoredCriterion, value: unknown) => onChange?.(key, field, value)

            return (
              <tr key={String(key)} className="group">
                <td className="pl-2 pr-0">
                  <div className="flex items-center justify-center h-full py-3">
                    <DiffDot show={isDiff} onRestore={onRestore && (() => onRestore(key))} className="mx-0" />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span>{m.label}</span>
                    <span className="text-xs text-muted-foreground/50">{m.unit}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <Switch
                      checked={row.active}
                      onToggle={() => set('active', !row.active)}
                      disabled={disabled}
                    />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.idealMaxOverPercent} onChange={(v) => set('idealMaxOverPercent', v)} min={0} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.ceilingOverPercent} onChange={(v) => set('ceilingOverPercent', v)} min={0} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.weight} onChange={(v) => set('weight', v)} min={0} step={5} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <HintPopover hint={m.hint} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── RangeTable ───────────────────────────────────────────────────────────────

type RangeMeta = Record<string, { label: string; unit: string; hint: string }>

export function RangeTable<T extends Record<string, RangeCriterion>>({ data, globalData, meta, onChange, onRestore, disabled }: {
  data:       T
  globalData: T
  meta:       RangeMeta
  onChange?:  (key: keyof T, field: keyof RangeCriterion, value: unknown) => void
  // brings a row back to its globalData values (DiffDot)
  onRestore?: (key: keyof T) => void
  disabled?:  boolean
}) {
  const keys = Object.keys(meta) as (keyof T)[]

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="w-1.5" />
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Critério</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-16">Ativo</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Modifier</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Floor</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Ideal Min</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Ideal Max</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Ceiling</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {keys.map((key) => {
            const m         = meta[key as string]
            const row       = data[key]
            const globalRow = globalData[key]
            const isDiff    = !disabled && (
              row.active   !== globalRow.active   ||
              row.modifier !== globalRow.modifier ||
              row.floor    !== globalRow.floor    ||
              row.idealMin !== globalRow.idealMin ||
              row.idealMax !== globalRow.idealMax ||
              row.ceiling  !== globalRow.ceiling
            )

            const set = (field: keyof RangeCriterion, value: unknown) =>
              onChange?.(key, field, value)
            // called as a function, not a component — a component declared here would remount
            // (and lose focus) on every keystroke
            const bound = (field: 'floor' | 'idealMin' | 'idealMax' | 'ceiling') =>
              m.unit === DURATION_UNIT
                ? <DurationInput value={row[field]} onChange={(v) => set(field, v)} disabled={disabled} />
                : <NumberInput value={row[field]} onChange={(v) => set(field, v)} min={0} disabled={disabled} />

            return (
              <tr key={String(key)} className="group">
                <td className="pl-2 pr-0">
                  <div className="flex items-center justify-center h-full py-3">
                    <DiffDot show={isDiff} onRestore={onRestore && (() => onRestore(key))} className="mx-0" />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span>{m.label}</span>
                    <span className="text-xs text-muted-foreground/50">{m.unit}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <Switch
                      checked={row.active}
                      onToggle={() => set('active', !row.active)}
                      disabled={disabled}
                    />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.modifier} onChange={(v) => set('modifier', v)} min={0} max={100} step={0.1} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    {bound('floor')}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    {bound('idealMin')}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    {bound('idealMax')}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    {bound('ceiling')}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <HintPopover hint={m.hint} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
