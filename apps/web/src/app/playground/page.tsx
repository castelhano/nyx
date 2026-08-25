'use client'

import { useState, useMemo, Fragment } from 'react'
import {
  ComposedChart,
  BarChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts'
import { resolveIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

const Bus            = resolveIcon('Bus')
const MapPin          = resolveIcon('MapPin')
const Clock           = resolveIcon('Clock')
const BarChart2       = resolveIcon('BarChart2')
const Sliders         = resolveIcon('SlidersHorizontal')
const ChevronDown     = resolveIcon('ChevronDown')
const TrendingUp      = resolveIcon('TrendingUp')
const TrendingDown    = resolveIcon('TrendingDown')
const RotateCcw       = resolveIcon('RotateCcw')
const Users           = resolveIcon('Users')
const Gauge           = resolveIcon('Gauge')
const AlertTriangle   = resolveIcon('AlertTriangle')
const Zap             = resolveIcon('Zap')
const ArrowRight      = resolveIcon('ArrowRight')

// ── Types ────────────────────────────────────────────────────────────────────

interface LineMetrics {
  extensao_km: number
  frota: number
  viagens_dia: number
  horas_op: number
  intervalo_pico: number
  intervalo_entrepico: number
  capacidade_veiculo: number
  passageiros_dia: number
  km_dia: number
  custo_km: number
  vel_media: number
  pontualidade: number
  ifs: number
  ioc: number
  pph_pico: number
  idade_media_frota: number
}

interface TransitLine {
  id: string
  nome: string
  tipo: 'Urbano' | 'Alimentador' | 'Expresso'
  corredor: string
  atual: LineMetrics
  proposto: LineMetrics
}

interface SimRow {
  hour: string
  demand: number
  supply: number
  lf: number
  deficit: number
  isPeak: boolean
}

interface MetricRowDef {
  label: string
  unit: string
  key: keyof LineMetrics
  fmt: (v: number) => string
  inverse?: boolean
  cat: string
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

const LINES: TransitLine[] = [
  {
    id: '301',
    nome: '301 · Central ↔ Aeroporto',
    tipo: 'Expresso',
    corredor: 'Corredor Leste',
    atual: {
      extensao_km: 18.5, frota: 12, viagens_dia: 98, horas_op: 18,
      intervalo_pico: 12, intervalo_entrepico: 20, capacidade_veiculo: 70,
      passageiros_dia: 8400, km_dia: 1813, custo_km: 8.45, vel_media: 21.2,
      pontualidade: 72, ifs: 5.0, ioc: 0.82, pph_pico: 350, idade_media_frota: 7.2,
    },
    proposto: {
      extensao_km: 22.3, frota: 15, viagens_dia: 128, horas_op: 20,
      intervalo_pico: 9, intervalo_entrepico: 15, capacidade_veiculo: 80,
      passageiros_dia: 11200, km_dia: 2854, custo_km: 8.12, vel_media: 24.1,
      pontualidade: 87, ifs: 6.67, ioc: 0.72, pph_pico: 533, idade_media_frota: 2.1,
    },
  },
  {
    id: '442',
    nome: '442 · Terminal Norte ↔ Hospital Central',
    tipo: 'Urbano',
    corredor: 'Corredor Norte',
    atual: {
      extensao_km: 14.8, frota: 9, viagens_dia: 76, horas_op: 17,
      intervalo_pico: 15, intervalo_entrepico: 25, capacidade_veiculo: 70,
      passageiros_dia: 5800, km_dia: 1124, custo_km: 8.65, vel_media: 19.5,
      pontualidade: 65, ifs: 4.0, ioc: 0.89, pph_pico: 280, idade_media_frota: 9.1,
    },
    proposto: {
      extensao_km: 14.8, frota: 12, viagens_dia: 104, horas_op: 19,
      intervalo_pico: 10, intervalo_entrepico: 18, capacidade_veiculo: 80,
      passageiros_dia: 7900, km_dia: 1539, custo_km: 8.30, vel_media: 21.8,
      pontualidade: 83, ifs: 6.0, ioc: 0.75, pph_pico: 480, idade_media_frota: 1.8,
    },
  },
  {
    id: '505',
    nome: '505 · Bairro Novo ↔ Centro Histórico',
    tipo: 'Alimentador',
    corredor: 'Eixo Sul',
    atual: {
      extensao_km: 9.2, frota: 6, viagens_dia: 54, horas_op: 15,
      intervalo_pico: 18, intervalo_entrepico: 30, capacidade_veiculo: 50,
      passageiros_dia: 2900, km_dia: 496, custo_km: 9.10, vel_media: 17.8,
      pontualidade: 58, ifs: 3.33, ioc: 0.91, pph_pico: 167, idade_media_frota: 11.5,
    },
    proposto: {
      extensao_km: 11.4, frota: 8, viagens_dia: 72, horas_op: 17,
      intervalo_pico: 12, intervalo_entrepico: 20, capacidade_veiculo: 60,
      passageiros_dia: 4100, km_dia: 820, custo_km: 8.75, vel_media: 20.3,
      pontualidade: 80, ifs: 5.0, ioc: 0.78, pph_pico: 300, idade_media_frota: 2.5,
    },
  },
]

// Percentual da demanda diária total por hora (soma = 1.0)
const DEMAND_PROFILE = [
  { hour: '04h', pct: 0.010 }, { hour: '05h', pct: 0.022 },
  { hour: '06h', pct: 0.055 }, { hour: '07h', pct: 0.095 },
  { hour: '08h', pct: 0.105 }, { hour: '09h', pct: 0.070 },
  { hour: '10h', pct: 0.045 }, { hour: '11h', pct: 0.035 },
  { hour: '12h', pct: 0.042 }, { hour: '13h', pct: 0.038 },
  { hour: '14h', pct: 0.034 }, { hour: '15h', pct: 0.040 },
  { hour: '16h', pct: 0.055 }, { hour: '17h', pct: 0.085 },
  { hour: '18h', pct: 0.105 }, { hour: '19h', pct: 0.075 },
  { hour: '20h', pct: 0.046 }, { hour: '21h', pct: 0.022 },
  { hour: '22h', pct: 0.013 }, { hour: '23h', pct: 0.008 },
]

const PEAK_HOURS = new Set([6, 7, 8, 16, 17, 18])

const METRICS: MetricRowDef[] = [
  { label: 'Extensão do itinerário', unit: 'km', key: 'extensao_km', fmt: v => v.toFixed(1), cat: 'Operação' },
  { label: 'Frota necessária', unit: 'veículos', key: 'frota', fmt: v => v.toLocaleString('pt-BR'), cat: 'Operação' },
  { label: 'Viagens por dia', unit: 'viag/dia', key: 'viagens_dia', fmt: v => v.toLocaleString('pt-BR'), cat: 'Operação' },
  { label: 'Horas de operação', unit: 'h', key: 'horas_op', fmt: v => String(v), cat: 'Operação' },
  { label: 'Intervalo de pico', unit: 'min', key: 'intervalo_pico', fmt: v => String(v), inverse: true, cat: 'Operação' },
  { label: 'Intervalo entrepico', unit: 'min', key: 'intervalo_entrepico', fmt: v => String(v), inverse: true, cat: 'Operação' },
  { label: 'Capacidade por veículo', unit: 'pax', key: 'capacidade_veiculo', fmt: v => String(v), cat: 'Oferta e Demanda' },
  { label: 'Passageiros por dia', unit: 'pax/dia', key: 'passageiros_dia', fmt: v => v.toLocaleString('pt-BR'), cat: 'Oferta e Demanda' },
  { label: 'Quilômetros produzidos', unit: 'km/dia', key: 'km_dia', fmt: v => v.toLocaleString('pt-BR'), cat: 'Oferta e Demanda' },
  { label: 'PPH pico (cap. ofertada)', unit: 'pax/h/sent.', key: 'pph_pico', fmt: v => String(v), cat: 'Oferta e Demanda' },
  { label: 'Velocidade média operacional', unit: 'km/h', key: 'vel_media', fmt: v => v.toFixed(1), cat: 'Qualidade de Serviço' },
  { label: 'Pontualidade', unit: '%', key: 'pontualidade', fmt: v => `${v}%`, cat: 'Qualidade de Serviço' },
  { label: 'Índice de Ocupação (IOC)', unit: '', key: 'ioc', fmt: v => v.toFixed(2), inverse: true, cat: 'Qualidade de Serviço' },
  { label: 'Índice de Freq. de Serviço (IFS)', unit: 'viag/h', key: 'ifs', fmt: v => v.toFixed(2), cat: 'Qualidade de Serviço' },
  { label: 'Custo por quilômetro', unit: 'R$/km', key: 'custo_km', fmt: v => `R$ ${v.toFixed(2)}`, inverse: true, cat: 'Gestão' },
  { label: 'Idade média da frota', unit: 'anos', key: 'idade_media_frota', fmt: v => v.toFixed(1), inverse: true, cat: 'Gestão' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function pctChange(a: number, b: number) {
  return ((b - a) / a) * 100
}

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function calcSim(line: TransitLine, hp: number, ho: number, cap: number): SimRow[] {
  return DEMAND_PROFILE.map((d, i) => {
    const hour = i + 4
    const isPeak = PEAK_HOURS.has(hour)
    const hw = isPeak ? hp : ho
    const supply = Math.round((60 / hw) * cap)
    const demand = Math.round(d.pct * line.proposto.passageiros_dia)
    const lf = demand / supply
    return {
      hour: d.hour,
      demand,
      supply,
      lf: parseFloat(Math.min(lf, 2).toFixed(3)),
      deficit: Math.max(0, demand - supply),
      isPeak,
    }
  })
}

function lfColor(v: number): string {
  if (v > 1.0) return 'var(--sim-lf-critical)'
  if (v > 0.9) return 'var(--sim-lf-high)'
  if (v > 0.75) return 'var(--sim-lf-moderate)'
  return 'var(--sim-lf-ok)'
}

// ── Tooltips ─────────────────────────────────────────────────────────────────

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

// ── Tipo badge ─────────────────────────────────────────────────────────────────

const TIPO_COLOR: Record<string, string> = {
  Expresso: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  Urbano: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  Alimentador: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
}

// ── Comparativo Tab ───────────────────────────────────────────────────────────

function ComparativoTab({ line }: { line: TransitLine }) {
  const { atual, proposto } = line
  const categories = Array.from(new Set(METRICS.map(m => m.cat)))
  const mainDelta = pctChange(atual.passageiros_dia, proposto.passageiros_dia)

  const summaryItems = [
    { label: 'Frota', aVal: atual.frota, pVal: proposto.frota, fmt: (v: number) => `${v} veíc.`, inverse: false },
    { label: 'Operação', aVal: atual.horas_op, pVal: proposto.horas_op, fmt: (v: number) => `${v}h/dia`, inverse: false },
    { label: 'Int. Pico', aVal: atual.intervalo_pico, pVal: proposto.intervalo_pico, fmt: (v: number) => `${v} min`, inverse: true },
    { label: 'Int. Entrepico', aVal: atual.intervalo_entrepico, pVal: proposto.intervalo_entrepico, fmt: (v: number) => `${v} min`, inverse: true },
    { label: 'Pontualidade', aVal: atual.pontualidade, pVal: proposto.pontualidade, fmt: (v: number) => `${v}%`, inverse: false },
    { label: 'IOC', aVal: atual.ioc, pVal: proposto.ioc, fmt: (v: number) => v.toFixed(2), inverse: true },
  ]

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Summary panels */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_48px_1fr] gap-4 items-stretch">
        {/* Current state */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Estado Atual
            </span>
            <span className="text-xs bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full border border-border">
              Referência
            </span>
          </div>
          <div>
            <p className="font-bold text-5xl text-foreground leading-none tracking-tight tabular-nums">
              {atual.passageiros_dia.toLocaleString('pt-BR')}
            </p>
            <p className="text-sm text-muted-foreground mt-1.5">passageiros / dia</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {summaryItems.map(item => (
              <div key={item.label} className="bg-muted/50 rounded-lg px-3 py-2.5">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="font-medium text-sm text-foreground/90 mt-0.5 tabular-nums">{item.fmt(item.aVal)}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border">
            {[
              { label: 'Km/dia', value: atual.km_dia.toLocaleString('pt-BR') },
              { label: 'IFS', value: atual.ifs.toFixed(2) },
              { label: 'PPH pico', value: String(atual.pph_pico) },
            ].map(item => (
              <div key={item.label} className="text-center">
                <p className="font-semibold text-base text-foreground/80 tabular-nums">{item.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="flex lg:flex-col items-center justify-center gap-2 py-6">
          <div className="flex-1 h-px lg:w-px lg:h-auto bg-border" />
          <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <ArrowRight className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 h-px lg:w-px lg:h-auto bg-border" />
        </div>

        {/* Proposed */}
        <div className="bg-card border border-primary/30 rounded-xl p-5 space-y-4 shadow-[0_0_32px_hsl(var(--primary)/0.08)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              Proposta
            </span>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold border',
              mainDelta >= 0
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25',
            )}>
              {mainDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {fmtPct(mainDelta)} pax/dia
            </span>
          </div>
          <div>
            <p className="font-bold text-5xl text-primary leading-none tracking-tight tabular-nums">
              {proposto.passageiros_dia.toLocaleString('pt-BR')}
            </p>
            <p className="text-sm text-muted-foreground mt-1.5">passageiros / dia</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {summaryItems.map(item => {
              const delta = pctChange(item.aVal, item.pVal)
              const good = item.inverse ? delta < 0 : delta > 0
              return (
                <div key={item.label} className="bg-primary/5 border border-primary/10 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="font-medium text-sm text-foreground/90 tabular-nums">{item.fmt(item.pVal)}</p>
                    <span className={cn(
                      'text-[10px] font-semibold tabular-nums',
                      good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                    )}>
                      {fmtPct(delta)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-primary/15">
            {[
              { label: 'Km/dia', aVal: atual.km_dia, pVal: proposto.km_dia, value: proposto.km_dia.toLocaleString('pt-BR') },
              { label: 'IFS', aVal: atual.ifs, pVal: proposto.ifs, value: proposto.ifs.toFixed(2) },
              { label: 'PPH pico', aVal: atual.pph_pico, pVal: proposto.pph_pico, value: String(proposto.pph_pico) },
            ].map(item => {
              const d = pctChange(item.aVal, item.pVal)
              return (
                <div key={item.label} className="text-center">
                  <p className="font-semibold text-base text-foreground/80 tabular-nums">{item.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
                  <span className={cn(
                    'text-[9px] font-semibold tabular-nums',
                    d >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                  )}>
                    {fmtPct(d)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Metrics table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm text-foreground">Detalhamento dos Indicadores</h3>
          <span className="ml-auto text-xs text-muted-foreground">↑ melhoria · ↓ degradação</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-2.5 text-xs text-muted-foreground font-medium w-[44%]">Indicador</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Estado Atual</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Proposta</th>
                <th className="text-right px-5 py-2.5 text-xs text-muted-foreground font-medium">Variação</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <Fragment key={cat}>
                  <tr className="bg-muted/30 border-y border-border/60">
                    <td colSpan={4} className="px-5 py-2">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {cat}
                      </span>
                    </td>
                  </tr>
                  {METRICS.filter(m => m.cat === cat).map(m => {
                    const a = atual[m.key] as number
                    const p = proposto[m.key] as number
                    const delta = pctChange(a, p)
                    const neutral = Math.abs(delta) < 0.5
                    const good = neutral ? null : (m.inverse ? delta < 0 : delta > 0)
                    return (
                      <tr
                        key={m.key}
                        className="border-b border-border/40 hover:bg-row-hover transition-colors"
                      >
                        <td className="px-5 py-2.5">
                          <span className="text-foreground/80">{m.label}</span>
                          {m.unit && (
                            <span className="text-muted-foreground ml-1.5 text-xs">({m.unit})</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground text-sm">
                          {m.fmt(a)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground text-sm">
                          {m.fmt(p)}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {neutral ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                              —
                            </span>
                          ) : (
                            <span className={cn(
                              'text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 font-semibold border',
                              good
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
                            )}>
                              {good ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {fmtPct(delta)}
                            </span>
                          )}
                        </td>
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
  )
}

// ── Simulação Tab ─────────────────────────────────────────────────────────────

interface SimKPIs {
  totalDemand: number
  totalSupply: number
  avgLF: number
  saturatedHours: number
  totalDeficit: number
  peakLF: number
}

function SimulacaoTab({
  line,
  sliderHp, sliderHo, sliderCap,
  setSliderHp, setSliderHo, setSliderCap,
  simData, kpis, resetSim,
}: {
  line: TransitLine
  sliderHp: number; sliderHo: number; sliderCap: number
  setSliderHp: (v: number) => void
  setSliderHo: (v: number) => void
  setSliderCap: (v: number) => void
  simData: SimRow[]
  kpis: SimKPIs
  resetSim: () => void
}) {
  const lfStatus =
    kpis.avgLF > 0.9 ? 'Saturado' :
    kpis.avgLF > 0.75 ? 'Elevado' :
    kpis.avgLF > 0.55 ? 'Adequado' : 'Subutilizado'

  const lfStatusColor =
    kpis.avgLF > 0.9 ? 'text-red-600 dark:text-red-400' :
    kpis.avgLF > 0.75 ? 'text-orange-600 dark:text-orange-400' :
    kpis.avgLF > 0.55 ? 'text-emerald-600 dark:text-emerald-400' : 'text-yellow-600 dark:text-yellow-400'

  const computedPph = Math.round((60 / sliderHp) * sliderCap)

  const domainMax = Math.min(2.0, Math.max(...simData.map(d => d.lf)) + 0.15)

  return (
    <div className="p-6 flex flex-col lg:flex-row gap-6 max-w-[1400px] mx-auto sim-chart">
      <style>{`
        .sim-chart { --series-oferta: #2a78d6; --series-demanda: #d9861f; }
        .dark .sim-chart { --series-oferta: #3987e5; --series-demanda: #e5a13a; }
        .sim-chart { --sim-lf-ok: #22c55e; --sim-lf-moderate: #d9a015; --sim-lf-high: #e2701a; --sim-lf-critical: #ef4444; }
        .dark .sim-chart { --sim-lf-ok: #34d067; --sim-lf-moderate: #eab308; --sim-lf-high: #f97316; --sim-lf-critical: #f87171; }
      `}</style>
      {/* Params panel */}
      <div className="w-full lg:w-68 shrink-0 space-y-4">
        <div className="bg-card border border-border rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Parâmetros</h3>
            </div>
            <button
              type="button"
              onClick={resetSim}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Resetar
            </button>
          </div>

          {/* Headway peak */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Intervalo de Pico</label>
              <span className="text-sm font-semibold text-primary tabular-nums">{sliderHp} min</span>
            </div>
            <input
              type="range" min={4} max={20} step={1} value={sliderHp}
              onChange={e => setSliderHp(Number(e.target.value))}
              className="w-full h-1.5 rounded-full cursor-pointer"
              style={{ accentColor: 'hsl(var(--primary))' }}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>4 min</span>
              <span className="text-muted-foreground/50">proposta: {line.proposto.intervalo_pico} min</span>
              <span>20 min</span>
            </div>
          </div>

          {/* Headway off-peak */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Intervalo Entrepico</label>
              <span className="text-sm font-semibold text-primary tabular-nums">{sliderHo} min</span>
            </div>
            <input
              type="range" min={8} max={40} step={2} value={sliderHo}
              onChange={e => setSliderHo(Number(e.target.value))}
              className="w-full h-1.5 rounded-full cursor-pointer"
              style={{ accentColor: 'hsl(var(--primary))' }}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>8 min</span>
              <span className="text-muted-foreground/50">proposta: {line.proposto.intervalo_entrepico} min</span>
              <span>40 min</span>
            </div>
          </div>

          {/* Vehicle capacity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Capacidade do Veículo</label>
              <span className="text-sm font-semibold text-primary tabular-nums">{sliderCap} pax</span>
            </div>
            <input
              type="range" min={40} max={130} step={5} value={sliderCap}
              onChange={e => setSliderCap(Number(e.target.value))}
              className="w-full h-1.5 rounded-full cursor-pointer"
              style={{ accentColor: 'hsl(var(--primary))' }}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>40 pax</span>
              <span className="text-muted-foreground/50">proposta: {line.proposto.capacidade_veiculo} pax</span>
              <span>130 pax</span>
            </div>
          </div>

          {/* Computed capacity */}
          <div className="bg-primary/5 border border-primary/15 rounded-lg p-3.5 space-y-1">
            <p className="text-xs text-muted-foreground">Oferta calculada no pico</p>
            <p className="font-bold text-xl text-primary leading-none tabular-nums">
              {computedPph.toLocaleString('pt-BR')} pax/h
            </p>
            <p className="text-[10px] text-muted-foreground">
              {(60 / sliderHp).toFixed(1)} viag/h × {sliderCap} pax/veíc.
            </p>
          </div>

          {/* Legend */}
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
              label: 'Demanda total diária',
              value: kpis.totalDemand.toLocaleString('pt-BR'),
              sub: 'pax/dia estimados',
              icon: <Users className="w-4 h-4" />,
              color: 'text-blue-600 dark:text-blue-400',
              bg: 'bg-blue-500/8 border-blue-500/15',
            },
            {
              label: 'Fator de Ocupação Médio',
              value: kpis.avgLF.toFixed(2),
              sub: lfStatus,
              icon: <Gauge className="w-4 h-4" />,
              color: lfStatusColor,
              bg: 'bg-card border-border',
            },
            {
              label: 'Horas com Saturação',
              value: String(kpis.saturatedHours),
              sub: kpis.saturatedHours === 0 ? 'nenhuma hora saturada' : `hora${kpis.saturatedHours > 1 ? 's' : ''} com excesso`,
              icon: <AlertTriangle className="w-4 h-4" />,
              color: kpis.saturatedHours === 0 ? 'text-emerald-600 dark:text-emerald-400' : kpis.saturatedHours <= 2 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400',
              bg: kpis.saturatedHours === 0 ? 'bg-emerald-500/8 border-emerald-500/15' : 'bg-card border-border',
            },
            {
              label: 'Passageiros não atendidos',
              value: kpis.totalDeficit.toLocaleString('pt-BR'),
              sub: kpis.totalDeficit === 0 ? 'cobertura total' : 'em horas saturadas',
              icon: <Zap className="w-4 h-4" />,
              color: kpis.totalDeficit === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
              bg: kpis.totalDeficit === 0 ? 'bg-emerald-500/8 border-emerald-500/15' : 'bg-red-500/8 border-red-500/15',
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
                <span className="w-3 h-0.5 rounded inline-block" style={{ background: 'var(--series-oferta)' }} />
                Oferta
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'var(--series-demanda)' }} />
                Demanda
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={simData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="hour"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                width={38}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="supply"
                name="Oferta (cap.)"
                fill="var(--series-oferta)"
                fillOpacity={0.10}
                stroke="var(--series-oferta)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
              <Bar
                dataKey="demand"
                name="Demanda"
                fill="var(--series-demanda)"
                fillOpacity={0.8}
                radius={[2, 2, 0, 0]}
                maxBarSize={26}
              />
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
            <BarChart data={simData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="hour"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                domain={[0, domainMax]}
                tickFormatter={v => v.toFixed(1)}
                width={32}
              />
              <Tooltip content={<LFTooltip />} />
              <ReferenceLine
                y={1.0}
                stroke="var(--sim-lf-critical)"
                strokeDasharray="5 3"
                strokeWidth={1.5}
                label={{ value: '100%', fill: 'var(--sim-lf-critical)', fontSize: 9, position: 'insideTopRight' }}
              />
              <ReferenceLine
                y={0.75}
                stroke="var(--sim-lf-moderate)"
                strokeDasharray="3 3"
                strokeWidth={1}
                label={{ value: '75%', fill: 'var(--sim-lf-moderate)', fontSize: 9, position: 'insideTopRight' }}
              />
              <Bar dataKey="lf" name="Fator Ocupação" radius={[2, 2, 0, 0]} maxBarSize={26}>
                {simData.map((entry, index) => (
                  <Cell key={index} fill={lfColor(entry.lf)} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const [lineId, setLineId] = useState('301')
  const [tab, setTab] = useState<'comparativo' | 'simulacao'>('comparativo')
  const [showLineMenu, setShowLineMenu] = useState(false)

  const line = LINES.find(l => l.id === lineId)!

  const [sliderHp, setSliderHp] = useState(line.proposto.intervalo_pico)
  const [sliderHo, setSliderHo] = useState(line.proposto.intervalo_entrepico)
  const [sliderCap, setSliderCap] = useState(line.proposto.capacidade_veiculo)

  const simData = useMemo(
    () => calcSim(line, sliderHp, sliderHo, sliderCap),
    [line, sliderHp, sliderHo, sliderCap],
  )

  const kpis: SimKPIs = useMemo(() => {
    const totalDemand = simData.reduce((s, d) => s + d.demand, 0)
    const totalSupply = simData.reduce((s, d) => s + d.supply, 0)
    const avgLF = totalDemand / totalSupply
    const saturatedHours = simData.filter(d => d.lf > 1.0).length
    const totalDeficit = simData.reduce((s, d) => s + d.deficit, 0)
    const peakLF = Math.max(...simData.map(d => d.lf))
    return { totalDemand, totalSupply, avgLF, saturatedHours, totalDeficit, peakLF }
  }, [simData])

  function handleLineSelect(id: string) {
    const l = LINES.find(x => x.id === id)!
    setLineId(id)
    setSliderHp(l.proposto.intervalo_pico)
    setSliderHo(l.proposto.intervalo_entrepico)
    setSliderCap(l.proposto.capacidade_veiculo)
    setShowLineMenu(false)
  }

  function resetSim() {
    setSliderHp(line.proposto.intervalo_pico)
    setSliderHo(line.proposto.intervalo_entrepico)
    setSliderCap(line.proposto.capacidade_veiculo)
  }

  return (
    <div
      className="min-h-full bg-background text-foreground flex flex-col"
      onClick={() => showLineMenu && setShowLineMenu(false)}
    >
      {/* Header */}
      <header className="h-14 flex items-center px-5 border-b border-border bg-card shrink-0 gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <Bus className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm tracking-widest uppercase text-foreground/60 hidden sm:block">
            Planejamento de Linhas · Comparativo
          </span>
        </div>

        {/* Line selector */}
        <div
          className="relative ml-auto"
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setShowLineMenu(!showLineMenu)}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-1.5 text-sm hover:border-primary/40 transition-colors cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="font-medium text-foreground/90 max-w-[180px] sm:max-w-[280px] truncate">
              {line.nome}
            </span>
            <ChevronDown
              className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0', showLineMenu && 'rotate-180')}
            />
          </button>
          {showLineMenu && (
            <div className="absolute top-full mt-1.5 right-0 w-72 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
              {LINES.map(l => (
                <button
                  type="button"
                  key={l.id}
                  onClick={() => handleLineSelect(l.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 text-sm transition-colors border-b border-border/50 last:border-0 cursor-pointer',
                    l.id === lineId
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-row-hover text-foreground/80',
                  )}
                >
                  <span className="font-medium block">{l.nome}</span>
                  <span className="text-xs text-muted-foreground mt-0.5 block">
                    {l.corredor} · {l.tipo}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-xs px-2.5 py-1 rounded-full shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="hidden sm:block">Proposta em Análise</span>
        </div>
      </header>

      {/* Line info strip */}
      <div className="px-5 py-2.5 border-b border-border bg-card/40 flex flex-wrap items-center gap-4 text-xs shrink-0">
        <span className={cn('font-semibold px-2.5 py-0.5 rounded border text-xs tracking-wider uppercase', TIPO_COLOR[line.tipo])}>
          {line.tipo}
        </span>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <MapPin className="w-3 h-3" />
          {line.corredor}
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-3 h-3" />
          Atual: {line.atual.horas_op}h · Proposta: {line.proposto.horas_op}h de operação
        </div>
        <span className="ml-auto text-muted-foreground/50">Ref.: ago/2026</span>
      </div>

      {/* Tabs */}
      <div className="px-5 border-b border-border shrink-0 bg-background flex items-center gap-0.5 pt-3">
        {(['comparativo', 'simulacao'] as const).map(t => (
          <button
            type="button"
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2 -mb-px cursor-pointer',
              tab === t
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30',
            )}
          >
            {t === 'comparativo' ? (
              <><BarChart2 className="w-3.5 h-3.5" /> Comparativo</>
            ) : (
              <><Sliders className="w-3.5 h-3.5" /> Simulação O/D</>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'comparativo' ? (
          <ComparativoTab line={line} />
        ) : (
          <SimulacaoTab
            line={line}
            sliderHp={sliderHp}
            sliderHo={sliderHo}
            sliderCap={sliderCap}
            setSliderHp={setSliderHp}
            setSliderHo={setSliderHo}
            setSliderCap={setSliderCap}
            simData={simData}
            kpis={kpis}
            resetSim={resetSim}
          />
        )}
      </div>
    </div>
  )
}
