'use client'

// Dados Operacionais Previstos — Fase 3 (docs/proposal/plan_dop_v1.md). Reaproveita a
// composição visual validada no protótipo (/playground), agora com dado real do
// endpoint `GET /transit/dop`. "Km por empresa" (gráfico) usa VehicleBlock.branchId
// — cada bloco pertence a uma única empresa, sem rateio entre elas (ao contrário do
// rateio de km ociosa entre linhas, que ainda se aplica dentro de cada bloco).

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { DopPeriodSummary, DopLineDayTypeBreakdown } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { usePageGuard } from '@/core/usePageGuard'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { httpError, httpRetry } from '@/lib/query'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

// ── data hooks ───────────────────────────────────────────────────────────────

interface ScopeOption { id: string; name: string }

function useScopes() {
  return useQuery<ScopeOption[]>({
    queryKey: ['transit', 'scope', 'dop-lookup'],
    queryFn: async () => {
      const res = await apiFetch('/transit/scope?pageSize=200')
      if (!res.ok) throw httpError(res.status)
      const json = await res.json()
      return json.data
    },
    retry: httpRetry,
  })
}

function useDopPeriod(scopeId: string, from: string, to: string) {
  return useQuery<DopPeriodSummary>({
    queryKey: ['transit', 'dop', scopeId, from, to],
    queryFn: async () => {
      const res = await apiFetch(`/transit/dop?scopeId=${scopeId}&from=${from}&to=${to}`)
      if (!res.ok) throw httpError(res.status)
      return res.json()
    },
    enabled: !!scopeId && !!from && !!to,
    retry:   httpRetry,
  })
}

// ── period helpers ───────────────────────────────────────────────────────────

function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function firstDayOfMonth(month: string): string { return `${month}-01` }
function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

// ── formatting ────────────────────────────────────────────────────────────

function fmtKm(v: number): string { return Math.round(v).toLocaleString('pt-BR') }
function fmtPct(v: number, decimals = 0): string { return `${(v * 100).toFixed(decimals)}%` }
function fmtSpeed(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
function fmtDateBr(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

// ── status tokens (mesma convenção de AutoList.tsx Badge / LineSummaryView) ──

const STATUS_CLS = {
  success:     'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning:     'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  destructive: 'bg-destructive/15 text-destructive',
} as const

function occupancyStatus(v: number | null): keyof typeof STATUS_CLS {
  if (v == null) return 'success'
  if (v >= 0.90) return 'destructive'
  if (v >= 0.75) return 'warning'
  return 'success'
}

const CHART_GREEN_CLS = 'bg-emerald-500 dark:bg-emerald-600' // produtiva (status "good")
const CHART_AMBER_CLS = 'bg-amber-500 dark:bg-amber-600'     // ociosa (status "warning")

const HEADER_GROUP_BG    = 'bg-muted/40'
const HEADER_SUBGROUP_BG = 'bg-muted/60'
const GROUP_DIVIDER      = 'border-l-2 border-border'

// ── UI pieces ────────────────────────────────────────────────────────────────

function StatTile({ icon: Icon, label, value, sub }: {
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

function SplitBar({ produtiva, ociosa }: { produtiva: number; ociosa: number }) {
  const total   = produtiva + ociosa
  const prodPct = total > 0 ? (produtiva / total) * 100 : 0
  const idlePct = 100 - prodPct
  return (
    <div className="flex h-4 w-full rounded-sm overflow-hidden">
      <div className={CHART_GREEN_CLS} style={{ width: `${prodPct}%` }} />
      {idlePct > 0 && <div className="w-[2px] shrink-0 bg-card" />}
      <div className={CHART_AMBER_CLS} style={{ width: `${idlePct}%` }} />
    </div>
  )
}

function HeadwayCell({ morning, offPeak, afternoon }: { morning: number | null; offPeak: number | null; afternoon: number | null }) {
  return (
    <div className="flex items-center gap-2.5 tabular-nums text-xs">
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" />{morning ?? '—'}{morning != null && '′'}</span>
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />{offPeak ?? '—'}{offPeak != null && '′'}</span>
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" />{afternoon ?? '—'}{afternoon != null && '′'}</span>
    </div>
  )
}

// ── per-line table ───────────────────────────────────────────────────────────

type Tab = 'frota' | 'indicadores' | 'km'
const TABS: { key: Tab; label: string }[] = [
  { key: 'frota',       label: 'Frota' },
  { key: 'indicadores', label: 'Indicadores' },
  { key: 'km',          label: 'Km' },
]

function kmPct(b: { kmProdutiva: number; kmOciosa: number }): number {
  const total = b.kmProdutiva + b.kmOciosa
  return total > 0 ? b.kmOciosa / total : 0
}

function KmGroupHeader({ isMonth, divider }: { isMonth?: boolean; divider?: boolean }) {
  return (
    <>
      <th className={cn('text-right font-medium px-2 py-1 whitespace-nowrap', divider && GROUP_DIVIDER)}>Produt.</th>
      <th className="text-right font-medium px-2 py-1 whitespace-nowrap">Ociosa</th>
      <th className="text-right font-medium px-2 py-1 whitespace-nowrap">%</th>
      {isMonth && <th className="text-right font-medium px-2 py-1 whitespace-nowrap">Total</th>}
    </>
  )
}

function KmGroupCells({ block, divider, withTotal }: { block: DopLineDayTypeBreakdown | { kmProdutiva: number; kmOciosa: number }; divider?: boolean; withTotal?: boolean }) {
  return (
    <>
      <td className={cn('px-2 py-1.5 text-right', divider && GROUP_DIVIDER)}>{fmtKm(block.kmProdutiva)}</td>
      <td className="px-2 py-1.5 text-right">{fmtKm(block.kmOciosa)}</td>
      <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtPct(kmPct(block))}</td>
      {withTotal && <td className="px-2 py-1.5 text-right font-medium">{fmtKm(block.kmProdutiva + block.kmOciosa)}</td>}
    </>
  )
}

// ── CSV export — uma linha por linha de ônibus, colunas de todas as 3 visões juntas ──

function csvCell(value: string | number): string {
  const s = String(value)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportDopCsv(data: DopPeriodSummary, dayTypes: DopPeriodSummary['calendar']) {
  const headwayCell = (v: number | null) => (v == null ? '' : String(v))

  const header = [
    'Código', 'Linha',
    ...dayTypes.map(dt => `Frota ${dt.dayTypeCode}`),
    ...dayTypes.map(dt => `Viagens ${dt.dayTypeCode}`),
    'Viagens Mês',
    ...dayTypes.flatMap(dt => [`Km Produtiva ${dt.dayTypeCode}`, `Km Ociosa ${dt.dayTypeCode}`, `Km % Ociosa ${dt.dayTypeCode}`]),
    'Km Produtiva Mês', 'Km Ociosa Mês', 'Km % Ociosa Mês', 'Km Total Mês',
    'Vel. Média', 'Ocupação %', 'Headway Manhã', 'Headway Entrepico', 'Headway Tarde',
  ]

  const rows = data.lines.map(line => {
    const byDayType = new Map(line.byDayType.map(bd => [bd.dayTypeId, bd]))
    const kmTotalMes = line.kmProdutivaMes + line.kmOciosaMes
    return [
      line.lineCode, line.lineName,
      ...dayTypes.map(dt => byDayType.get(dt.dayTypeId)?.fleet ?? ''),
      ...dayTypes.map(dt => byDayType.get(dt.dayTypeId)?.trips ?? 0),
      line.tripsMes,
      ...dayTypes.flatMap(dt => {
        const bd = byDayType.get(dt.dayTypeId) ?? { kmProdutiva: 0, kmOciosa: 0 }
        return [Math.round(bd.kmProdutiva), Math.round(bd.kmOciosa), (kmPct(bd) * 100).toFixed(1)]
      }),
      Math.round(line.kmProdutivaMes), Math.round(line.kmOciosaMes), (kmPct({ kmProdutiva: line.kmProdutivaMes, kmOciosa: line.kmOciosaMes }) * 100).toFixed(1), Math.round(kmTotalMes),
      line.avgSpeed == null ? '' : line.avgSpeed.toFixed(1),
      line.occupancyIndex == null ? '' : (line.occupancyIndex * 100).toFixed(0),
      headwayCell(line.peakMorningInterval), headwayCell(line.offPeakInterval), headwayCell(line.peakAfternoonInterval),
    ]
  })

  const dayTypeSummary = dayTypes.map(dt => {
    let kmProdutiva = 0, kmOciosa = 0, fleet = 0, trips = 0
    for (const line of data.lines) {
      const bd = line.byDayType.find(b => b.dayTypeId === dt.dayTypeId)
      if (bd) { kmProdutiva += bd.kmProdutiva; kmOciosa += bd.kmOciosa; fleet += bd.fleet ?? 0; trips += bd.trips }
    }
    return { kmProdutiva, kmOciosa, fleet, trips }
  })
  const totalRow = [
    '', 'Total',
    ...dayTypeSummary.map(dt => dt.fleet || ''),
    ...dayTypeSummary.map(dt => dt.trips),
    data.totals.tripsMes,
    ...dayTypeSummary.flatMap(dt => [Math.round(dt.kmProdutiva), Math.round(dt.kmOciosa), (kmPct(dt) * 100).toFixed(1)]),
    Math.round(data.totals.kmProdutivaMes), Math.round(data.totals.kmOciosaMes), (kmPct({ kmProdutiva: data.totals.kmProdutivaMes, kmOciosa: data.totals.kmOciosaMes }) * 100).toFixed(1), Math.round(data.totals.kmProdutivaMes + data.totals.kmOciosaMes),
    '', '', '', '', '',
  ]

  const csv = '﻿' + [header, ...rows, totalRow].map(r => r.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `dop_${data.scopeId}_${data.from}_${data.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function DopPage() {
  const router  = useRouter()
  const { toast } = useToast()
  const { guardNode } = usePageGuard('transit', 'dop')

  const { data: scopes } = useScopes()
  const [scopeId, setScopeId] = useState('')
  useEffect(() => {
    if (!scopeId && scopes && scopes.length > 0) setScopeId(scopes[0].id)
  }, [scopes, scopeId])

  const initialMonth = currentMonthStr()
  const [month, setMonth]         = useState(initialMonth)
  const [fromInput, setFromInput] = useState(firstDayOfMonth(initialMonth))
  const [toInput, setToInput]     = useState(lastDayOfMonth(initialMonth))
  const [query, setQuery]         = useState({ from: fromInput, to: toInput })
  const [tab, setTab]             = useState<Tab>('frota')

  function handleMonthChange(value: string) {
    setMonth(value)
    setFromInput(firstDayOfMonth(value))
    setToInput(lastDayOfMonth(value))
  }

  function handleBuscar() {
    const from = new Date(fromInput)
    const to   = new Date(toInput)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      toast.error('Período inválido')
      return
    }
    const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
    if (months > 12) toast.warning('Período maior que 12 meses — a busca segue usando exatamente o intervalo informado.')
    setQuery({ from: fromInput, to: toInput })
  }

  useShortcut('alt+v', () => router.push('/transit'), {
    desc: 'Voltar', icon: Icons.ArrowLeft, origin: 'app/transit/dop/page',
  })

  const { data, isLoading, isError } = useDopPeriod(scopeId, query.from, query.to)

  const dayTypes = data?.calendar ?? []

  const dayTypeSummary = useMemo(() => {
    if (!data) return []
    const acc = new Map<string, { kmProdutiva: number; kmOciosa: number; fleet: number; trips: number }>()
    for (const line of data.lines) {
      for (const bd of line.byDayType) {
        const cur = acc.get(bd.dayTypeId) ?? { kmProdutiva: 0, kmOciosa: 0, fleet: 0, trips: 0 }
        cur.kmProdutiva += bd.kmProdutiva
        cur.kmOciosa    += bd.kmOciosa
        cur.fleet       += bd.fleet ?? 0
        cur.trips       += bd.trips
        acc.set(bd.dayTypeId, cur)
      }
    }
    return dayTypes.map(dt => ({ ...dt, ...(acc.get(dt.dayTypeId) ?? { kmProdutiva: 0, kmOciosa: 0, fleet: 0, trips: 0 }) }))
  }, [data, dayTypes])

  const kmTotalMes  = (data?.totals.kmProdutivaMes ?? 0) + (data?.totals.kmOciosaMes ?? 0)
  const idlePctPlan = kmTotalMes > 0 ? (data!.totals.kmOciosaMes / kmTotalMes) : 0
  const pmm         = data && data.totals.fleetOperacional > 0 ? kmTotalMes / data.totals.fleetOperacional : 0

  if (guardNode) return guardNode

  return (
    <div className="p-6 space-y-5 w-full max-w-screen-2xl mx-auto">
      {/* ── cabeçalho ── */}
      <AutoBreadcrumb domain="transit" resource="dop" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Dados Operacionais Previstos</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {scopes?.find(s => s.id === scopeId)?.name ?? '—'}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Escopo</label>
            <Select size="sm" className="h-[30px] w-44" value={scopeId} onChange={e => setScopeId(e.target.value)}>
              {(scopes ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Competência</label>
            <input
              type="month"
              value={month}
              onChange={e => handleMonthChange(e.target.value)}
              className="h-[30px] rounded-sm border border-input text-xs px-2 w-32"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Início</label>
            <input type="date" value={fromInput} onChange={e => setFromInput(e.target.value)} className="h-[30px] rounded-sm border border-input text-xs px-2 w-[130px]" />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Fim</label>
            <input type="date" value={toInput} onChange={e => setToInput(e.target.value)} className="h-[30px] rounded-sm border border-input text-xs px-2 w-[130px]" />
          </div>
          <Button size="sm" variant="outline" onClick={handleBuscar}><Icons.Search className="w-3.5 h-3.5" />Buscar</Button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}
      {isError   && <div className="text-sm text-destructive">Erro ao carregar os dados do período.</div>}

      {data && (
        <>
          {/* ── composição do período ── */}
          <div className="rounded-md border border-border bg-card px-4 py-2.5 flex flex-wrap items-center gap-5 text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <Icons.CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
              {fmtDateBr(query.from)} – {fmtDateBr(query.to)}
            </span>
            <span className="text-muted-foreground">·</span>
            {dayTypes.map(dt => (
              <span key={dt.dayTypeId}><span className="font-medium">{dt.days}</span> <span className="text-muted-foreground">{dt.dayTypeName.toLowerCase()}</span></span>
            ))}
            <span className="text-muted-foreground">·</span>
            <span><span className="font-medium">{dayTypes.reduce((s, d) => s + d.days, 0)}</span> <span className="text-muted-foreground">dias no período</span></span>
          </div>

          {/* ── KPI hero row ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatTile icon={Icons.Bus}   label="Frota operacional"    value={data.totals.fleetOperacional.toLocaleString('pt-BR')} />
            <StatTile icon={Icons.Route} label="Km planejada (mês)"   value={`${fmtKm(kmTotalMes)} km`} />
            <StatTile icon={Icons.Gauge} label="% Ociosidade"         value={fmtPct(idlePctPlan)} sub={`${fmtKm(data.totals.kmOciosaMes)} km`} />
            <StatTile icon={Icons.ClipboardList} label="Viagens no período" value={data.totals.tripsMes.toLocaleString('pt-BR')} />
            <StatTile icon={Icons.Ruler} label="PMM" value={`${fmtKm(pmm)} km`} sub="por veículo/mês" />
          </div>

          {/* ── km por empresa (gráfico) + km por tipo de dia (tabela) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Km por empresa</h2>
                  <p className="text-[11px] text-muted-foreground">Produtiva x ociosa, consolidado de todas as linhas do escopo</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className={cn('w-2.5 h-2.5 rounded-sm', CHART_GREEN_CLS)} />Produtiva</span>
                  <span className="flex items-center gap-1.5"><span className={cn('w-2.5 h-2.5 rounded-sm', CHART_AMBER_CLS)} />Ociosa</span>
                </div>
              </div>
              <div className="space-y-3">
                {data.byBranch.length === 0 && <p className="text-xs text-muted-foreground">Sem dados de empresa para o período.</p>}
                {data.byBranch.map(b => (
                  <div key={b.branchId ?? 'unassigned'} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{b.branchName}</span>
                      <span className="tabular-nums text-muted-foreground">{fmtPct(kmPct(b), 2)}</span>
                    </div>
                    <SplitBar produtiva={b.kmProdutiva} ociosa={b.kmOciosa} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-border bg-card p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold">Km por tipo de dia</h2>
                <p className="text-[11px] text-muted-foreground">Consolidado de todas as linhas do escopo</p>
              </div>
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="text-left  font-medium px-2 py-1.5">Tipo de dia</th>
                    <th className="text-right font-medium px-2 py-1.5">Produtiva</th>
                    <th className="text-right font-medium px-2 py-1.5">Ociosa</th>
                    <th className="text-right font-medium px-2 py-1.5">%</th>
                    <th className="text-right font-medium px-2 py-1.5">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dayTypeSummary.map(dt => (
                    <tr key={dt.dayTypeId} className="border-b border-border">
                      <td className="px-2 py-1.5">{dt.dayTypeName} <span className="text-muted-foreground">({dt.days}x)</span></td>
                      <td className="px-2 py-1.5 text-right">{fmtKm(dt.kmProdutiva)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtKm(dt.kmOciosa)}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtPct(kmPct(dt))}</td>
                      <td className="px-2 py-1.5 text-right font-medium">{fmtKm(dt.kmProdutiva + dt.kmOciosa)}</td>
                    </tr>
                  ))}
                  <tr className="bg-accent/40 font-medium">
                    <td className="px-2 py-1.5">Mês</td>
                    <td className="px-2 py-1.5 text-right">{fmtKm(data.totals.kmProdutivaMes)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtKm(data.totals.kmOciosaMes)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtPct(idlePctPlan)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtKm(kmTotalMes)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── tabela por linha ── */}
          <div className="rounded-md border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="inline-flex rounded-sm border border-border p-0.5 bg-background/50">
                {TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      'px-3 py-1 text-xs rounded-sm transition-colors',
                      tab === t.key ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                {tab === 'indicadores' && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-2.5">
                    Headway:
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" />manhã</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />entrepico</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" />tarde</span>
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={() => exportDopCsv(data, dayTypes)}>
                  <Icons.Download className="w-3.5 h-3.5" />CSV
                </Button>
              </div>
            </div>

            <div className="overflow-auto max-h-[480px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  {tab === 'km' && (
                    <>
                      <tr className="text-[11px] text-muted-foreground">
                        <th rowSpan={2} className="text-left font-medium px-3 py-1.5 align-bottom">Linha</th>
                        {dayTypes.map((dt, i) => (
                          <th key={dt.dayTypeId} colSpan={3} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, i > 0 && GROUP_DIVIDER)}>
                            {dt.dayTypeName}
                          </th>
                        ))}
                        <th colSpan={4} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, GROUP_DIVIDER)}>Mês</th>
                      </tr>
                      <tr className={cn('text-[11px] text-muted-foreground border-b border-border', HEADER_SUBGROUP_BG)}>
                        {dayTypes.map((dt, i) => <KmGroupHeader key={dt.dayTypeId} divider={i > 0} />)}
                        <KmGroupHeader isMonth divider />
                      </tr>
                    </>
                  )}

                  {tab === 'frota' && (
                    <>
                      <tr className="text-[11px] text-muted-foreground">
                        <th rowSpan={2} className="text-left font-medium px-3 py-1.5 align-bottom">Linha</th>
                        <th colSpan={dayTypes.length} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG)}>Frota</th>
                        <th colSpan={dayTypes.length + 1} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, GROUP_DIVIDER)}>Viagens</th>
                      </tr>
                      <tr className={cn('text-[11px] text-muted-foreground border-b border-border', HEADER_SUBGROUP_BG)}>
                        {dayTypes.map(dt => <th key={`f-${dt.dayTypeId}`} className="text-right font-medium px-2 py-1">{dt.dayTypeCode}</th>)}
                        {dayTypes.map((dt, i) => (
                          <th key={`v-${dt.dayTypeId}`} className={cn('text-right font-medium px-2 py-1', i === 0 && GROUP_DIVIDER)}>{dt.dayTypeCode}</th>
                        ))}
                        <th className="text-right font-medium px-2 py-1">Mês</th>
                      </tr>
                    </>
                  )}

                  {tab === 'indicadores' && (
                    <tr className="border-b border-border text-[11px] text-muted-foreground">
                      <th className="text-left  font-medium px-3 py-2">Linha</th>
                      <th className="text-right font-medium px-3 py-2">Vel. média</th>
                      <th className="text-center font-medium px-3 py-2">Ocupação</th>
                      <th className="text-left  font-medium px-3 py-2">Headway</th>
                    </tr>
                  )}
                </thead>
                <tbody className="tabular-nums">
                  {data.lines.map((line, i) => {
                    const byDayType = new Map(line.byDayType.map(bd => [bd.dayTypeId, bd]))
                    return (
                      <tr key={line.lineId} className={cn('border-b border-border last:border-0 hover:bg-row-hover', i % 2 === 1 && 'bg-muted/40')}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{line.lineCode}</div>
                          <div className="text-[11px] text-muted-foreground">{line.lineName}</div>
                        </td>

                        {tab === 'frota' && (<>
                          {dayTypes.map(dt => {
                            const fleet = byDayType.get(dt.dayTypeId)?.fleet
                            return <td key={`f-${dt.dayTypeId}`} className="px-2 py-2 text-right">{fleet ? fleet.toLocaleString('pt-BR') : '—'}</td>
                          })}
                          {dayTypes.map((dt, di) => {
                            const trips = byDayType.get(dt.dayTypeId)?.trips
                            return <td key={`v-${dt.dayTypeId}`} className={cn('px-2 py-2 text-right', di === 0 && GROUP_DIVIDER)}>{trips ? trips.toLocaleString('pt-BR') : '—'}</td>
                          })}
                          <td className="px-2 py-2 text-right font-medium">{line.tripsMes.toLocaleString('pt-BR')}</td>
                        </>)}

                        {tab === 'km' && (<>
                          {dayTypes.map((dt, di) => (
                            <KmGroupCells key={dt.dayTypeId} block={byDayType.get(dt.dayTypeId) ?? { kmProdutiva: 0, kmOciosa: 0 }} divider={di > 0} />
                          ))}
                          <KmGroupCells block={{ kmProdutiva: line.kmProdutivaMes, kmOciosa: line.kmOciosaMes }} divider withTotal />
                        </>)}

                        {tab === 'indicadores' && (<>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtSpeed(line.avgSpeed)}</td>
                          <td className="px-3 py-2">
                            <span className={cn('mx-auto flex w-16 items-center justify-center rounded-sm px-2 py-0.5 font-medium', STATUS_CLS[occupancyStatus(line.occupancyIndex)])}>
                              {line.occupancyIndex == null ? '—' : `${(line.occupancyIndex * 100).toFixed(0)}%`}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <HeadwayCell morning={line.peakMorningInterval} offPeak={line.offPeakInterval} afternoon={line.peakAfternoonInterval} />
                          </td>
                        </>)}
                      </tr>
                    )
                  })}
                </tbody>
                {tab === 'frota' && (
                  <tfoot className="sticky bottom-0 bg-muted z-10">
                    <tr className="border-t border-border font-medium">
                      <td className="px-3 py-2">Total</td>
                      {dayTypeSummary.map(dt => <td key={`tf-${dt.dayTypeId}`} className="px-2 py-2 text-right">{dt.fleet ? dt.fleet.toLocaleString('pt-BR') : '—'}</td>)}
                      {dayTypeSummary.map((dt, di) => (
                        <td key={`tv-${dt.dayTypeId}`} className={cn('px-2 py-2 text-right', di === 0 && GROUP_DIVIDER)}>{dt.trips.toLocaleString('pt-BR')}</td>
                      ))}
                      <td className="px-2 py-2 text-right">{data.totals.tripsMes.toLocaleString('pt-BR')}</td>
                    </tr>
                  </tfoot>
                )}
                {tab === 'km' && (
                  <tfoot className="sticky bottom-0 bg-muted z-10">
                    <tr className="border-t border-border font-medium">
                      <td className="px-3 py-2">Total</td>
                      {dayTypeSummary.map((dt, di) => <KmGroupCells key={`tf-${dt.dayTypeId}`} block={dt} divider={di > 0} />)}
                      <KmGroupCells block={{ kmProdutiva: data.totals.kmProdutivaMes, kmOciosa: data.totals.kmOciosaMes }} divider withTotal />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
