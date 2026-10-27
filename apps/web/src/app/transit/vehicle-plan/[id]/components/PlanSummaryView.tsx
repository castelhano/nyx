'use client'

import { useEffect, Fragment, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import type { VehiclePlanSummary } from '@nyx/schemas'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'
import { useShortcutContext } from '@/lib/keywatch'
import { Stat, pctChange, fmtDelta, fmtBand, PLAN_STATUS_LABEL, type Goodness, type PeakBands } from './LineSummaryView'

interface Bucket {
  key:   string
  label: string
  fleet: number
  km:    number
}

// VehiclePlanService.planOverview
export interface PlanOverview {
  summary:     VehiclePlanSummary | null
  lineCount:   number
  tripCount:   number
  issueBlocks: number
  staleBlocks: number
  driftedLines: number
  byDepot:       Bucket[]
  byVehicleType: Bucket[]
  byBranch:      Bucket[]
  fleetByHour:   { hour: number; fleet: number }[]
  // summed over the lines with demand recorded for the day type (demandLines of lineCount)
  supplyDemandByHour: { hour: number; demand: number; supply: number }[]
  demandLines:        number
}

interface PlanComparisonResponse {
  peakBands: PeakBands
  draft:     PlanOverview & { planId: string; planStatus: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' }
  active:    (PlanOverview & { planId: string; description: string | null; validFrom: string | null }) | null
}

export interface MetricDef {
  label:    string
  unit:     string
  get:      (o: PlanOverview) => number | null
  fmt:      (v: number) => string
  // lower is better
  inverse?: boolean
  band?:    keyof PeakBands
  cat:      string
  // the metric is a %: compare in percentage points
  points?:  boolean
}

export const int = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
export const dec = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const hours = (minutes: number | undefined) => minutes == null ? null : minutes / 60

export const METRICS: MetricDef[] = [
  { label: 'Frota total',        unit: 'veículos', get: o => o.summary?.fleetCount ?? null,          fmt: int, inverse: true, cat: 'Frota' },
  { label: 'Frota pico manhã',   unit: 'veículos', get: o => o.summary?.peakFleetMorning ?? null,    fmt: int, inverse: true, band: 'morning',   cat: 'Frota' },
  { label: 'Frota entrepico',    unit: 'veículos', get: o => o.summary?.peakFleetOffPeak ?? null,    fmt: int, inverse: true, band: 'offPeak',   cat: 'Frota' },
  { label: 'Frota pico tarde',   unit: 'veículos', get: o => o.summary?.peakFleetAfternoon ?? null,  fmt: int, inverse: true, band: 'afternoon', cat: 'Frota' },
  { label: 'Linhas',             unit: '',         get: o => o.lineCount,                            fmt: int,                cat: 'Produção' },
  { label: 'Viagens',            unit: 'viag/dia', get: o => o.tripCount,                            fmt: int,                cat: 'Produção' },
  { label: 'Km produtivo',       unit: 'km/dia',   get: o => o.summary?.productiveKm ?? null,        fmt: dec,                cat: 'Produção' },
  { label: 'Km ocioso',          unit: 'km/dia',   get: o => o.summary?.deadrunKm ?? null,           fmt: dec, inverse: true, cat: 'Produção' },
  { label: 'Km total',           unit: 'km/dia',   get: o => o.summary?.totalKm ?? null,             fmt: dec, inverse: true, cat: 'Produção' },
  { label: 'Ociosidade',         unit: '% do km',  get: o => o.summary && o.summary.totalKm > 0 ? (o.summary.deadrunKm / o.summary.totalKm) * 100 : null, fmt: dec, inverse: true, points: true, cat: 'Produção' },
  { label: 'Horas produtivas',   unit: 'h-veículo', get: o => hours(o.summary?.productiveMinutes),   fmt: dec,                cat: 'Tempo' },
  { label: 'Horas ociosas',      unit: 'h-veículo', get: o => hours(o.summary?.deadrunMinutes),      fmt: dec, inverse: true, cat: 'Tempo' },
  { label: 'Horas totais',       unit: 'h-veículo', get: o => hours(o.summary?.totalMinutes),        fmt: dec, inverse: true, cat: 'Tempo' },
  { label: 'Velocidade média',   unit: 'km/h',     get: o => o.summary && o.summary.productiveMinutes > 0 ? o.summary.productiveKm / (o.summary.productiveMinutes / 60) : null, fmt: dec, cat: 'Tempo' },
]

export const CATEGORIES = ['Frota', 'Produção', 'Tempo']

export function goodness(a: number | null, p: number | null, inverse?: boolean, points?: boolean): Goodness | null {
  if (a == null || p == null) return null
  const delta   = points ? p - a : pctChange(a, p)
  const neutral = Math.abs(delta) < (points ? 0.05 : 0.5)
  return { delta, neutral, good: !neutral && (inverse ? delta < 0 : delta > 0), points }
}

export function DeltaPill({ g }: { g: Goodness | null }) {
  if (!g) return <span className="text-xs px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">—</span>
  return (
    <span className={cn(
      'text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 font-semibold border',
      g.neutral
        ? 'bg-muted/60 text-muted-foreground border-border'
        : g.good
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
          : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
    )}>
      {!g.neutral && (g.good ? <Icons.ArrowUp className="w-3 h-3" /> : <Icons.ArrowDown className="w-3 h-3" />)}
      {fmtDelta(g)}
    </span>
  )
}

export const hourLabel = (h: number) => `${String(h % 24).padStart(2, '0')}h`

export function HourTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-2xl">
      <p className="font-semibold text-primary mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 leading-5">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="tabular-nums text-foreground">{p.value?.toLocaleString('pt-BR') ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

interface Props {
  planId:  string
  onClose: () => void
  // rendered first in the status bar — the Plano/Linhas switcher (SummaryView)
  switcher?: ReactNode
  // unsaved Gantt edits — the overview reads the saved plan only
  hasPendingChanges?: boolean
}

export function PlanSummaryView({ planId, onClose, switcher, hasPendingChanges }: Props) {
  useShortcutContext('summary')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { data, isLoading, error } = useQuery<PlanComparisonResponse>({
    // refetches when a save/discard clears the pending edits while the view is open
    queryKey: ['transit', 'vehicle-plan', planId, 'comparison', !!hasPendingChanges],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/comparison`)
      if (!res.ok) throw new Error('Erro ao carregar resumo do plano')
      return res.json()
    },
  })

  const hasReference = !!data && data.draft.planStatus !== 'ACTIVE'
  const draft  = data?.draft
  const active = data?.active ?? null

  const scoreG = draft?.summary && active?.summary ? goodness(active.summary.score, draft.summary.score) : null

  const hoursSet = new Set([...(draft?.fleetByHour ?? []), ...(active?.fleetByHour ?? [])].map(h => h.hour))
  const chartData = [...hoursSet].sort((a, b) => a - b).map(hour => ({
    hourLabel: hourLabel(hour),
    draft:     draft?.fleetByHour.find(h => h.hour === hour)?.fleet ?? 0,
    active:    active ? (active.fleetByHour.find(h => h.hour === hour)?.fleet ?? 0) : undefined,
  }))

  return (
    <div className="h-full flex flex-col bg-background text-foreground overflow-hidden plan-summary-chart">
      <style>{`
        .plan-summary-chart { --series-plano: #2a78d6; --series-atual: #d9861f; --series-oferta: #2a78d6; --series-demanda: #d9861f; }
        .dark .plan-summary-chart { --series-plano: #3987e5; --series-atual: #e5a13a; --series-oferta: #3987e5; --series-demanda: #e5a13a; }
      `}</style>

      {/* status bar: switcher + status badge + back */}
      <div className="flex items-center gap-2 px-5 pt-3 border-b border-border shrink-0 pb-3">
        {switcher}
        {draft && (
          <span className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full font-semibold border',
            draft.planStatus === 'ACTIVE'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
              : 'bg-muted/60 text-muted-foreground border-border',
          )}>
            <span className={cn('w-1.5 h-1.5 rounded-full', draft.planStatus === 'ACTIVE' ? 'bg-emerald-500' : 'bg-muted-foreground')} />
            {PLAN_STATUS_LABEL[draft.planStatus].toUpperCase()}
          </span>
        )}
        <button
          onClick={onClose}
          title="Voltar ao Gantt"
          className="ml-auto p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <Icons.X className="w-4 h-4" />
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center p-10 text-sm text-destructive">
          Erro ao carregar resumo do plano
        </div>
      ) : isLoading || !data || !draft ? (
        <div className="flex-1 flex items-center justify-center p-10 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1400px] mx-auto space-y-5">

            {hasPendingChanges && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25">
                <Icons.AlertTriangle className="w-4 h-4 shrink-0" />
                Alterações pendentes não refletidas — o resumo mostra o plano salvo.
              </div>
            )}

            {!draft.summary && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm bg-muted/40 text-muted-foreground border-border">
                <Icons.Info className="w-4 h-4 shrink-0" />
                Este plano ainda não foi calculado — salve ou valide o plano para gerar o resumo.
              </div>
            )}

            {/* summary cards — same "Atual → este plano" layout as the line summary */}
            <div className="grid gap-4 items-stretch grid-cols-1 lg:grid-cols-[1fr_48px_1fr]">
              {hasReference ? (
                <div className="bg-muted/30 border border-border rounded-xl p-5 space-y-3">
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Atual</span>
                  {active ? (
                    <CardBody o={active} />
                  ) : (
                    <p className="text-sm text-muted-foreground py-2">Nenhum plano ativo para este escopo/dia ainda.</p>
                  )}
                </div>
              ) : (
                <div className="bg-muted/30 border border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center text-center gap-2 min-h-[160px]">
                  <Icons.CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-sm font-medium text-foreground/80">Este já é o plano ativo</p>
                  <p className="text-xs text-muted-foreground">Não há uma versão anterior para comparar.</p>
                </div>
              )}

              <div className="flex lg:flex-col items-center justify-center gap-2 py-6">
                <div className="flex-1 h-px lg:w-px lg:h-auto bg-border" />
                <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
                  <Icons.ArrowRight className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 h-px lg:w-px lg:h-auto bg-border" />
              </div>

              <div className={cn('bg-primary/5 border border-primary/30 rounded-xl p-5 space-y-3', hasReference && 'shadow-[0_0_32px_hsl(var(--primary)/0.08)]')}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest text-primary">{PLAN_STATUS_LABEL[draft.planStatus]}</span>
                  {scoreG && !scoreG.neutral && <DeltaPill g={scoreG} />}
                </div>
                <CardBody o={draft} primary reference={active} />
              </div>
            </div>

            {/* fleet in a trip per hour */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-5">
                <h3 className="font-semibold text-sm">Frota em operação por hora</h3>
                <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'var(--series-plano)' }} />
                    {PLAN_STATUS_LABEL[draft.planStatus]}
                  </span>
                  {active && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-0.5 rounded inline-block" style={{ background: 'var(--series-atual)' }} />
                      Atual
                    </span>
                  )}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="hourLabel" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                  <Tooltip content={<HourTooltip />} />
                  <Bar dataKey="draft" name={PLAN_STATUS_LABEL[draft.planStatus]} fill="var(--series-plano)" fillOpacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={26} />
                  {active && (
                    <Line dataKey="active" name="Atual" stroke="var(--series-atual)" strokeWidth={2} dot={{ r: 3, fill: 'var(--series-atual)' }} activeDot={{ r: 5 }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* supply × demand per hour, every line with demand together */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-5">
                <h3 className="font-semibold text-sm">Oferta × Demanda por hora</h3>
                <span className="text-xs text-muted-foreground">
                  demanda de {draft.demandLines} de {draft.lineCount} {draft.lineCount === 1 ? 'linha' : 'linhas'}
                </span>
                <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'var(--series-oferta)' }} />
                    Oferta
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 rounded inline-block" style={{ background: 'var(--series-demanda)' }} />
                    Demanda
                  </span>
                </div>
              </div>
              {draft.demandLines === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">Nenhuma linha do plano tem demanda cadastrada para este tipo de dia.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={draft.supplyDemandByHour.map(h => ({ ...h, hourLabel: hourLabel(h.hour) }))} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="hourLabel" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      axisLine={false} tickLine={false}
                      tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                      width={38}
                    />
                    <Tooltip content={<HourTooltip />} />
                    <Bar dataKey="supply" name="Oferta (cap.)" fill="var(--series-oferta)" fillOpacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={26} />
                    <Line dataKey="demand" name="Demanda" stroke="var(--series-demanda)" strokeWidth={2} dot={{ r: 3, fill: 'var(--series-demanda)' }} activeDot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* metrics table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-5 py-2.5 text-xs text-muted-foreground font-medium w-[40%]">Indicador</th>
                      {hasReference && <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Atual</th>}
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">{PLAN_STATUS_LABEL[draft.planStatus]}</th>
                      {hasReference && <th className="text-right px-5 py-2.5 text-xs text-muted-foreground font-medium">Variação</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map(cat => (
                      <Fragment key={cat}>
                        <tr className="bg-muted/30 border-y border-border/60">
                          <td colSpan={hasReference ? 4 : 2} className="px-5 py-2">
                            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{cat}</span>
                          </td>
                        </tr>
                        {METRICS.filter(m => m.cat === cat).map(m => {
                          const p = m.get(draft)
                          const a = active ? m.get(active) : null
                          return (
                            <tr key={m.label} className="border-b border-border/40 hover:bg-row-hover transition-colors">
                              <td className="px-5 py-2.5">
                                <span className="text-foreground/80">{m.label}</span>
                                {m.band && <span className="text-muted-foreground ml-1.5 text-xs">({fmtBand(data.peakBands[m.band])})</span>}
                                {m.unit && <span className="text-muted-foreground ml-1.5 text-xs">({m.unit})</span>}
                              </td>
                              {hasReference && (
                                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground text-sm">{a != null ? m.fmt(a) : '—'}</td>
                              )}
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground text-sm">{p != null ? m.fmt(p) : '—'}</td>
                              {hasReference && (
                                <td className="px-5 py-2.5 text-right"><DeltaPill g={goodness(a, p, m.inverse, m.points)} /></td>
                              )}
                            </tr>
                          )
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* breakdowns */}
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
              <BreakdownTable title="Por garagem"         icon={<Icons.Warehouse className="w-4 h-4 text-primary" />} draft={draft.byDepot}       active={active?.byDepot ?? null} />
              <BreakdownTable title="Por tipo de veículo" icon={<Icons.Bus className="w-4 h-4 text-primary" />}       draft={draft.byVehicleType} active={active?.byVehicleType ?? null} />
              <BreakdownTable title="Por empresa"         icon={<Icons.Building2 className="w-4 h-4 text-primary" />} draft={draft.byBranch}      active={active?.byBranch ?? null} />
            </div>

            {/* pending items — this plan only */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <PendingCard label="Carros com problemas"  value={draft.issueBlocks}  tone="amber" />
              <PendingCard label="Carros desatualizados" value={draft.staleBlocks}  tone="red" />
              <PendingCard label="Linhas divergentes da OSO" value={draft.driftedLines} tone="amber" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CardBody({ o, primary, reference }: { o: PlanOverview; primary?: boolean; reference?: PlanOverview | null }) {
  const s = o.summary
  const r = reference?.summary ?? null
  const g = (a: number | null | undefined, p: number | null | undefined, inverse?: boolean, points?: boolean) =>
    reference ? goodness(a ?? null, p ?? null, inverse, points) : null
  const idle  = (x: VehiclePlanSummary | null) => x && x.totalKm > 0 ? (x.deadrunKm / x.totalKm) * 100 : null
  return (
    <>
      <div>
        <p className={cn('font-bold text-4xl leading-none tracking-tight tabular-nums', primary ? 'text-primary' : 'text-foreground')}>
          {(s?.score ?? 0).toLocaleString('pt-BR')}
        </p>
        <p className="text-sm text-muted-foreground mt-1.5">score do plano</p>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Stat label="Frota"        value={`${s?.fleetCount ?? 0} veíc.`}                                 goodness={g(r?.fleetCount, s?.fleetCount, true)} />
        <Stat label="Viagens"      value={int(o.tripCount)}                                              goodness={g(reference?.tripCount, o.tripCount)} />
        <Stat label="Km total"     value={`${dec(s?.totalKm ?? 0)} km`}                                  goodness={g(r?.totalKm, s?.totalKm, true)} />
        <Stat label="Ociosidade"   value={idle(s) != null ? `${dec(idle(s)!)}%` : '—'}                   goodness={g(idle(r), idle(s), true, true)} />
        <Stat label="Horas-veículo" value={`${dec((s?.totalMinutes ?? 0) / 60)} h`}                      goodness={g(hours(r?.totalMinutes), hours(s?.totalMinutes), true)} />
        <Stat label="Linhas"       value={int(o.lineCount)} />
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border">
        {([
          { label: 'Pico manhã', p: s?.peakFleetMorning,   a: r?.peakFleetMorning },
          { label: 'Entrepico',  p: s?.peakFleetOffPeak,   a: r?.peakFleetOffPeak },
          { label: 'Pico tarde', p: s?.peakFleetAfternoon, a: r?.peakFleetAfternoon },
        ]).map(item => {
          const gd = g(item.a, item.p, true)
          return (
            <div key={item.label} className="text-center">
              <p className="font-semibold text-base text-foreground/80 tabular-nums">{item.p ?? '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Frota {item.label.toLowerCase()}</p>
              {gd && !gd.neutral && (
                <span className={cn('text-[9px] font-semibold tabular-nums', gd.good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                  {fmtDelta(gd)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function BreakdownTable({ title, icon, draft, active }: { title: string; icon: ReactNode; draft: Bucket[]; active: Bucket[] | null }) {
  const activeByKey = new Map((active ?? []).map(b => [b.key, b]))
  // keys only the active plan has still show up, with this plan's side at 0
  const rows = [
    ...draft.map(b => ({ ...b, activeFleet: activeByKey.get(b.key)?.fleet ?? 0 })),
    ...(active ?? []).filter(b => !draft.some(d => d.key === b.key)).map(b => ({ ...b, fleet: 0, km: 0, activeFleet: b.fleet })),
  ]
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        {icon}
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Sem carros.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-5 py-2 text-xs text-muted-foreground font-medium"></th>
              {active && <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">Atual</th>}
              <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">Frota</th>
              <th className="text-right px-5 py-2 text-xs text-muted-foreground font-medium">Km</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(b => {
              const diff = b.fleet - b.activeFleet
              return (
                <tr key={b.key} className="border-b border-border/40 last:border-b-0">
                  <td className="px-5 py-2 text-foreground/80 truncate max-w-[12rem]" title={b.label}>{b.label}</td>
                  {active && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{b.activeFleet}</td>}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {b.fleet}
                    {active && diff !== 0 && (
                      <span className={cn('ml-1.5 text-[10px] font-semibold', diff < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">{int(b.km)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PendingCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'red' }) {
  return (
    <div className={cn(
      'border rounded-xl px-4 py-3 flex items-center justify-between',
      value === 0
        ? 'bg-card border-border'
        : tone === 'red'
          ? 'bg-red-500/[0.07] border-red-500/20'
          : 'bg-amber-500/[0.07] border-amber-500/20',
    )}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn(
        'font-bold text-xl tabular-nums',
        value === 0 ? 'text-foreground/60' : tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400',
      )}>
        {value}
      </span>
    </div>
  )
}
