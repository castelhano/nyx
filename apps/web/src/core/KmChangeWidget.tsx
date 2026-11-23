'use client'

import { useWatch, type Control } from 'react-hook-form'
import type { MetadataField } from '@nyx/types'
import { resolveIcon } from '@/lib/icons'

// widget 'km-change' — read-only km per direction before → after, e.g. LineRevision.extensionKm
// ({ OUTBOUND?: { from: number | null, to: number }, ... }). Never registered as an input.

const DIR_LABEL: Record<string, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }
const DIR_ORDER = ['OUTBOUND', 'INBOUND', 'CIRCULAR']

const ArrowIcon = resolveIcon('ArrowRight')

const fmtKm = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`

function fmtDiff(from: number | null | undefined, to: number): string | null {
  if (from == null) return null
  const d = Math.round((to - from) * 100) / 100
  return `${d > 0 ? '+' : ''}${d.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
}

export function KmChangeWidget({ field, control }: { field: MetadataField; control: Control<any> }) {
  const value   = useWatch({ control, name: field.name }) as Record<string, { from: number | null; to: number } | undefined> | null | undefined
  const entries = DIR_ORDER.flatMap((dir) => value?.[dir] ? [[dir, value[dir]!] as const] : [])

  return (
    <>
      <label className="text-sm font-medium pt-2">{field.label}</label>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground pt-2">Sem alteração de km registrada</p>
      ) : (
        <div className="w-full max-w-md border border-border rounded-sm divide-y divide-border text-sm">
          {entries.map(([dir, km]) => {
            const diff = fmtDiff(km.from, km.to)
            return (
              <div key={dir} className="flex items-center gap-3 px-3 py-2">
                <span className="font-medium w-16">{DIR_LABEL[dir] ?? dir}</span>
                <span className="tabular-nums ml-auto">
                  <span className="text-muted-foreground">{fmtKm(km.from)}</span>
                  <ArrowIcon className="inline w-3.5 h-3.5 mx-1.5 text-muted-foreground" />
                  {fmtKm(km.to)}
                </span>
                {diff && <span className="tabular-nums text-xs text-muted-foreground w-20 text-right">{diff}</span>}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
