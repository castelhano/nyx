'use client'

// Protótipo v2 — explora a unificação do LineScheduleGeneratorModal (Janelas/
// Ajuste/Frota, hoje em apps/transit/vehicle-plan) com o Comparativo/Simulação
// do protótipo v1 (../page.tsx). Dados mock, mas as fórmulas usam as MESMAS
// variáveis do motor real (see apps/web/.../vehicle-plan/[id]/line-generator-logic.ts):
// janelas (ciclo+intervalo por sentido, frota por faixa), capacidade de veículo,
// índice de renovação e demanda por hora/sentido — nada aqui é um número solto
// como no v1.
//
// Decisões que este protótipo assume (confirmadas com o usuário antes de
// escrever isto):
//  - "Atual" não é mais um dataset paralelo mockado: é o VehiclePlan com
//    status ACTIVE para a MESMA linha + MESMO tipo de dia do plano em edição.
//    Por isso "Extensão do itinerário" nunca varia entre Atual/Proposta —
//    vem de TransitLine.metrics.extensionKm, que é uma única linha física,
//    não algo versionado por plano.
//  - Fica full-screen (modal), sem mudança de rota.
//  - A aba Simulação testa DUAS abordagens lado a lado (toggle interno) em vez
//    de escolher uma: "Detalhado" usa a tabela de janelas tal como está
//    (mesma fonte de verdade da aba Janelas); "Simplificado" herda o tempo de
//    ciclo real dessas janelas mas deixa a frequência (headway) como um
//    dial único por pico/entrepico — a frota daquele trecho passa a ser
//    IMPLÍCITA (ciclo ÷ headway-alvo), nunca um número solto.

import { useMemo, useState, Fragment } from 'react'
import Link from 'next/link'
import {
  ComposedChart, BarChart, Area, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { resolveIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

const Bus            = resolveIcon('Bus')
const MapPin          = resolveIcon('MapPin')
const ChevronDown     = resolveIcon('ChevronDown')
const TrendingUp      = resolveIcon('TrendingUp')
const TrendingDown    = resolveIcon('TrendingDown')
const RotateCcw       = resolveIcon('RotateCcw')
const Users           = resolveIcon('Users')
const Gauge           = resolveIcon('Gauge')
const AlertTriangle   = resolveIcon('AlertTriangle')
const Zap             = resolveIcon('Zap')
const ArrowRight      = resolveIcon('ArrowRight')
const Plus            = resolveIcon('Plus')
const Trash2          = resolveIcon('Trash2')
const Info            = resolveIcon('Info')
const Layers          = resolveIcon('Layers')
const SlidersHorizontal = resolveIcon('SlidersHorizontal')
const BarChart2       = resolveIcon('BarChart2')
const GitBranch       = resolveIcon('GitBranch')
const CheckCircle     = resolveIcon('CheckCircle')

// ── domain types (mirrors the real GenWindow/Direction shape) ─────────────────

type Direction = 'OUTBOUND' | 'INBOUND'
type TabKey = 'janelas' | 'ajuste' | 'frota' | 'comparativo' | 'simulacao'

interface GenWindow {
  id:                string
  from:              number // decimal hour
  to:                number
  outboundMinutes:   number
  outboundInterval:  number
  inboundMinutes:    number
  inboundInterval:   number
  fleetCount:        number
}

interface AtualPlan {
  planCode:      string
  activatedAt:   string
  windows:       GenWindow[]
  vehicleCapacity: number
  renewalIndex:  Record<Direction, number>
  opStart:       number // minutes
  opEnd:         number
}

interface LineScenario {
  id:            string
  nome:          string
  tipo:          'Urbano' | 'Expresso'
  dayTypeLabel:  string
  extensionKm:   Record<Direction, number>
  demand:        Record<Direction, number[]> // 24 entries, pax/hour
  demandSource:  'measured' | 'estimated'
  proposta: {
    windows:  GenWindow[]
    capacity: number
    renewal:  Record<Direction, number>
    opStart:  number
    opEnd:    number
  }
  atual: AtualPlan | null
}

const DIR_LABEL: Record<Direction, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta' }
const PEAK_HOURS = new Set([6, 7, 8, 16, 17, 18])

// ── pure engine — same formulas as line-generator-logic.ts, trimmed to what
// this exploration needs (no HOLD/DEPOT, no block assignment) ────────────────

function totalCycleMinutes(w: GenWindow): number {
  return w.outboundMinutes + w.outboundInterval + w.inboundMinutes + w.inboundInterval
}

function windowAtHour(windows: GenWindow[], hour: number): GenWindow | undefined {
  return windows.find(w => hour >= w.from && hour < w.to)
}

function hourCoverage(hour: number, opStart: number, opEnd: number): number {
  const hs = hour * 60
  const he = hs + 60
  const overlap = Math.max(0, Math.min(he, opEnd) - Math.max(hs, opStart))
  return overlap > 0 ? Math.max(overlap, 30) / 60 : 0
}

function computeOfertaSeries(
  windows: GenWindow[], capacity: number, renewal: Record<Direction, number>, opStart: number, opEnd: number,
): Record<Direction, number[]> {
  const out: Record<Direction, number[]> = { OUTBOUND: Array(24).fill(0), INBOUND: Array(24).fill(0) }
  for (let hour = 0; hour < 24; hour++) {
    const coverage = hourCoverage(hour, opStart, opEnd)
    const w = windowAtHour(windows, hour + 0.5)
    if (coverage <= 0 || !w) continue
    const cycleTotal   = totalCycleMinutes(w)
    const tripsPerHour = cycleTotal > 0 ? (w.fleetCount * 60) / cycleTotal : 0
    for (const dir of ['OUTBOUND', 'INBOUND'] as Direction[]) {
      const capPerTrip = capacity * (1 + (renewal[dir] ?? 0) / 100)
      out[dir][hour] = Math.round(tripsPerHour * capPerTrip * coverage)
    }
  }
  return out
}

// Frequência simplificada: NÃO inventa um ciclo novo — herda o ciclo real da
// janela detalhada que cobre aquele horário (Ajuste/Janelas continuam sendo a
// fonte de verdade do tempo de viagem). Só a frequência-alvo (headway) muda por
// slider; a frota daquele trecho vira uma CONSEQUÊNCIA (ciclo ÷ headway), nunca
// um input direto — assim o número de veículos nunca fica desconectado da
// engenharia real da linha.
function computeSimplifiedSeries(
  windows: GenWindow[], hp: number, ho: number, capacity: number, renewal: Record<Direction, number>,
  opStart: number, opEnd: number,
): { oferta: Record<Direction, number[]>; impliedFleet: number[] } {
  const oferta: Record<Direction, number[]> = { OUTBOUND: Array(24).fill(0), INBOUND: Array(24).fill(0) }
  const impliedFleet: number[] = Array(24).fill(0)
  for (let hour = 0; hour < 24; hour++) {
    const coverage = hourCoverage(hour, opStart, opEnd)
    if (coverage <= 0) continue
    const w           = windowAtHour(windows, hour + 0.5)
    const cycleTotal  = w ? totalCycleMinutes(w) : 0
    const headway     = PEAK_HOURS.has(hour) ? hp : ho
    impliedFleet[hour] = cycleTotal > 0 && headway > 0 ? Math.ceil(cycleTotal / headway) : 0
    for (const dir of ['OUTBOUND', 'INBOUND'] as Direction[]) {
      const capPerTrip = capacity * (1 + (renewal[dir] ?? 0) / 100)
      oferta[dir][hour] = headway > 0 ? Math.round((60 / headway) * capPerTrip * coverage) : 0
    }
  }
  return { oferta, impliedFleet }
}

function estimateRoundTrips(windows: GenWindow[], opStart: number, opEnd: number) {
  let roundTrips = 0
  let peakFleet  = 0
  for (const w of windows) {
    peakFleet = Math.max(peakFleet, w.fleetCount)
    const bandStart  = Math.max(w.from * 60, opStart)
    const bandEnd    = Math.min(w.to * 60, opEnd)
    const bandMinutes = Math.max(0, bandEnd - bandStart)
    const cycleTotal = totalCycleMinutes(w)
    if (cycleTotal <= 0) continue
    roundTrips += (bandMinutes / cycleTotal) * w.fleetCount
  }
  return { roundTrips, peakFleet }
}

function avgHeadway(windows: GenWindow[], hours: number[], opStart: number, opEnd: number): number {
  const vals: number[] = []
  for (const h of hours) {
    if (h * 60 + 30 < opStart || h * 60 + 30 > opEnd) continue
    const w = windowAtHour(windows, h + 0.5)
    if (!w || w.fleetCount <= 0) continue
    const cycleTotal = totalCycleMinutes(w)
    if (cycleTotal <= 0) continue
    vals.push(cycleTotal / w.fleetCount)
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
}

interface LineKpis {
  extensaoKm:          number
  frota:               number
  viagensDia:          number
  horasOp:             number
  intervaloPico:       number
  intervaloEntrepico:  number
  capacidadeVeiculo:   number
  passageirosDia:      number
  kmDia:               number
  pphPico:             number
  velMedia:            number
  ioc:                 number
  ifs:                 number
}

function computeKpis(
  windows: GenWindow[], capacity: number, renewal: Record<Direction, number>,
  demand: Record<Direction, number[]>, extensionKm: Record<Direction, number>,
  opStart: number, opEnd: number,
): LineKpis {
  const oferta = computeOfertaSeries(windows, capacity, renewal, opStart, opEnd)
  const { roundTrips, peakFleet } = estimateRoundTrips(windows, opStart, opEnd)
  const peakHours    = Array.from({ length: 24 }, (_, h) => h).filter(h => PEAK_HOURS.has(h))
  const offPeakHours = Array.from({ length: 24 }, (_, h) => h).filter(h => !PEAK_HOURS.has(h))

  let passageirosDia = 0, ofertaTotal = 0, demandaTotal = 0, pphPico = 0
  for (const dir of ['OUTBOUND', 'INBOUND'] as Direction[]) {
    for (let h = 0; h < 24; h++) {
      const of = oferta[dir][h] ?? 0
      const dm = demand[dir]?.[h] ?? 0
      passageirosDia += Math.min(of, dm)
      ofertaTotal    += of
      demandaTotal   += dm
      if (PEAK_HOURS.has(h)) pphPico = Math.max(pphPico, of)
    }
  }

  let speedNum = 0, speedWeight = 0
  for (const w of windows) {
    const cycleTotal = totalCycleMinutes(w)
    if (cycleTotal <= 0) continue
    const bandStart   = Math.max(w.from * 60, opStart)
    const bandEnd     = Math.min(w.to * 60, opEnd)
    const bandMinutes = Math.max(0, bandEnd - bandStart)
    if (bandMinutes <= 0) continue
    const tripsInBand = (bandMinutes / cycleTotal) * w.fleetCount
    const speed       = ((extensionKm.OUTBOUND + extensionKm.INBOUND) / cycleTotal) * 60
    speedNum    += speed * tripsInBand
    speedWeight += tripsInBand
  }

  const intervaloPico      = avgHeadway(windows, peakHours, opStart, opEnd)
  const intervaloEntrepico = avgHeadway(windows, offPeakHours, opStart, opEnd)

  return {
    extensaoKm:         extensionKm.OUTBOUND + extensionKm.INBOUND,
    frota:              peakFleet,
    viagensDia:         Math.round(roundTrips * 2),
    horasOp:            (opEnd - opStart) / 60,
    intervaloPico,
    intervaloEntrepico,
    capacidadeVeiculo:  capacity,
    passageirosDia:     Math.round(passageirosDia),
    kmDia:              Math.round(roundTrips * (extensionKm.OUTBOUND + extensionKm.INBOUND)),
    pphPico,
    velMedia:           speedWeight > 0 ? speedNum / speedWeight : 0,
    ioc:                ofertaTotal > 0 ? demandaTotal / ofertaTotal : 0,
    ifs:                intervaloPico > 0 ? 60 / intervaloPico : 0,
  }
}

// ── time helpers ────────────────────────────────────────────────────────────

function hourToLabel(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
function labelToHour(label: string): number {
  const [hh, mm] = label.split(':').map(Number)
  return (hh || 0) + (mm || 0) / 60
}
function minutesToLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
function labelToMinutes(label: string): number {
  const [hh, mm] = label.split(':').map(Number)
  return (hh || 0) * 60 + (mm || 0)
}
function pctChange(a: number, b: number) { return a !== 0 ? ((b - a) / a) * 100 : 0 }
function fmtPct(v: number) { return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` }

// ── mock data ─────────────────────────────────────────────────────────────────

// Curva sintética (duas gaussianas AM/PM + piso diurno) em vez de tabelas
// digitadas na mão — evita 24 números arbitrários por sentido/linha e ainda
// dá uma assimetria de pendular (mais ida de manhã, mais volta à tarde)
// coerente com o padrão real de bilhetagem.
function demandCurve(peak: number, base: number, amWeight: number, pmWeight: number): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    const am   = Math.exp(-((h - 7) ** 2) / 8) * peak * amWeight
    const pm   = Math.exp(-((h - 17.5) ** 2) / 8) * peak * pmWeight
    const flat = h >= 4 && h <= 23 ? base : 0
    return Math.round(am + pm + flat)
  })
}

const LINES: LineScenario[] = [
  {
    id: '301', nome: '301 · Central ↔ Aeroporto', tipo: 'Expresso', dayTypeLabel: 'Dia Útil',
    extensionKm: { OUTBOUND: 18.5, INBOUND: 18.1 },
    demandSource: 'measured',
    demand: {
      OUTBOUND: demandCurve(620, 90, 1.25, 0.85),
      INBOUND:  demandCurve(620, 90, 0.85, 1.25),
    },
    proposta: {
      opStart: 240, opEnd: 1410, capacity: 80, renewal: { OUTBOUND: 8, INBOUND: 5 },
      windows: [
        { id: 'p1', from: 4,  to: 6,    outboundMinutes: 38, outboundInterval: 6, inboundMinutes: 36, inboundInterval: 6, fleetCount: 4 },
        { id: 'p2', from: 6,  to: 9,    outboundMinutes: 42, outboundInterval: 8, inboundMinutes: 40, inboundInterval: 8, fleetCount: 12 },
        { id: 'p3', from: 9,  to: 16,   outboundMinutes: 36, outboundInterval: 6, inboundMinutes: 34, inboundInterval: 6, fleetCount: 7 },
        { id: 'p4', from: 16, to: 19,   outboundMinutes: 44, outboundInterval: 8, inboundMinutes: 42, inboundInterval: 8, fleetCount: 13 },
        { id: 'p5', from: 19, to: 23.5, outboundMinutes: 34, outboundInterval: 6, inboundMinutes: 32, inboundInterval: 6, fleetCount: 5 },
      ],
    },
    atual: {
      planCode: 'PLN-2024-014', activatedAt: '02/11/2025',
      opStart: 240, opEnd: 1380, vehicleCapacity: 70, renewalIndex: { OUTBOUND: 4, INBOUND: 3 },
      windows: [
        { id: 'a1', from: 4,  to: 6,  outboundMinutes: 40, outboundInterval: 8,  inboundMinutes: 38, inboundInterval: 8,  fleetCount: 3 },
        { id: 'a2', from: 6,  to: 9,  outboundMinutes: 46, outboundInterval: 10, inboundMinutes: 44, inboundInterval: 10, fleetCount: 9 },
        { id: 'a3', from: 9,  to: 16, outboundMinutes: 39, outboundInterval: 8,  inboundMinutes: 37, inboundInterval: 8,  fleetCount: 5 },
        { id: 'a4', from: 16, to: 19, outboundMinutes: 48, outboundInterval: 10, inboundMinutes: 46, inboundInterval: 10, fleetCount: 10 },
        { id: 'a5', from: 19, to: 23, outboundMinutes: 37, outboundInterval: 8,  inboundMinutes: 35, inboundInterval: 8,  fleetCount: 4 },
      ],
    },
  },
  {
    id: '505', nome: '505 · Bairro Novo ↔ Distrito Industrial', tipo: 'Urbano', dayTypeLabel: 'Dia Útil',
    extensionKm: { OUTBOUND: 9.2, INBOUND: 9.0 },
    demandSource: 'estimated',
    demand: {
      OUTBOUND: demandCurve(140, 20, 1.2, 0.8),
      INBOUND:  demandCurve(140, 20, 0.8, 1.2),
    },
    proposta: {
      opStart: 240, opEnd: 1350, capacity: 70, renewal: { OUTBOUND: 2, INBOUND: 2 },
      windows: [
        { id: 'q1', from: 4,  to: 6,    outboundMinutes: 22, outboundInterval: 4, inboundMinutes: 21, inboundInterval: 4, fleetCount: 2 },
        { id: 'q2', from: 6,  to: 9,    outboundMinutes: 26, outboundInterval: 5, inboundMinutes: 25, inboundInterval: 5, fleetCount: 5 },
        { id: 'q3', from: 9,  to: 16,   outboundMinutes: 23, outboundInterval: 4, inboundMinutes: 22, inboundInterval: 4, fleetCount: 3 },
        { id: 'q4', from: 16, to: 19,   outboundMinutes: 27, outboundInterval: 5, inboundMinutes: 26, inboundInterval: 5, fleetCount: 5 },
        { id: 'q5', from: 19, to: 22.5, outboundMinutes: 21, outboundInterval: 4, inboundMinutes: 20, inboundInterval: 4, fleetCount: 2 },
      ],
    },
    atual: null, // linha em estudo — sem plano ACTIVE pra este tipo de dia ainda
  },
]

const TABS: { key: TabKey; label: string; icon: typeof Layers }[] = [
  { key: 'janelas',     label: 'Janelas',     icon: Layers },
  { key: 'ajuste',      label: 'Ajuste',      icon: SlidersHorizontal },
  { key: 'frota',       label: 'Frota',       icon: Bus },
  { key: 'comparativo', label: 'Comparativo', icon: GitBranch },
  { key: 'simulacao',   label: 'Simulação',   icon: BarChart2 },
]

interface MetricRowDef {
  label:  string
  unit:   string
  key:    keyof LineKpis
  fmt:    (v: number) => string
  inverse?: boolean
  shared?:  boolean // não varia entre Atual/Proposta (ex.: extensão vem da Linha, não do plano)
  cat:    string
}

const METRICS: MetricRowDef[] = [
  { label: 'Extensão do itinerário (ida+volta)', unit: 'km',        key: 'extensaoKm',         fmt: v => v.toFixed(1),               cat: 'Operação', shared: true },
  { label: 'Frota necessária',                   unit: 'veículos',  key: 'frota',               fmt: v => v.toLocaleString('pt-BR'),  cat: 'Operação' },
  { label: 'Viagens por dia',                    unit: 'viag/dia',  key: 'viagensDia',          fmt: v => v.toLocaleString('pt-BR'),  cat: 'Operação' },
  { label: 'Horas de operação',                  unit: 'h',         key: 'horasOp',             fmt: v => v.toFixed(1),               cat: 'Operação' },
  { label: 'Intervalo de pico',                  unit: 'min',       key: 'intervaloPico',       fmt: v => v.toFixed(1), inverse: true, cat: 'Operação' },
  { label: 'Intervalo entrepico',                unit: 'min',       key: 'intervaloEntrepico',  fmt: v => v.toFixed(1), inverse: true, cat: 'Operação' },
  { label: 'Capacidade por veículo',              unit: 'pax',       key: 'capacidadeVeiculo',   fmt: v => String(v),                  cat: 'Oferta e Demanda' },
  { label: 'Passageiros atendidos por dia',       unit: 'pax/dia',   key: 'passageirosDia',      fmt: v => v.toLocaleString('pt-BR'),  cat: 'Oferta e Demanda' },
  { label: 'Quilômetros produzidos',              unit: 'km/dia',    key: 'kmDia',               fmt: v => v.toLocaleString('pt-BR'),  cat: 'Oferta e Demanda' },
  { label: 'PPH pico (cap. ofertada)',            unit: 'pax/h/sent.', key: 'pphPico',           fmt: v => String(v),                  cat: 'Oferta e Demanda' },
  { label: 'Velocidade média operacional',        unit: 'km/h',      key: 'velMedia',            fmt: v => v.toFixed(1),               cat: 'Qualidade de Serviço' },
  { label: 'Índice de Ocupação (IOC)',            unit: '',          key: 'ioc',                 fmt: v => v.toFixed(2), inverse: true, cat: 'Qualidade de Serviço' },
  { label: 'Índice de Freq. de Serviço (IFS)',    unit: 'viag/h',    key: 'ifs',                 fmt: v => v.toFixed(2),               cat: 'Qualidade de Serviço' },
]

function lfColor(v: number): string {
  if (v > 1.0)  return 'var(--sim-lf-critical)'
  if (v > 0.9)  return 'var(--sim-lf-high)'
  if (v > 0.75) return 'var(--sim-lf-moderate)'
  return 'var(--sim-lf-ok)'
}

// ── tooltips ─────────────────────────────────────────────────────────────────

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

const TIPO_COLOR: Record<string, string> = {
  Expresso: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  Urbano:   'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
}

// ── Janelas tab ────────────────────────────────────────────────────────────

function JanelasTab({
  windows, setWindows, opStart, setOpStart, opEnd, setOpEnd,
}: {
  windows: GenWindow[]
  setWindows: (fn: (rows: GenWindow[]) => GenWindow[]) => void
  opStart: number; setOpStart: (v: number) => void
  opEnd: number; setOpEnd: (v: number) => void
}) {
  function updateWindow(i: number, patch: Partial<GenWindow>) {
    setWindows(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  function removeWindow(i: number) {
    setWindows(rows => {
      if (rows.length <= 1) return rows
      const result = rows.filter((_, idx) => idx !== i)
      if (i === 0) result[0] = { ...result[0], from: 0 }
      else if (i === rows.length - 1) result[result.length - 1] = { ...result[result.length - 1], to: 24 }
      return result
    })
  }
  function splitWindow(i: number) {
    setWindows(rows => {
      const row = rows[i]
      const mid = Math.round(((row.from + row.to) / 2) * 2) / 2
      if (mid <= row.from || mid >= row.to) return rows
      return [...rows.slice(0, i), { ...row, id: crypto.randomUUID(), to: mid }, { ...row, id: crypto.randomUUID(), from: mid }, ...rows.slice(i + 1)]
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-3 flex items-start gap-2.5 text-xs text-muted-foreground">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <span>
          Mesma tabela de janelas do gerador real (De/Até, ciclo+intervalo por sentido, frota) —
          esta é a única fonte de verdade dos tempos de ciclo. Frequência (aba Simulação) e comparação
          (aba Comparativo) leem daqui, nunca o contrário.
        </span>
      </div>

      <section className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          Início
          <input type="time" value={minutesToLabel(opStart)} onChange={e => setOpStart(labelToMinutes(e.target.value))}
            className="rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Fim
          <input type="time" value={minutesToLabel(opEnd)} onChange={e => setOpEnd(labelToMinutes(e.target.value))}
            className="rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </label>
      </section>

      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs">
            <tr>
              <th className="px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">De</th>
              <th className="px-2 py-2 text-left font-medium">Até</th>
              <th className="px-2 py-2 text-left font-medium">Ciclo + Intervalo (Ida)</th>
              <th className="px-2 py-2 text-left font-medium">Ciclo + Intervalo (Volta)</th>
              <th className="px-2 py-2 text-left font-medium">Frota</th>
              <th className="px-2 py-2 text-left font-medium">Frequência</th>
              <th className="px-2 py-2 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {windows.map((w, i) => {
              const cycleTotal = totalCycleMinutes(w)
              const freqMin    = w.fleetCount > 0 ? cycleTotal / w.fleetCount : 0
              return (
                <tr key={w.id} className="hover:bg-muted/20">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-2">
                    {i === 0 ? (
                      <div className="w-24 rounded-sm border border-input bg-muted/30 px-1.5 py-1 text-muted-foreground">00:00</div>
                    ) : (
                      <input type="time" value={hourToLabel(w.from)} onChange={e => updateWindow(i, { from: labelToHour(e.target.value) })}
                        className="w-24 rounded-sm border border-input bg-input-bg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring" />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {i === windows.length - 1 ? (
                      <div className="w-24 rounded-sm border border-input bg-muted/30 px-1.5 py-1 text-muted-foreground">24:00</div>
                    ) : (
                      <input type="time" value={hourToLabel(w.to)} onChange={e => updateWindow(i, { to: labelToHour(e.target.value) })}
                        className="w-24 rounded-sm border border-input bg-input-bg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring" />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="inline-flex items-center rounded-sm border border-input bg-input-bg">
                      <input type="number" min={1} title="Ciclo (min)" value={w.outboundMinutes}
                        onChange={e => updateWindow(i, { outboundMinutes: Number(e.target.value) || 0 })}
                        className="w-14 bg-transparent px-1.5 py-1 text-right focus:outline-none" />
                      <span className="text-muted-foreground px-0.5 select-none">+</span>
                      <input type="number" min={0} title="Intervalo de parada (min)" value={w.outboundInterval}
                        onChange={e => updateWindow(i, { outboundInterval: Number(e.target.value) || 0 })}
                        className="w-12 bg-transparent px-1.5 py-1 text-right focus:outline-none border-l border-input" />
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="inline-flex items-center rounded-sm border border-input bg-input-bg">
                      <input type="number" min={1} title="Ciclo (min)" value={w.inboundMinutes}
                        onChange={e => updateWindow(i, { inboundMinutes: Number(e.target.value) || 0 })}
                        className="w-14 bg-transparent px-1.5 py-1 text-right focus:outline-none" />
                      <span className="text-muted-foreground px-0.5 select-none">+</span>
                      <input type="number" min={0} title="Intervalo de parada (min)" value={w.inboundInterval}
                        onChange={e => updateWindow(i, { inboundInterval: Number(e.target.value) || 0 })}
                        className="w-12 bg-transparent px-1.5 py-1 text-right focus:outline-none border-l border-input" />
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" min={1} value={w.fleetCount}
                      onChange={e => updateWindow(i, { fleetCount: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-14 rounded-sm border border-input bg-input-bg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                    {freqMin.toFixed(1)} min / {cycleTotal}&apos;
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" title="Dividir faixa" onClick={() => splitWindow(i)}
                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                        <Layers className="w-4 h-4" />
                      </button>
                      <button type="button" title="Remover faixa" disabled={windows.length === 1} onClick={() => removeWindow(i)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:pointer-events-none">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Ajuste tab ───────────────────────────────────────────────────────────────

function AjusteTab({
  renewal, setRenewal, insertInterval, setInsertInterval,
}: {
  renewal: Record<Direction, number>
  setRenewal: (fn: (r: Record<Direction, number>) => Record<Direction, number>) => void
  insertInterval: boolean
  setInsertInterval: (fn: (v: boolean) => boolean) => void
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr_16rem] gap-x-4 gap-y-4 items-center max-w-3xl">
      <Switch checked={insertInterval} onToggle={() => setInsertInterval(v => !v)} />
      <span className="text-sm cursor-pointer select-none" onClick={() => setInsertInterval(v => !v)}>
        Inserir intervalo de descanso
      </span>
      <span className="text-xs text-muted-foreground">não afeta as estimativas abaixo — só a geração final</span>

      {(['OUTBOUND', 'INBOUND'] as Direction[]).map(dir => (
        <Fragment key={dir}>
          <div className="flex items-center gap-1.5">
            <input type="number" min={0} value={renewal[dir] ?? 0}
              onChange={e => setRenewal(r => ({ ...r, [dir]: Number(e.target.value) || 0 }))}
              className="w-20 rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <span className="text-sm">renovação {DIR_LABEL[dir]}</span>
          <span className="text-xs text-muted-foreground">
            {dir === 'OUTBOUND' ? 'excedente de embarque na ida (bilhetagem × GPS)' : 'idem, na volta'}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

// ── Frota tab ────────────────────────────────────────────────────────────────

function FrotaTab({ capacity, setCapacity }: { capacity: number; setCapacity: (v: number) => void }) {
  return (
    <div className="max-w-md space-y-3">
      <div className="grid grid-cols-[6rem_1fr] gap-x-4 items-center">
        <input type="number" min={1} value={capacity} onChange={e => setCapacity(Number(e.target.value) || 0)}
          className="w-14 rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        <span className="text-sm">Capacidade por veículo (pax)</span>
      </div>
      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Frota por garagem (alocação em depósitos) fica fora deste protótipo — já coberta pelo modal atual
        e não muda nada na exploração de Comparativo/Simulação.
      </p>
    </div>
  )
}

// ── Comparativo tab ──────────────────────────────────────────────────────────

function ComparativoTab({ line, propostaKpis }: { line: LineScenario; propostaKpis: LineKpis }) {
  if (!line.atual) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2">
          <GitBranch className="w-6 h-6 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">Sem base de comparação</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Esta linha não possui um Planejamento com status <strong>Ativo</strong> para o Tipo de Dia
            &quot;{line.dayTypeLabel}&quot; — não há operação real pra comparar ainda. Assim que uma versão
            for ativada, ela aparece aqui automaticamente.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Proposta (rascunho atual)</p>
          <p className="font-bold text-4xl text-foreground tabular-nums">{propostaKpis.passageirosDia.toLocaleString('pt-BR')}</p>
          <p className="text-sm text-muted-foreground">passageiros atendidos / dia (estimado)</p>
        </div>
      </div>
    )
  }

  const atualKpis = computeKpis(line.atual.windows, line.atual.vehicleCapacity, line.atual.renewalIndex, line.demand, line.extensionKm, line.atual.opStart, line.atual.opEnd)
  const categories = Array.from(new Set(METRICS.map(m => m.cat)))
  const mainDelta = pctChange(atualKpis.passageirosDia, propostaKpis.passageirosDia)

  const summaryItems = [
    { label: 'Frota',          aVal: atualKpis.frota,              pVal: propostaKpis.frota,              fmt: (v: number) => `${v} veíc.`, inverse: false },
    { label: 'Operação',       aVal: atualKpis.horasOp,            pVal: propostaKpis.horasOp,             fmt: (v: number) => `${v.toFixed(1)}h/dia`, inverse: false },
    { label: 'Int. Pico',      aVal: atualKpis.intervaloPico,       pVal: propostaKpis.intervaloPico,       fmt: (v: number) => `${v.toFixed(1)} min`, inverse: true },
    { label: 'Int. Entrepico', aVal: atualKpis.intervaloEntrepico,  pVal: propostaKpis.intervaloEntrepico,  fmt: (v: number) => `${v.toFixed(1)} min`, inverse: true },
    { label: 'Capacidade',     aVal: atualKpis.capacidadeVeiculo,   pVal: propostaKpis.capacidadeVeiculo,   fmt: (v: number) => `${v} pax`, inverse: false },
    { label: 'IOC',            aVal: atualKpis.ioc,                pVal: propostaKpis.ioc,                fmt: (v: number) => v.toFixed(2), inverse: true },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_48px_1fr] gap-4 items-stretch">
        {/* Atual */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Estado Atual</span>
            <span className="text-xs bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full border border-border">
              {line.atual.planCode} · ativo desde {line.atual.activatedAt}
            </span>
          </div>
          <div>
            <p className="font-bold text-5xl text-foreground leading-none tracking-tight tabular-nums">
              {atualKpis.passageirosDia.toLocaleString('pt-BR')}
            </p>
            <p className="text-sm text-muted-foreground mt-1.5">passageiros atendidos / dia</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {summaryItems.map(item => (
              <div key={item.label} className="bg-muted/50 rounded-lg px-3 py-2.5">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="font-medium text-sm text-foreground/90 mt-0.5 tabular-nums">{item.fmt(item.aVal)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex lg:flex-col items-center justify-center gap-2 py-6">
          <div className="flex-1 h-px lg:w-px lg:h-auto bg-border" />
          <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <ArrowRight className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 h-px lg:w-px lg:h-auto bg-border" />
        </div>

        {/* Proposta */}
        <div className="bg-card border border-primary/30 rounded-xl p-5 space-y-4 shadow-[0_0_32px_hsl(var(--primary)/0.08)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">Proposta</span>
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
              {propostaKpis.passageirosDia.toLocaleString('pt-BR')}
            </p>
            <p className="text-sm text-muted-foreground mt-1.5">passageiros atendidos / dia</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {summaryItems.map(item => {
              const delta = pctChange(item.aVal, item.pVal)
              const good  = item.inverse ? delta < 0 : delta > 0
              return (
                <div key={item.label} className="bg-primary/5 border border-primary/10 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="font-medium text-sm text-foreground/90 tabular-nums">{item.fmt(item.pVal)}</p>
                    <span className={cn('text-[10px] font-semibold tabular-nums', good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {fmtPct(delta)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

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
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{cat}</span>
                    </td>
                  </tr>
                  {METRICS.filter(m => m.cat === cat).map(m => {
                    const a = atualKpis[m.key]
                    const p = propostaKpis[m.key]
                    const delta   = pctChange(a, p)
                    const neutral = m.shared || Math.abs(delta) < 0.5
                    const good    = neutral ? null : (m.inverse ? delta < 0 : delta > 0)
                    return (
                      <tr key={m.key} className="border-b border-border/40 hover:bg-row-hover transition-colors">
                        <td className="px-5 py-2.5">
                          <span className="text-foreground/80">{m.label}</span>
                          {m.unit && <span className="text-muted-foreground ml-1.5 text-xs">({m.unit})</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground text-sm">{m.fmt(a)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground text-sm">{m.fmt(p)}</td>
                        <td className="px-5 py-2.5 text-right">
                          {m.shared ? (
                            <span title="Vem do cadastro da Linha — não muda entre Atual e Proposta" className="text-xs px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                              linha
                            </span>
                          ) : neutral ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">—</span>
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

// ── Simulação tab ────────────────────────────────────────────────────────────

interface SimKPIs { totalDemand: number; avgLF: number; saturatedHours: number; totalDeficit: number }

function computeSimKpis(oferta: Record<Direction, number[]>, demand: Record<Direction, number[]>): SimKPIs {
  let totalDemand = 0, totalOferta = 0, saturatedHours = 0, totalDeficit = 0
  for (let h = 0; h < 24; h++) {
    const dm = (demand.OUTBOUND[h] ?? 0) + (demand.INBOUND[h] ?? 0)
    const of = (oferta.OUTBOUND[h] ?? 0) + (oferta.INBOUND[h] ?? 0)
    totalDemand += dm
    totalOferta += of
    if (of > 0 && dm > of) saturatedHours++
    totalDeficit += Math.max(0, dm - of)
  }
  return { totalDemand, avgLF: totalOferta > 0 ? totalDemand / totalOferta : 0, saturatedHours, totalDeficit }
}

function SimulacaoCharts({
  oferta, demand, activeDir, setActiveDir,
}: {
  oferta: Record<Direction, number[]>
  demand: Record<Direction, number[]>
  activeDir: Direction
  setActiveDir: (d: Direction) => void
}) {
  const kpis = useMemo(() => computeSimKpis(oferta, demand), [oferta, demand])
  const lfStatus = kpis.avgLF > 0.9 ? 'Saturado' : kpis.avgLF > 0.75 ? 'Elevado' : kpis.avgLF > 0.55 ? 'Adequado' : 'Subutilizado'
  const lfColorClass =
    kpis.avgLF > 0.9  ? 'text-red-600 dark:text-red-400' :
    kpis.avgLF > 0.75 ? 'text-orange-600 dark:text-orange-400' :
    kpis.avgLF > 0.55 ? 'text-emerald-600 dark:text-emerald-400' : 'text-yellow-600 dark:text-yellow-400'

  const chartData = useMemo(() => Array.from({ length: 24 }, (_, h) => ({
    hour: hourToLabel(h), oferta: oferta[activeDir][h] ?? 0, demanda: demand[activeDir][h] ?? 0,
  })), [oferta, demand, activeDir])

  const lfData = useMemo(() => Array.from({ length: 24 }, (_, h) => {
    const dm = (demand.OUTBOUND[h] ?? 0) + (demand.INBOUND[h] ?? 0)
    const of = (oferta.OUTBOUND[h] ?? 0) + (oferta.INBOUND[h] ?? 0)
    return { hour: hourToLabel(h), lf: of > 0 ? Math.min(dm / of, 2) : 0 }
  }), [oferta, demand])

  const domainMax = Math.min(2.0, Math.max(...lfData.map(d => d.lf)) + 0.15)

  return (
    <div className="space-y-5 sim-chart">
      <style>{`
        .sim-chart { --series-oferta: #2a78d6; --series-demanda: #d9861f; }
        .dark .sim-chart { --series-oferta: #3987e5; --series-demanda: #e5a13a; }
        .sim-chart { --sim-lf-ok: #22c55e; --sim-lf-moderate: #d9a015; --sim-lf-high: #e2701a; --sim-lf-critical: #ef4444; }
        .dark .sim-chart { --sim-lf-ok: #34d067; --sim-lf-moderate: #eab308; --sim-lf-high: #f97316; --sim-lf-critical: #f87171; }
      `}</style>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Demanda total diária', value: kpis.totalDemand.toLocaleString('pt-BR'), sub: 'pax/dia (ambos sentidos)', icon: <Users className="w-4 h-4" />, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/8 border-blue-500/15' },
          { label: 'Fator de Ocupação Médio', value: kpis.avgLF.toFixed(2), sub: lfStatus, icon: <Gauge className="w-4 h-4" />, color: lfColorClass, bg: 'bg-card border-border' },
          { label: 'Horas com Saturação', value: String(kpis.saturatedHours), sub: kpis.saturatedHours === 0 ? 'nenhuma hora saturada' : `hora${kpis.saturatedHours > 1 ? 's' : ''} com excesso`, icon: <AlertTriangle className="w-4 h-4" />, color: kpis.saturatedHours === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400', bg: kpis.saturatedHours === 0 ? 'bg-emerald-500/8 border-emerald-500/15' : 'bg-card border-border' },
          { label: 'Passageiros não atendidos', value: kpis.totalDeficit.toLocaleString('pt-BR'), sub: kpis.totalDeficit === 0 ? 'cobertura total' : 'em horas saturadas', icon: <Zap className="w-4 h-4" />, color: kpis.totalDeficit === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400', bg: kpis.totalDeficit === 0 ? 'bg-emerald-500/8 border-emerald-500/15' : 'bg-red-500/8 border-red-500/15' },
        ].map(kpi => (
          <div key={kpi.label} className={cn('border rounded-xl p-4', kpi.bg)}>
            <div className={cn('mb-2', kpi.color)}>{kpi.icon}</div>
            <p className="font-bold text-2xl text-foreground leading-none tabular-nums">{kpi.value}</p>
            <p className={cn('text-xs mt-1 font-medium', kpi.color)}>{kpi.sub}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-tight">{kpi.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-5">
          <h3 className="font-semibold text-sm">Oferta × Demanda por Hora</h3>
          <div className="flex gap-1 ml-2">
            {(['OUTBOUND', 'INBOUND'] as Direction[]).map(dir => (
              <button key={dir} type="button" onClick={() => setActiveDir(dir)}
                className={cn('px-2.5 py-1 rounded-full text-xs font-medium transition-colors', dir === activeDir ? 'bg-ring text-white' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                {DIR_LABEL[dir]}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded inline-block" style={{ background: 'var(--series-oferta)' }} />Oferta</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'var(--series-demanda)' }} />Demanda</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="hour" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} interval={1} />
            <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} width={38} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="oferta" name="Oferta" fill="var(--series-oferta)" fillOpacity={0.1} stroke="var(--series-oferta)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            <Bar dataKey="demanda" name="Demanda" fill="var(--series-demanda)" fillOpacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={22} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-5">
          <h3 className="font-semibold text-sm">Fator de Ocupação por Hora</h3>
          <span className="text-xs text-muted-foreground ml-auto">FOC = demanda / oferta (ida + volta)</span>
        </div>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={lfData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="hour" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} interval={1} />
            <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, domainMax]} tickFormatter={v => v.toFixed(1)} width={32} />
            <Tooltip content={<LFTooltip />} />
            <ReferenceLine y={1.0} stroke="var(--sim-lf-critical)" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: '100%', fill: 'var(--sim-lf-critical)', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine y={0.75} stroke="var(--sim-lf-moderate)" strokeDasharray="3 3" strokeWidth={1} label={{ value: '75%', fill: 'var(--sim-lf-moderate)', fontSize: 9, position: 'insideTopRight' }} />
            <Bar dataKey="lf" name="Fator Ocupação" radius={[2, 2, 0, 0]} maxBarSize={22}>
              {lfData.map((entry, index) => <Cell key={index} fill={lfColor(entry.lf)} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function SimulacaoTab({
  windows, capacity, setCapacity, renewal, opStart, opEnd, demand,
}: {
  windows: GenWindow[]
  capacity: number; setCapacity: (v: number) => void
  renewal: Record<Direction, number>
  opStart: number; opEnd: number
  demand: Record<Direction, number[]>
}) {
  const [mode, setMode] = useState<'simplificado' | 'detalhado'>('simplificado')
  const [activeDir, setActiveDir] = useState<Direction>('OUTBOUND')

  const seededHp = useMemo(() => Math.round(avgHeadway(windows, [...PEAK_HOURS], opStart, opEnd)) || 10, [windows, opStart, opEnd])
  const seededHo = useMemo(() => Math.round(avgHeadway(windows, Array.from({ length: 24 }, (_, h) => h).filter(h => !PEAK_HOURS.has(h)), opStart, opEnd)) || 20, [windows, opStart, opEnd])
  const [sliderHp, setSliderHp] = useState(seededHp)
  const [sliderHo, setSliderHo] = useState(seededHo)

  function resetSliders() { setSliderHp(seededHp); setSliderHo(seededHo) }

  const detalhadoSeries   = useMemo(() => computeOfertaSeries(windows, capacity, renewal, opStart, opEnd), [windows, capacity, renewal, opStart, opEnd])
  const simplificado      = useMemo(() => computeSimplifiedSeries(windows, sliderHp, sliderHo, capacity, renewal, opStart, opEnd), [windows, sliderHp, sliderHo, capacity, renewal, opStart, opEnd])
  const impliedPeakFleet  = Math.max(0, ...[...PEAK_HOURS].map(h => simplificado.impliedFleet[h]))
  const impliedOffFleet   = Math.max(0, ...Array.from({ length: 24 }, (_, h) => h).filter(h => !PEAK_HOURS.has(h) && hourCoverage(h, opStart, opEnd) > 0).map(h => simplificado.impliedFleet[h]))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
          {(['simplificado', 'detalhado'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', mode === m ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {m === 'simplificado' ? 'Simplificado (2 faixas)' : 'Detalhado (janelas reais)'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          {mode === 'simplificado' ? 'Ciclo herdado da aba Janelas — só a frequência muda' : 'Lê a tabela de janelas diretamente, sem simplificação'}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-72 shrink-0 space-y-4">
          {mode === 'simplificado' ? (
            <div className="bg-card border border-border rounded-xl p-5 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm">Frequência-alvo</h3>
                </div>
                <button type="button" onClick={resetSliders} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <RotateCcw className="w-3 h-3" /> Sincronizar
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Intervalo de Pico</label>
                  <span className="text-sm font-semibold text-primary tabular-nums">{sliderHp} min</span>
                </div>
                <input type="range" min={3} max={25} step={1} value={sliderHp} onChange={e => setSliderHp(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full cursor-pointer" style={{ accentColor: 'hsl(var(--primary))' }} />
                <p className="text-[10px] text-muted-foreground/70">
                  frota implícita no pico: <strong className="text-foreground/80">{impliedPeakFleet}</strong> veíc. (ciclo real da janela)
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Intervalo Entrepico</label>
                  <span className="text-sm font-semibold text-primary tabular-nums">{sliderHo} min</span>
                </div>
                <input type="range" min={6} max={45} step={1} value={sliderHo} onChange={e => setSliderHo(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full cursor-pointer" style={{ accentColor: 'hsl(var(--primary))' }} />
                <p className="text-[10px] text-muted-foreground/70">
                  frota implícita no entrepico: <strong className="text-foreground/80">{impliedOffFleet}</strong> veíc.
                </p>
              </div>

              <div className="space-y-2 pt-1 border-t border-border">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Capacidade do Veículo</label>
                  <span className="text-sm font-semibold text-primary tabular-nums">{capacity} pax</span>
                </div>
                <input type="range" min={40} max={130} step={5} value={capacity} onChange={e => setCapacity(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full cursor-pointer" style={{ accentColor: 'hsl(var(--primary))' }} />
                <p className="text-[10px] text-muted-foreground/60">mesmo campo da aba Frota</p>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Janelas ativas</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {windows.length} faixa{windows.length !== 1 ? 's' : ''} configurada{windows.length !== 1 ? 's' : ''} — edite na aba Janelas.
              </p>
              <div className="space-y-1.5">
                {windows.map(w => (
                  <div key={w.id} className="flex items-center justify-between text-xs bg-muted/40 rounded-md px-2.5 py-1.5">
                    <span className="tabular-nums text-muted-foreground">{hourToLabel(w.from)}–{hourToLabel(w.to)}</span>
                    <span className="tabular-nums font-medium">{w.fleetCount} veíc.</span>
                    <span className="tabular-nums text-muted-foreground">{(totalCycleMinutes(w) / w.fleetCount).toFixed(1)}&apos;</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Fator de Ocupação (FOC)</p>
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

        <div className="flex-1 min-w-0">
          <SimulacaoCharts
            oferta={mode === 'simplificado' ? simplificado.oferta : detalhadoSeries}
            demand={demand}
            activeDir={activeDir}
            setActiveDir={setActiveDir}
          />
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlaygroundV2Page() {
  const [lineId, setLineId] = useState('301')
  const [tab, setTab] = useState<TabKey>('comparativo')
  const [showLineMenu, setShowLineMenu] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const line = LINES.find(l => l.id === lineId)!

  const [windows, setWindows]     = useState<GenWindow[]>(line.proposta.windows)
  const [opStart, setOpStart]     = useState(line.proposta.opStart)
  const [opEnd, setOpEnd]         = useState(line.proposta.opEnd)
  const [capacity, setCapacity]   = useState(line.proposta.capacity)
  const [renewal, setRenewal]     = useState(line.proposta.renewal)
  const [insertInterval, setInsertInterval] = useState(true)

  function handleLineSelect(id: string) {
    const l = LINES.find(x => x.id === id)!
    setLineId(id)
    setWindows(l.proposta.windows)
    setOpStart(l.proposta.opStart)
    setOpEnd(l.proposta.opEnd)
    setCapacity(l.proposta.capacity)
    setRenewal(l.proposta.renewal)
    setShowLineMenu(false)
  }

  const propostaKpis = useMemo(
    () => computeKpis(windows, capacity, renewal, line.demand, line.extensionKm, opStart, opEnd),
    [windows, capacity, renewal, line, opStart, opEnd],
  )

  return (
    <div className="min-h-full bg-background text-foreground flex flex-col" onClick={() => showLineMenu && setShowLineMenu(false)}>
      {/* header */}
      <header className="h-14 flex items-center px-5 border-b border-border bg-card shrink-0 gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <Bus className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm tracking-widest uppercase text-foreground/60 hidden sm:block">
            Gerador Unificado · Protótipo v2
          </span>
        </div>

        <Link href="/playground" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0">
          ← ver protótipo v1
        </Link>

        <div className="relative ml-auto" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => setShowLineMenu(!showLineMenu)}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-1.5 text-sm hover:border-primary/40 transition-colors cursor-pointer">
            <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="font-medium text-foreground/90 max-w-[180px] sm:max-w-[280px] truncate">{line.nome}</span>
            <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0', showLineMenu && 'rotate-180')} />
          </button>
          {showLineMenu && (
            <div className="absolute top-full mt-1.5 right-0 w-72 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
              {LINES.map(l => (
                <button type="button" key={l.id} onClick={() => handleLineSelect(l.id)}
                  className={cn('w-full text-left px-4 py-3 text-sm transition-colors border-b border-border/50 last:border-0 cursor-pointer', l.id === lineId ? 'bg-primary/10 text-primary' : 'hover:bg-row-hover text-foreground/80')}>
                  <span className="font-medium block">{l.nome}</span>
                  <span className="text-xs text-muted-foreground mt-0.5 block">
                    {l.tipo} · {l.atual ? `plano ativo (${l.atual.planCode})` : 'sem plano ativo — linha nova'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={cn(
          'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full shrink-0 border',
          line.atual
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
            : 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400',
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', line.atual ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse')} />
          <span className="hidden sm:block">{line.atual ? 'Com plano ativo p/ comparar' : 'Sem plano ativo'}</span>
        </div>
      </header>

      {/* info strip */}
      <div className="px-5 py-2.5 border-b border-border bg-card/40 flex flex-wrap items-center gap-4 text-xs shrink-0">
        <span className={cn('font-semibold px-2.5 py-0.5 rounded border text-xs tracking-wider uppercase', TIPO_COLOR[line.tipo])}>{line.tipo}</span>
        <span className="text-muted-foreground">Tipo de Dia: <span className="font-medium text-foreground/80">{line.dayTypeLabel}</span></span>
        <span className="text-muted-foreground">
          Demanda: <span className="font-medium text-foreground/80">{line.demandSource === 'measured' ? 'medida (bilhetagem × GPS)' : 'estimada (pesquisa O/D)'}</span>
        </span>
        <span className="ml-auto text-muted-foreground/50">Protótipo — dados mock, fórmulas reais</span>
      </div>

      {/* tabs */}
      <div className="px-5 border-b border-border shrink-0 bg-background flex items-center gap-0.5 pt-3">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2 -mb-px cursor-pointer',
              tab === t.key ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30')}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-[1400px] mx-auto">
          {tab === 'janelas' && (
            <JanelasTab windows={windows} setWindows={setWindows} opStart={opStart} setOpStart={setOpStart} opEnd={opEnd} setOpEnd={setOpEnd} />
          )}
          {tab === 'ajuste' && (
            <AjusteTab renewal={renewal} setRenewal={setRenewal} insertInterval={insertInterval} setInsertInterval={setInsertInterval} />
          )}
          {tab === 'frota' && <FrotaTab capacity={capacity} setCapacity={setCapacity} />}
          {tab === 'comparativo' && <ComparativoTab line={line} propostaKpis={propostaKpis} />}
          {tab === 'simulacao' && (
            <SimulacaoTab windows={windows} capacity={capacity} setCapacity={setCapacity} renewal={renewal} opStart={opStart} opEnd={opEnd} demand={line.demand} />
          )}
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 bg-card">
        <div className="text-xs text-muted-foreground">
          Prévia: <strong className="text-foreground">~{propostaKpis.viagensDia}</strong> viagens/dia para{' '}
          <strong className="text-foreground">{propostaKpis.frota}</strong> veículos no pico
          {flash && <span className="ml-3 text-amber-600 dark:text-amber-400">{flash}</span>}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="cancel" size="sm">Cancelar</Button>
          <Button type="button" size="sm" onClick={() => setFlash('protótipo — sem geração real')}>
            <CheckCircle className="w-3.5 h-3.5" /> Gerar
          </Button>
        </div>
      </div>
    </div>
  )
}
