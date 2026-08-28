'use client'

import { useEffect, useState, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'
import { Select } from '@/components/ui/select'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import type { VehiclePlanGanttData } from '../views/vehicles.view'

interface LineComparisonSummary {
  fleetSize:             number
  dailyTrips:             number
  operatingHours:         number
  dailyKm:                number
  avgSpeed:               number
  occupancyIndex:         number
  serviceFrequencyIndex:  number
  peakPassengersPerHour:  number
  score:                  number
}

interface LineComparisonSide {
  planId:             string
  lineScheduleStatus: string | null
  summary:            LineComparisonSummary | null
}

interface LineComparisonResponse {
  line: { id: string; code: string; name: string }
  operation: {
    extensionKm:           number | null
    peakMorningInterval:   number | null
    peakAfternoonInterval: number | null
    offPeakInterval:       number | null
  }
  draft:  LineComparisonSide & { planStatus: 'DRAFT' | 'ACTIVE' }
  active: LineComparisonSide | null
}

interface HourRow {
  hour:       number
  demand:     number
  supply:     number
  loadFactor: number
  deficit:    number
  isPeak:     boolean
}

interface HourlyResponse {
  hours: HourRow[]
  kpis: {
    totalDailyDemand:    number
    totalDailySupply:    number
    avgLoadFactor:       number
    saturatedHoursCount: number
    totalUnmetDemand:    number
    peakLoadFactor:      number
    avgCapacity:         number
    renewalIndex:        number
  }
}

interface LineOption {
  lineId: string
  code:   string
  name:   string
}

interface Props {
  planId:  string
  lineIds: string[]
  lines:   LineOption[]
  onClose: () => void
  // persisted blocks merged with whatever pending changes/deletes/moves/adds are held
  // in the Gantt editor (useGanttEditor's mergedPlottedData) — used to preview a line's
  // score with its current in-progress edits before persisting them. See
  // docs/proposal/vehicle_plan_score_formula_v1.md.
  mergedPlottedData?: VehiclePlanGanttData | null
  // pendingCount > 0 from useGanttEditor — any unsaved edit anywhere in the plan means
  // the persisted VehiclePlanLine.summary may be stale, so the preview (computed from
  // the current merged state) takes priority over it while edits are pending.
  hasPendingChanges?: boolean
}

type RowValues = LineComparisonResponse['operation'] & Partial<LineComparisonSummary>

const NULL_SUMMARY: Partial<LineComparisonSummary> = {}

function rowValues(operation: LineComparisonResponse['operation'], summary: LineComparisonSummary | null): RowValues {
  return { ...operation, ...(summary ?? NULL_SUMMARY) }
}

function pctChange(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100
  return ((b - a) / a) * 100
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

interface MetricRowDef {
  label:    string
  unit:     string
  key:      keyof RowValues
  fmt:      (v: number) => string
  inverse?: boolean
  cat:      string
}

const METRICS: MetricRowDef[] = [
  { label: 'Extensão',                          unit: 'km',       key: 'extensionKm',           fmt: v => v.toFixed(1),                                        cat: 'Operação' },
  { label: 'Intervalo pico manhã',               unit: 'min',      key: 'peakMorningInterval',   fmt: v => String(v), inverse: true,                            cat: 'Operação' },
  { label: 'Intervalo pico tarde',               unit: 'min',      key: 'peakAfternoonInterval', fmt: v => String(v), inverse: true,                            cat: 'Operação' },
  { label: 'Intervalo entrepico',                unit: 'min',      key: 'offPeakInterval',       fmt: v => String(v), inverse: true,                            cat: 'Operação' },
  { label: 'Frota',                              unit: 'veículos', key: 'fleetSize',             fmt: v => v.toLocaleString('pt-BR'), inverse: true,          cat: 'Oferta e Demanda' },
  { label: 'Viagens',                            unit: 'viag/dia', key: 'dailyTrips',            fmt: v => v.toLocaleString('pt-BR'),                           cat: 'Oferta e Demanda' },
  { label: 'Horas operacionais',                 unit: 'h',        key: 'operatingHours',        fmt: v => v.toFixed(1), inverse: true,                         cat: 'Oferta e Demanda' },
  { label: 'Quilômetros produzidos',             unit: 'km/dia',   key: 'dailyKm',               fmt: v => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }), inverse: true, cat: 'Oferta e Demanda' },
  { label: 'Pico de passageiros',                unit: 'pax/h',    key: 'peakPassengersPerHour', fmt: v => v.toLocaleString('pt-BR'),                           cat: 'Oferta e Demanda' },
  { label: 'Velocidade média',                   unit: 'km/h',     key: 'avgSpeed',              fmt: v => v.toFixed(1),                                        cat: 'Qualidade de Serviço' },
  { label: 'Índice de Ocupação (IOC)',           unit: '',         key: 'occupancyIndex',        fmt: v => v.toFixed(2), inverse: true,                         cat: 'Qualidade de Serviço' },
  { label: 'Índice de Freq. de Serviço (IFS)',   unit: 'viag/h',   key: 'serviceFrequencyIndex', fmt: v => v.toFixed(2),                                        cat: 'Qualidade de Serviço' },
]

const CATEGORIES = ['Operação', 'Oferta e Demanda', 'Qualidade de Serviço']

const METRIC_INVERSE: Partial<Record<keyof RowValues, boolean>> = Object.fromEntries(
  METRICS.map(m => [m.key, !!m.inverse]),
)

interface Goodness {
  delta:   number
  neutral: boolean
  good:    boolean
}

// "Maior melhor" vs "menor melhor" is driven by each metric's `inverse` flag (the same
// one behind the comparison table) instead of the raw sign of the delta — e.g. a shorter
// interval or a lower IOC is an improvement even though the % change is negative. A key
// with no entry in METRICS (e.g. 'score') defaults to inverse: false — higher is better.
function goodnessFor(key: keyof RowValues, a: number | null | undefined, p: number | null | undefined): Goodness | null {
  if (a == null || p == null) return null
  const delta   = pctChange(a, p)
  const neutral = Math.abs(delta) < 0.5
  const inverse = !!METRIC_INVERSE[key]
  return { delta, neutral, good: !neutral && (inverse ? delta < 0 : delta > 0) }
}

const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  DRAFT:      'Rascunho',
  APPROVED:   'Aprovado',
  SUPERSEDED: 'Substituído',
  ARCHIVED:   'Arquivado',
}

function ScheduleBadge({ status }: { status: string | null }) {
  const label = status ? (SCHEDULE_STATUS_LABEL[status] ?? status) : 'Em análise'
  const success = status === 'APPROVED'
  return (
    <span className={cn(
      'text-xs px-2 py-0.5 rounded-full border font-medium',
      success ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' : 'bg-muted/60 text-muted-foreground border-border',
    )}>
      {label}
    </span>
  )
}

function lfColor(v: number): string {
  if (v > 1.0)  return 'var(--sim-lf-critical)'
  if (v > 0.9)  return 'var(--sim-lf-high)'
  if (v > 0.75) return 'var(--sim-lf-moderate)'
  return 'var(--sim-lf-ok)'
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-2xl">
      <p className="font-semibold text-primary mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 leading-5">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="tabular-nums text-foreground">{p.value?.toLocaleString('pt-BR')}</span>
        </div>
      ))}
    </div>
  )
}

function LFTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const lf = payload[0]?.value ?? 0
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-2xl">
      <p className="font-semibold text-primary mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-sm" style={{ background: lfColor(lf) }} />
        <span className="text-muted-foreground">Fator Ocup.:</span>
        <span className="tabular-nums font-semibold" style={{ color: lfColor(lf) }}>{lf.toFixed(2)}</span>
      </div>
    </div>
  )
}

const TABS = [
  { key: 'comparativo',     label: 'Comparativo',     icon: 'BarChart2' as const },
  { key: 'oferta-demanda',  label: 'Oferta · Demanda', icon: 'SlidersHorizontal' as const },
]

export function LineSummaryView({ planId, lineIds, lines, onClose, mergedPlottedData, hasPendingChanges }: Props) {
  useShortcutContext('summary')

  const [activeLineId, setActiveLineId] = useState(lineIds[0])
  const [tab, setTab] = useState<'comparativo' | 'oferta-demanda'>('comparativo')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useShortcut('alt+[', () => {
    const idx = TABS.findIndex(t => t.key === tab)
    if (idx > 0) setTab(TABS[idx - 1].key as typeof tab)
  }, { context: 'summary', desc: 'Aba anterior' })

  useShortcut('alt+]', () => {
    const idx = TABS.findIndex(t => t.key === tab)
    if (idx < TABS.length - 1) setTab(TABS[idx + 1].key as typeof tab)
  }, { context: 'summary', desc: 'Próxima aba' })

  const { data, isLoading, error } = useQuery<LineComparisonResponse>({
    queryKey: ['transit', 'vehicle-plan', planId, 'lines', activeLineId, 'comparison'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/lines/${activeLineId}/comparison`)
      if (!res.ok) throw new Error('Erro ao carregar comparativo')
      return res.json()
    },
  })

  // Need the live preview when either: draft.summary is null (line not persisted in
  // this plan yet / no trips), or there's ANY unsaved edit in the plan — the persisted
  // VehiclePlanLine.summary only reflects the last recalculate(), so an unsaved trip
  // edit/delete/move on this line wouldn't otherwise show up until Save. Not scoped to
  // just the active line (cheap to recompute, would just return the same number if
  // this particular line has no pending edits). Fired once on modal open / tab switch,
  // not per-edit — pendingCount isn't in the queryKey.
  const needsPreview = !!data && (data.draft.summary === null || !!hasPendingChanges)

  // Shared by both preview endpoints — the merged (persisted + pending) trips of the
  // active line, grouped by block, in the shape preview-score/preview-hourly expect.
  function buildPreviewBlocks() {
    return (mergedPlottedData?.blocks ?? [])
      .map(b => ({
        id:          b.id,
        vehicleType: b.vehicleType,
        trips: b.blockTrips
          .filter(bt => bt.trip.route.line.id === activeLineId)
          .map(bt => ({
            direction:             bt.trip.route.direction,
            originLocalityId:      bt.trip.route.originLocality.id,
            destinationLocalityId: bt.trip.route.destinationLocality.id,
            departureMinutes:      bt.trip.departureMinutes,
            arrivalMinutes:        bt.trip.arrivalMinutes,
          })),
      }))
      .filter(b => b.trips.length > 0)
  }

  const { data: preview, isLoading: previewLoading } = useQuery<LineComparisonSummary>({
    queryKey: ['transit', 'vehicle-plan', planId, 'lines', activeLineId, 'preview-score'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/lines/${activeLineId}/preview-score`, {
        method: 'POST',
        body:   JSON.stringify({ blocks: buildPreviewBlocks() }),
      })
      if (!res.ok) throw new Error('Erro ao calcular prévia')
      return res.json()
    },
    enabled: needsPreview,
  })

  const { data: hourly, isLoading: hourlyLoading } = useQuery<HourlyResponse>({
    queryKey: ['transit', 'vehicle-plan', planId, 'lines', activeLineId, 'hourly', needsPreview],
    queryFn:  async () => {
      const res = needsPreview
        ? await apiFetch(`/transit/vehicle-plan/${planId}/lines/${activeLineId}/preview-hourly`, {
            method: 'POST',
            body:   JSON.stringify({ blocks: buildPreviewBlocks() }),
          })
        : await apiFetch(`/transit/vehicle-plan/${planId}/lines/${activeLineId}/hourly`)
      if (!res.ok) throw new Error('Erro ao carregar oferta × demanda')
      return res.json()
    },
    enabled: tab === 'oferta-demanda' && data !== undefined,
  })

  const hasReference   = data && data.draft.planStatus !== 'ACTIVE'
  // preview wins over the persisted summary whenever it's needed (null summary, or
  // unsaved edits pending) — it's the only one guaranteed to reflect current state
  const proposta       = data && rowValues(data.operation, needsPreview ? (preview ?? null) : data.draft.summary)
  const atual          = data && hasReference ? rowValues(data.operation, data.active?.summary ?? null) : null
  const previewPending = needsPreview && (previewLoading || !preview)
  const scoreDelta     = atual && proposta ? goodnessFor('score', atual.score, proposta.score) : null

  const chartData = hourly?.hours.map(h => ({ ...h, hourLabel: `${String(h.hour).padStart(2, '0')}h` })) ?? []
  const domainMax = chartData.length > 0 ? Math.min(2.0, Math.max(...chartData.map(d => d.loadFactor)) + 0.15) : 2.0
  const peakSupplyHour = chartData.reduce<typeof chartData[number] | null>(
    (max, h) => (!max || h.supply > max.supply) ? h : max, null,
  )

  const lfStatus =
    !hourly ? '' :
    hourly.kpis.avgLoadFactor > 0.9  ? 'Saturado' :
    hourly.kpis.avgLoadFactor > 0.75 ? 'Elevado' :
    hourly.kpis.avgLoadFactor > 0.55 ? 'Adequado' : 'Subutilizado'

  const lfStatusColor =
    !hourly ? '' :
    hourly.kpis.avgLoadFactor > 0.9  ? 'text-red-600 dark:text-red-400' :
    hourly.kpis.avgLoadFactor > 0.75 ? 'text-orange-600 dark:text-orange-400' :
    hourly.kpis.avgLoadFactor > 0.55 ? 'text-emerald-600 dark:text-emerald-400' : 'text-yellow-600 dark:text-yellow-400'

  return (
    <div className="h-full flex flex-col bg-background text-foreground overflow-hidden">

        {/* status bar: line selector + status badge + back */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-border shrink-0 pb-3">
          <Select
            size="sm"
            value={activeLineId}
            onChange={e => setActiveLineId(e.target.value)}
            wrapperClassName="w-auto"
            className="w-auto"
          >
            {lines.map(l => (
              <option key={l.lineId} value={l.lineId}>{l.code} — {l.name}</option>
            ))}
          </Select>
          {data && (
            <span className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full font-semibold border',
              data.draft.planStatus === 'ACTIVE'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                : 'bg-muted/60 text-muted-foreground border-border',
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full', data.draft.planStatus === 'ACTIVE' ? 'bg-emerald-500' : 'bg-muted-foreground')} />
              {data.draft.planStatus === 'ACTIVE' ? 'ATIVO' : 'RASCUNHO'}
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

        {/* tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-border shrink-0">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as typeof tab)}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t.key
                  ? 'border-ring text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="flex-1 flex items-center justify-center p-10 text-sm text-destructive">
            Erro ao carregar comparativo
          </div>
        ) : isLoading || !data || !proposta || previewPending ? (
          <div className="flex-1 flex items-center justify-center p-10 text-sm text-muted-foreground">
            {previewPending ? 'Calculando prévia…' : 'Carregando…'}
          </div>
        ) : tab === 'comparativo' ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[1400px] mx-auto space-y-5">

            {/* summary cards */}
            <div className={cn('grid gap-4 items-stretch', hasReference ? 'grid-cols-1 lg:grid-cols-[1fr_48px_1fr]' : 'grid-cols-1 max-w-sm mx-auto')}>
              {hasReference && (
                <div className="bg-muted/30 border border-border rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Atual</span>
                    <ScheduleBadge status={data.active?.lineScheduleStatus ?? null} />
                  </div>
                  {data.active ? (
                    <SummaryCardBody v={atual!} />
                  ) : (
                    <p className="text-sm text-muted-foreground py-2">Nenhum plano ativo para esta linha/dia ainda.</p>
                  )}
                </div>
              )}

              {hasReference && (
                <div className="flex lg:flex-col items-center justify-center gap-2 py-6">
                  <div className="flex-1 h-px lg:w-px lg:h-auto bg-border" />
                  <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
                    <Icons.ArrowRight className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 h-px lg:w-px lg:h-auto bg-border" />
                </div>
              )}

              <div className={cn('bg-primary/5 border border-primary/30 rounded-xl p-5 space-y-3', hasReference && 'shadow-[0_0_32px_hsl(var(--primary)/0.08)]')}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest text-primary">
                    {data.draft.planStatus === 'ACTIVE' ? 'Ativo' : 'Rascunho'}
                  </span>
                  <span className="flex items-center gap-2">
                    {scoreDelta && !scoreDelta.neutral && (
                      <span className={cn(
                        'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border',
                        scoreDelta.good
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                          : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25',
                      )}>
                        {scoreDelta.good ? <Icons.ArrowUp className="w-3 h-3" /> : <Icons.ArrowDown className="w-3 h-3" />}
                        {fmtPct(scoreDelta.delta)}
                      </span>
                    )}
                    {needsPreview ? (
                      <span
                        title={data.draft.summary === null
                          ? 'Linha ainda não salva neste plano — números calculados a partir do que está em edição, sem persistir.'
                          : 'Há edições não salvas no plano — números recalculados a partir do estado atual em edição, ainda não persistidos.'}
                        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25"
                      >
                        <Icons.Info className="w-3 h-3" />
                        Prévia (não salvo)
                      </span>
                    ) : (
                      <ScheduleBadge status={data.draft.lineScheduleStatus} />
                    )}
                  </span>
                </div>
                <SummaryCardBody v={proposta} primary reference={atual} />
              </div>
            </div>

            {/* metrics table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-5 py-2.5 text-xs text-muted-foreground font-medium w-[40%]">Indicador</th>
                      {hasReference && <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Atual</th>}
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">{data.draft.planStatus === 'ACTIVE' ? 'Ativo' : 'Rascunho'}</th>
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
                          const p = proposta[m.key]
                          const a = atual?.[m.key]
                          const hasA = a != null
                          const delta = hasA && p != null ? pctChange(a, p) : null
                          const neutral = delta == null || Math.abs(delta) < 0.5
                          const good = delta == null || neutral ? null : (m.inverse ? delta < 0 : delta > 0)
                          return (
                            <tr key={m.key} className="border-b border-border/40 hover:bg-row-hover transition-colors">
                              <td className="px-5 py-2.5">
                                <span className="text-foreground/80">{m.label}</span>
                                {m.unit && <span className="text-muted-foreground ml-1.5 text-xs">({m.unit})</span>}
                              </td>
                              {hasReference && (
                                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground text-sm">
                                  {hasA ? m.fmt(a) : '—'}
                                </td>
                              )}
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground text-sm">
                                {p != null ? m.fmt(p) : '—'}
                              </td>
                              {hasReference && (
                                <td className="px-5 py-2.5 text-right">
                                  {delta == null ? (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">—</span>
                                  ) : (
                                    <span className={cn(
                                      'text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 font-semibold border',
                                      neutral
                                        ? 'bg-muted/60 text-muted-foreground border-border'
                                        : good
                                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                          : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
                                    )}>
                                      {!neutral && (good ? <Icons.ArrowUp className="w-3 h-3" /> : <Icons.ArrowDown className="w-3 h-3" />)}
                                      {fmtPct(delta)}
                                    </span>
                                  )}
                                </td>
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
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 line-summary-chart">
            <style>{`
              .line-summary-chart { --series-oferta: #2a78d6; --series-demanda: #d9861f; }
              .dark .line-summary-chart { --series-oferta: #3987e5; --series-demanda: #e5a13a; }
              .line-summary-chart { --sim-lf-ok: #22c55e; --sim-lf-moderate: #d9a015; --sim-lf-high: #e2701a; --sim-lf-critical: #ef4444; }
              .dark .line-summary-chart { --sim-lf-ok: #34d067; --sim-lf-moderate: #eab308; --sim-lf-high: #f97316; --sim-lf-critical: #f87171; }
            `}</style>

            {hourlyLoading || !hourly ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Carregando…</div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-6 max-w-[1400px] mx-auto">
                {/* Params panel */}
                <div className="w-full lg:w-68 shrink-0 space-y-4">
                  <div className="bg-card border border-border rounded-xl p-5 space-y-5">
                    <div className="flex items-center gap-2">
                      <Icons.SlidersHorizontal className="w-4 h-4 text-primary" />
                      <h3 className="font-semibold text-sm">Parâmetros</h3>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/50 rounded-lg px-2.5 py-2.5 text-center">
                        <p className="font-semibold text-sm text-primary tabular-nums">{hourly.kpis.avgCapacity} pax</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Capacidade média</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg px-2.5 py-2.5 text-center">
                        <p className="font-semibold text-sm text-primary tabular-nums">{hourly.kpis.renewalIndex}%</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Renovação</p>
                      </div>
                    </div>

                    <div className="bg-primary/5 border border-primary/15 rounded-lg p-3.5 space-y-1">
                      <p className="text-xs text-muted-foreground">Oferta calculada no pico</p>
                      <p className="font-bold text-xl text-primary leading-none tabular-nums">
                        {(peakSupplyHour?.supply ?? 0).toLocaleString('pt-BR')} pax/h
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        pico às {peakSupplyHour?.hourLabel ?? '—'}
                      </p>
                    </div>

                    <div className="space-y-2 pt-1 border-t border-border">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground pt-1">
                        Fator de Ocupação (FOC)
                      </p>
                      {[
                        { color: 'var(--sim-lf-ok)', label: 'FOC < 0.75 — Confortável' },
                        { color: 'var(--sim-lf-moderate)', label: 'FOC 0.75–0.90 — Moderado' },
                        { color: 'var(--sim-lf-high)', label: 'FOC 0.90–1.0 — Elevado' },
                        { color: 'var(--sim-lf-critical)', label: 'FOC > 1.0 — Saturado' },
                      ].map(item => (
                        <div key={item.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: item.color }} />
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Charts & KPIs */}
                <div className="flex-1 min-w-0 space-y-5">
                {/* KPI cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'Demanda total diária', value: hourly.kpis.totalDailyDemand.toLocaleString('pt-BR'),
                      sub: 'pax/dia (real)', icon: <Icons.Users className="w-4 h-4" />,
                      color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/8 border-blue-500/15',
                    },
                    {
                      label: 'Fator de Ocupação Médio', value: hourly.kpis.avgLoadFactor.toFixed(2),
                      sub: lfStatus, icon: <Icons.Gauge className="w-4 h-4" />,
                      color: lfStatusColor, bg: 'bg-card border-border',
                    },
                    {
                      label: 'Horas com Saturação', value: String(hourly.kpis.saturatedHoursCount),
                      sub: hourly.kpis.saturatedHoursCount === 0 ? 'nenhuma hora saturada' : `hora${hourly.kpis.saturatedHoursCount > 1 ? 's' : ''} com excesso`,
                      icon: <Icons.AlertTriangle className="w-4 h-4" />,
                      color: hourly.kpis.saturatedHoursCount === 0 ? 'text-emerald-600 dark:text-emerald-400' : hourly.kpis.saturatedHoursCount <= 2 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400',
                      bg: hourly.kpis.saturatedHoursCount === 0 ? 'bg-emerald-500/8 border-emerald-500/15' : 'bg-card border-border',
                    },
                    {
                      label: 'Passageiros não atendidos', value: hourly.kpis.totalUnmetDemand.toLocaleString('pt-BR'),
                      sub: hourly.kpis.totalUnmetDemand === 0 ? 'cobertura total' : 'além da capacidade ofertada',
                      icon: <Icons.Zap className="w-4 h-4" />,
                      color: hourly.kpis.totalUnmetDemand === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                      bg: hourly.kpis.totalUnmetDemand === 0 ? 'bg-emerald-500/8 border-emerald-500/15' : 'bg-red-500/8 border-red-500/15',
                    },
                  ].map(kpi => (
                    <div key={kpi.label} className={cn('border rounded-xl p-4', kpi.bg)}>
                      <div className={cn('mb-2', kpi.color)}>{kpi.icon}</div>
                      <p className="font-bold text-2xl text-foreground leading-none tabular-nums">{kpi.value}</p>
                      <p className={cn('text-xs mt-1 font-medium', kpi.color)}>{kpi.sub}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-tight">{kpi.label}</p>
                    </div>
                  ))}
                </div>

                {/* Demand vs Supply chart */}
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-5">
                    <h3 className="font-semibold text-sm">Oferta × Demanda por Hora</h3>
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
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="hourLabel" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                        axisLine={false} tickLine={false}
                        tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                        width={38}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="supply" name="Oferta (cap.)" fill="var(--series-oferta)" fillOpacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={26} />
                      <Line dataKey="demand" name="Demanda" stroke="var(--series-demanda)" strokeWidth={2} dot={{ r: 4, fill: 'var(--series-demanda)' }} activeDot={{ r: 5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Load factor chart */}
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-5">
                    <h3 className="font-semibold text-sm">Fator de Ocupação por Hora</h3>
                    <span className="text-xs text-muted-foreground ml-auto">FOC = demanda / oferta</span>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="hourLabel" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                        axisLine={false} tickLine={false}
                        domain={[0, domainMax]}
                        tickFormatter={v => v.toFixed(1)}
                        width={32}
                      />
                      <Tooltip content={<LFTooltip />} />
                      <ReferenceLine y={1.0} stroke="var(--sim-lf-critical)" strokeDasharray="5 3" strokeWidth={1.5}
                        label={{ value: '100%', fill: 'var(--sim-lf-critical)', fontSize: 9, position: 'insideTopRight' }} />
                      <ReferenceLine y={0.75} stroke="var(--sim-lf-moderate)" strokeDasharray="3 3" strokeWidth={1}
                        label={{ value: '75%', fill: 'var(--sim-lf-moderate)', fontSize: 9, position: 'insideTopRight' }} />
                      <Bar dataKey="loadFactor" name="Fator Ocupação" radius={[2, 2, 0, 0]} maxBarSize={26}>
                        {chartData.map((entry, index) => (
                          <Cell key={index} fill={lfColor(entry.loadFactor)} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                </div>
              </div>
            )}
          </div>
        )}
    </div>
  )
}

function Stat({ label, value, goodness }: { label: string; value: string; goodness?: Goodness | null }) {
  const worse = !!goodness && !goodness.neutral && !goodness.good
  return (
    <div className={cn('rounded-lg px-3 py-2.5', worse ? 'bg-red-500/[0.07] border border-red-500/15' : 'bg-muted/50')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <p className="font-medium text-sm text-foreground/90 tabular-nums">{value}</p>
        {goodness && !goodness.neutral && (
          <span className={cn(
            'text-[10px] font-semibold tabular-nums shrink-0',
            goodness.good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
          )}>
            {fmtPct(goodness.delta)}
          </span>
        )}
      </div>
    </div>
  )
}

const dash = (v: number | null | undefined, fmt: (v: number) => string) => v == null ? '—' : fmt(v)

// Mirrors the prototype's summary card layout — big score number, then the same
// 6+3 stat split. `score` is on a fixed 0–9999 scale. `reference` (the "Atual" side)
// is only passed to the proposta card, driving the per-stat variation indicators.
function SummaryCardBody({ v, primary, reference }: { v: RowValues; primary?: boolean; reference?: RowValues | null }) {
  const g = (key: keyof RowValues) => reference ? goodnessFor(key, reference[key], v[key]) : null
  return (
    <>
      <div>
        <p className={cn('font-bold text-4xl leading-none tracking-tight tabular-nums', primary ? 'text-primary' : 'text-foreground')}>
          {(v.score ?? 0).toLocaleString('pt-BR')}
        </p>
        <p className="text-sm text-muted-foreground mt-1.5">score</p>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Stat label="Frota" value={`${v.fleetSize ?? 0} veíc.`} goodness={g('fleetSize')} />
        <Stat label="Operação" value={`${dash(v.operatingHours, x => x.toFixed(1))}h/dia`} goodness={g('operatingHours')} />
        <Stat label="Int. Pico Manhã" value={`${dash(v.peakMorningInterval, String)} min`} goodness={g('peakMorningInterval')} />
        <Stat label="Int. Entrepico" value={`${dash(v.offPeakInterval, String)} min`} goodness={g('offPeakInterval')} />
        <Stat label="Int. Pico Tarde" value={`${dash(v.peakAfternoonInterval, String)} min`} goodness={g('peakAfternoonInterval')} />
        <Stat label="IOC" value={dash(v.occupancyIndex, x => x.toFixed(2))} goodness={g('occupancyIndex')} />
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border">
        {([
          { key: 'dailyKm' as const,              label: 'Km/dia',   value: (v.dailyKm ?? 0).toLocaleString('pt-BR') },
          { key: 'serviceFrequencyIndex' as const, label: 'IFS',      value: dash(v.serviceFrequencyIndex, x => x.toFixed(2)) },
          { key: 'peakPassengersPerHour' as const, label: 'PPH pico', value: String(v.peakPassengersPerHour ?? 0) },
        ]).map(item => {
          const gd = g(item.key)
          return (
            <div key={item.label} className="text-center">
              <p className="font-semibold text-base text-foreground/80 tabular-nums">{item.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
              {gd && !gd.neutral && (
                <span className={cn(
                  'text-[9px] font-semibold tabular-nums',
                  gd.good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                )}>
                  {fmtPct(gd.delta)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
