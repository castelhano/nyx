'use client'

// Pieces shared by the Carros and Escala views of the DOP page.

import { Icons } from '@/lib/icons'

// ── formatting ────────────────────────────────────────────────────────────

export function fmtKm(v: number): string { return Math.round(v).toLocaleString('pt-BR') }
export function fmtPct(v: number, decimals = 0): string { return `${(v * 100).toFixed(decimals)}%` }
export function fmtSpeed(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
export function fmtDateBr(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

// ── status tokens (mesma convenção de AutoList.tsx Badge / LineSummaryView) ──

export const STATUS_CLS = {
  success:     'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning:     'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  destructive: 'bg-destructive/15 text-destructive',
} as const

export function occupancyStatus(v: number | null): keyof typeof STATUS_CLS {
  if (v == null) return 'success'
  if (v >= 0.90) return 'destructive'
  if (v >= 0.75) return 'warning'
  return 'success'
}

export const CHART_GREEN_CLS = 'bg-emerald-500 dark:bg-emerald-600' // produtiva (status "good")
export const CHART_AMBER_CLS = 'bg-amber-500 dark:bg-amber-600'     // ociosa (status "warning")

export const HEADER_GROUP_BG    = 'bg-muted/40'
export const HEADER_SUBGROUP_BG = 'bg-muted/60'
export const GROUP_DIVIDER      = 'border-l-2 border-border'

// ── UI pieces ────────────────────────────────────────────────────────────────

export function StatTile({ icon: Icon, label, value, sub }: {
  icon:  (typeof Icons)['Bus']
  label: string
  value: string
  sub?:  string
}) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3 flex items-start gap-3">
      <div className="mt-0.5 shrink-0 w-8 h-8 rounded-sm bg-accent/60 flex items-center justify-center">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground leading-tight">{label}</div>
        <div className="text-xl font-semibold leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}
