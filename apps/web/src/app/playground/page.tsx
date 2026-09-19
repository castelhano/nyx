'use client'

// Protótipo visual — Fase 0 do DOP (Dados Operacionais Previstos), ver
// docs/proposal/plan_dop_v1.md. Dado 100% sintético, hardcoded — sem fetch,
// sem interatividade real além da troca de aba da tabela por linha (só pra
// provar o padrão de "muitas colunas -> aba, não scroll horizontal
// permanente"). Objetivo único: validar a composição visual do dashboard
// antes de acoplar o backend (Fase 1-2) e a página real (Fase 3).
//
// Estrutura de dado por dia-tipo (útil/sáb/dom) e a quebra km produtiva/
// ociosa/% por bloco inspiradas na planilha de referência que o usuário usa
// hoje pro cálculo manual (docs/proposal/plan_dop_v1.md não replica a
// planilha 1:1 — só o suficiente pro protótipo).

import { useState } from 'react'
import { Icons } from '@/lib/icons'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── calendário do período selecionado (mockado) ─────────────────────────────

const CALENDAR = { util: 21, sab: 4, dom: 5 }
const CALENDAR_TOTAL = CALENDAR.util + CALENDAR.sab + CALENDAR.dom

// ── dado sintético por linha ─────────────────────────────────────────────────

interface RawLine {
  code:       string
  name:       string
  empresa:    string
  fleetUtil:  number
  tripsUtil:  number
  kmProdUtil: number
  idlePct:    number // % ociosa sobre o total (dia útil) — produtiva/ociosa deriva daqui
  avgSpeed:   number
  occupancy:  number
  headway:    { morning: number; midday: number; afternoon: number }
  noDomingo?: boolean
  wSab?:      number // fator de redução sáb sobre útil (frota/viagens/km) — default 0.65
  wDom?:      number // idem domingo — default 0.45
}

const RAW_LINES: RawLine[] = [
  { code: '205',  name: 'Respaiaguás x Centro',        empresa: 'Trans Cuiabá', fleetUtil: 10, tripsUtil: 82, kmProdUtil: 1610, idlePct: 0.07, avgSpeed: 26.0, occupancy: 0.91, headway: { morning: 6,  midday: 12, afternoon: 7  } },
  { code: '507',  name: 'Jardim Aeroporto x Centro',    empresa: 'Trans Cuiabá', fleetUtil: 9,  tripsUtil: 70, kmProdUtil: 1380, idlePct: 0.08, avgSpeed: 25.1, occupancy: 0.88, headway: { morning: 7,  midday: 13, afternoon: 8  } },
  { code: '101',  name: 'Santa Amália x Centro',        empresa: 'Trans Cuiabá', fleetUtil: 8,  tripsUtil: 64, kmProdUtil: 1240, idlePct: 0.09, avgSpeed: 24.3, occupancy: 0.82, headway: { morning: 8,  midday: 14, afternoon: 9  } },
  { code: '412',  name: 'Coxipó x Centro',               empresa: 'Via Norte',    fleetUtil: 7,  tripsUtil: 56, kmProdUtil: 980,  idlePct: 0.11, avgSpeed: 23.5, occupancy: 0.71, headway: { morning: 9,  midday: 15, afternoon: 10 } },
  { code: '102',  name: 'CPA III x Alvorada',            empresa: 'Via Norte',    fleetUtil: 6,  tripsUtil: 48, kmProdUtil: 890,  idlePct: 0.14, avgSpeed: 22.1, occupancy: 0.65, headway: { morning: 10, midday: 18, afternoon: 11 } },
  { code: '308',  name: 'Term CPA 3 x Rib do Lipa',      empresa: 'Via Norte',    fleetUtil: 5,  tripsUtil: 40, kmProdUtil: 720,  idlePct: 0.18, avgSpeed: 20.8, occupancy: 0.58, headway: { morning: 12, midday: 20, afternoon: 13 } },
  { code: '308B', name: 'Term CPA 3 x Alencastro',       empresa: 'Via Norte',    fleetUtil: 3,  tripsUtil: 22, kmProdUtil: 310,  idlePct: 0.24, avgSpeed: 19.4, occupancy: 0.44, headway: { morning: 18, midday: 30, afternoon: 20 }, noDomingo: true },
]

interface KmBlock { produtiva: number; ociosa: number }
const kmTotal = (b: KmBlock) => b.produtiva + b.ociosa
const kmPct   = (b: KmBlock) => (kmTotal(b) > 0 ? b.ociosa / kmTotal(b) : 0)

interface DerivedLine extends RawLine {
  fleet: { util: number; sab: number; dom: number }
  trips: { util: number; sab: number; dom: number; mes: number }
  km:    { util: KmBlock; sab: KmBlock; dom: KmBlock; mes: KmBlock }
}

function deriveLine(l: RawLine): DerivedLine {
  const wSab = l.wSab ?? 0.65
  const wDom = l.noDomingo ? 0 : (l.wDom ?? 0.45)

  const util: KmBlock = { produtiva: l.kmProdUtil, ociosa: l.kmProdUtil * l.idlePct / (1 - l.idlePct) }
  const sab:  KmBlock = { produtiva: util.produtiva * wSab, ociosa: util.ociosa * wSab }
  const dom:  KmBlock = { produtiva: util.produtiva * wDom, ociosa: util.ociosa * wDom }
  const mes:  KmBlock = {
    produtiva: util.produtiva * CALENDAR.util + sab.produtiva * CALENDAR.sab + dom.produtiva * CALENDAR.dom,
    ociosa:    util.ociosa    * CALENDAR.util + sab.ociosa    * CALENDAR.sab + dom.ociosa    * CALENDAR.dom,
  }

  const tripsSab = Math.round(l.tripsUtil * wSab)
  const tripsDom = l.noDomingo ? 0 : Math.round(l.tripsUtil * wDom)

  return {
    ...l,
    fleet: {
      util: l.fleetUtil,
      sab:  Math.max(l.fleetUtil > 0 ? 1 : 0, Math.round(l.fleetUtil * 0.7)),
      dom:  l.noDomingo ? 0 : Math.max(l.fleetUtil > 0 ? 1 : 0, Math.round(l.fleetUtil * 0.5)),
    },
    trips: {
      util: l.tripsUtil,
      sab:  tripsSab,
      dom:  tripsDom,
      mes:  l.tripsUtil * CALENDAR.util + tripsSab * CALENDAR.sab + tripsDom * CALENDAR.dom,
    },
    km: { util, sab, dom, mes },
  }
}

const LINES = RAW_LINES.map(deriveLine)

// ── agregados de plano/período ───────────────────────────────────────────────

const fleetOperacional = LINES.reduce((s, l) => s + l.fleetUtil, 0)
const kmMonthProdutiva = LINES.reduce((s, l) => s + l.km.mes.produtiva, 0)
const kmMonthOciosa    = LINES.reduce((s, l) => s + l.km.mes.ociosa, 0)
const kmMonthTotal     = kmMonthProdutiva + kmMonthOciosa
const idlePctPlan      = kmMonthOciosa / kmMonthTotal

const PLAN = {
  score:     8210,
  pmmPerVeh: Math.round(kmMonthTotal / (fleetOperacional - 2)),
  hvmPerVeh: 185,
}

// ── km por empresa ────────────────────────────────────────────────────────

const byEmpresa = Object.values(
  LINES.reduce<Record<string, { empresa: string; produtiva: number; ociosa: number }>>((acc, l) => {
    acc[l.empresa] ??= { empresa: l.empresa, produtiva: 0, ociosa: 0 }
    acc[l.empresa].produtiva += l.km.mes.produtiva
    acc[l.empresa].ociosa    += l.km.mes.ociosa
    return acc
  }, {}),
).map(e => ({ ...e, total: e.produtiva + e.ociosa, pct: (e.produtiva + e.ociosa) / kmMonthTotal }))
  .sort((a, b) => b.total - a.total)

// ── km por tipo de dia (consolidado, todas as linhas) ────────────────────────

const DAY_TYPES = [
  { key: 'util' as const, label: 'Dia útil', days: CALENDAR.util },
  { key: 'sab'  as const, label: 'Sábado',   days: CALENDAR.sab },
  { key: 'dom'  as const, label: 'Domingo',  days: CALENDAR.dom },
]

const dayTypeSummary = DAY_TYPES.map(dt => {
  const produtiva = LINES.reduce((s, l) => s + l.km[dt.key].produtiva, 0)
  const ociosa    = LINES.reduce((s, l) => s + l.km[dt.key].ociosa, 0)
  return { ...dt, produtiva, ociosa, total: produtiva + ociosa, pct: kmPct({ produtiva, ociosa }) }
})

// ── formatação ────────────────────────────────────────────────────────────

function fmtKm(v: number): string {
  return Math.round(v).toLocaleString('pt-BR')
}
function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`
}
function fmtSpeed(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

// ── status tokens (mesma convenção de AutoList.tsx Badge / LineSummaryView) ──

const STATUS_CLS = {
  success:     'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning:     'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  destructive: 'bg-destructive/15 text-destructive',
} as const

function occupancyStatus(v: number): keyof typeof STATUS_CLS {
  if (v >= 0.90) return 'destructive'
  if (v >= 0.75) return 'warning'
  return 'success'
}

// dark: um tom mais escuro (600 em vez de 500) — o 500 sozinho fica muito
// luminoso em fundo escuro
const CHART_GREEN_CLS = 'bg-emerald-500 dark:bg-emerald-600' // produtiva (status "good")
const CHART_AMBER_CLS = 'bg-amber-500 dark:bg-amber-600'     // ociosa (status "warning")

// bg sutil pra distinguir a linha de grupo (Frota|Viagens, Útil|Sáb|Dom|Mês) do
// resto do header — dois tons de --muted, mesma cor em light/dark, só a
// opacidade cresce um passo entre o rótulo do grupo e o subcabeçalho embaixo
const HEADER_GROUP_BG    = 'bg-muted/40'
const HEADER_SUBGROUP_BG = 'bg-muted/60'

// ── pedaços de UI ────────────────────────────────────────────────────────────

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

// Barra empilhada produtiva/ociosa em divs simples — poucos segmentos
// (empresas), controle exato do gap de 2px e do label de % na ponta, sem
// depender de um chart lib pra 2-4 categorias.
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

function HeadwayCell({ headway }: { headway: RawLine['headway'] }) {
  return (
    <div className="flex items-center gap-2.5 tabular-nums text-xs">
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" />{headway.morning}′</span>
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />{headway.midday}′</span>
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" />{headway.afternoon}′</span>
    </div>
  )
}

// ── colunas por aba da tabela de linhas ──────────────────────────────────────

type Tab = 'frota' | 'indicadores' | 'km'
const TABS: { key: Tab; label: string }[] = [
  { key: 'frota',       label: 'Frota' },
  { key: 'indicadores', label: 'Indicadores' },
  { key: 'km',          label: 'Km' },
]

// `divider` marca a fronteira entre grupos (Útil|Sáb|Dom|Mês, ou Frota|Viagens)
// com uma borda um pouco mais grossa que a divisória normal de linha — sem
// cor nova, só espessura, pra "isso é outro grupo" não se confundir com
// "isso é só a próxima coluna".
const GROUP_DIVIDER = 'border-l-2 border-border'

function KmGroupHeader({ label, divider }: { label: string; divider?: boolean }) {
  return (
    <>
      <th className={cn('text-right font-medium px-2 py-1 whitespace-nowrap', divider && GROUP_DIVIDER)}>Produt.</th>
      <th className="text-right font-medium px-2 py-1 whitespace-nowrap">Ociosa</th>
      <th className="text-right font-medium px-2 py-1 whitespace-nowrap">%</th>
      {label === 'Mês' && <th className="text-right font-medium px-2 py-1 whitespace-nowrap">Total</th>}
    </>
  )
}

function KmGroupCells({ block, withTotal, divider }: { block: KmBlock; withTotal?: boolean; divider?: boolean }) {
  return (
    <>
      <td className={cn('px-2 py-1.5 text-right', divider && GROUP_DIVIDER)}>{fmtKm(block.produtiva)}</td>
      <td className="px-2 py-1.5 text-right">{fmtKm(block.ociosa)}</td>
      <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtPct(kmPct(block))}</td>
      {withTotal && <td className="px-2 py-1.5 text-right font-medium">{fmtKm(kmTotal(block))}</td>}
    </>
  )
}

export default function PlaygroundPage() {
  const [tab, setTab] = useState<Tab>('frota')

  return (
    <div className="p-6 space-y-5 w-full max-w-screen-2xl mx-auto">
      {/* ── cabeçalho ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Dados Operacionais Previstos</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Metropolitana Sul · Dia útil</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Escopo</label>
            <Select size="sm" defaultValue="metro-sul" className="w-40">
              <option value="metro-sul">Metropolitana Sul</option>
            </Select>
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Competência</label>
            <Select size="sm" defaultValue="2026-09" className="w-32">
              <option value="2026-09">Set/2026</option>
            </Select>
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Início</label>
            <input type="date" defaultValue="2026-09-01" className="h-[30px] rounded-sm border border-input text-xs px-2 w-[130px]" />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Fim</label>
            <input type="date" defaultValue="2026-09-30" className="h-[30px] rounded-sm border border-input text-xs px-2 w-[130px]" />
          </div>
          <Button size="sm" variant="outline"><Icons.Search className="w-3.5 h-3.5" />Buscar</Button>
        </div>
      </div>

      {/* ── composição do período (calendário) ── */}
      <div className="rounded-md border border-border bg-card px-4 py-2.5 flex items-center gap-5 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <Icons.CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          Setembro/2026
        </span>
        <span className="text-muted-foreground">·</span>
        <span><span className="font-medium">{CALENDAR.util}</span> <span className="text-muted-foreground">dias úteis</span></span>
        <span><span className="font-medium">{CALENDAR.sab}</span> <span className="text-muted-foreground">sábados</span></span>
        <span><span className="font-medium">{CALENDAR.dom}</span> <span className="text-muted-foreground">domingos</span></span>
        <span className="text-muted-foreground">·</span>
        <span><span className="font-medium">{CALENDAR_TOTAL}</span> <span className="text-muted-foreground">dias no período</span></span>
      </div>

      {/* ── KPI hero row ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={Icons.Bus}      label="Frota operacional"  value={String(fleetOperacional)} />
        <StatTile icon={Icons.Route}    label="Km planejada (mês)" value={`${fmtKm(kmMonthTotal)} km`} />
        <StatTile icon={Icons.Gauge}    label="% Ociosidade"       value={fmtPct(idlePctPlan)} sub={`${fmtKm(kmMonthOciosa)} km / mês`} />
        <StatTile icon={Icons.Sparkles} label="Score do plano"     value={PLAN.score.toLocaleString('pt-BR')} sub="de 9.999" />
        <StatTile icon={Icons.Ruler}    label="PMM"                value={`${fmtKm(PLAN.pmmPerVeh)} km`} sub="por veículo/mês" />
        <StatTile icon={Icons.Clock}    label="HVM"                value={`${PLAN.hvmPerVeh} h`} sub="por veículo/mês" />
      </div>

      {/* ── km por empresa + km por tipo de dia ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold">Km por empresa</h2>
              <p className="text-[11px] text-muted-foreground">Produtiva x ociosa, % do total do período</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className={cn('w-2.5 h-2.5 rounded-sm', CHART_GREEN_CLS)} />Produtiva</span>
              <span className="flex items-center gap-1.5"><span className={cn('w-2.5 h-2.5 rounded-sm', CHART_AMBER_CLS)} />Ociosa</span>
            </div>
          </div>
          <div className="space-y-3">
            {byEmpresa.map(e => (
              <div key={e.empresa} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium flex items-center gap-1.5"><Icons.Building2 className="w-3.5 h-3.5 text-muted-foreground" />{e.empresa}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtKm(e.total)} km · <span className="font-medium text-foreground">{(e.pct * 100).toFixed(1)}%</span></span>
                </div>
                <SplitBar produtiva={e.produtiva} ociosa={e.ociosa} />
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
              {dayTypeSummary.map(d => (
                <tr key={d.key} className="border-b border-border">
                  <td className="px-2 py-1.5">{d.label} <span className="text-muted-foreground">({d.days}x)</span></td>
                  <td className="px-2 py-1.5 text-right">{fmtKm(d.produtiva)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtKm(d.ociosa)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtPct(d.pct)}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{fmtKm(d.total)}</td>
                </tr>
              ))}
              <tr className="bg-accent/40 font-medium">
                <td className="px-2 py-1.5">Mês</td>
                <td className="px-2 py-1.5 text-right">{fmtKm(kmMonthProdutiva)}</td>
                <td className="px-2 py-1.5 text-right">{fmtKm(kmMonthOciosa)}</td>
                <td className="px-2 py-1.5 text-right">{fmtPct(idlePctPlan)}</td>
                <td className="px-2 py-1.5 text-right">{fmtKm(kmMonthTotal)}</td>
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
          {tab === 'indicadores' && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-2.5">
              Headway:
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" />manhã</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />entrepico</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" />tarde</span>
            </span>
          )}
        </div>

        <div className="overflow-auto max-h-[420px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10">
              {tab === 'km' && (
                <>
                  <tr className="text-[11px] text-muted-foreground">
                    <th rowSpan={2} className="text-left font-medium px-3 py-1.5 align-bottom">Linha</th>
                    <th colSpan={3} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG)}>Dia útil</th>
                    <th colSpan={3} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, GROUP_DIVIDER)}>Sábado</th>
                    <th colSpan={3} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, GROUP_DIVIDER)}>Domingo</th>
                    <th colSpan={4} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, GROUP_DIVIDER)}>Mês</th>
                  </tr>
                  <tr className={cn('text-[11px] text-muted-foreground border-b border-border', HEADER_SUBGROUP_BG)}>
                    <KmGroupHeader label="Útil" />
                    <KmGroupHeader label="Sáb" divider />
                    <KmGroupHeader label="Dom" divider />
                    <KmGroupHeader label="Mês" divider />
                  </tr>
                </>
              )}

              {tab === 'frota' && (
                <>
                  <tr className="text-[11px] text-muted-foreground">
                    <th rowSpan={2} className="text-left font-medium px-3 py-1.5 align-bottom">Linha</th>
                    <th colSpan={3} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG)}>Frota</th>
                    <th colSpan={4} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, GROUP_DIVIDER)}>Viagens</th>
                  </tr>
                  <tr className={cn('text-[11px] text-muted-foreground border-b border-border', HEADER_SUBGROUP_BG)}>
                    <th className="text-right font-medium px-2 py-1">Útil</th>
                    <th className="text-right font-medium px-2 py-1">Sáb</th>
                    <th className="text-right font-medium px-2 py-1">Dom</th>
                    <th className={cn('text-right font-medium px-2 py-1', GROUP_DIVIDER)}>Útil</th>
                    <th className="text-right font-medium px-2 py-1">Sáb</th>
                    <th className="text-right font-medium px-2 py-1">Dom</th>
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
              {LINES.map((l, i) => (
                <tr key={l.code} className={cn('border-b border-border last:border-0 hover:bg-row-hover', i % 2 === 1 && 'bg-muted/40')}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.code}</div>
                    <div className="text-[11px] text-muted-foreground">{l.name}</div>
                  </td>

                  {tab === 'frota' && (<>
                    <td className="px-2 py-2 text-right">{l.fleet.util}</td>
                    <td className="px-2 py-2 text-right">{l.fleet.sab}</td>
                    <td className="px-2 py-2 text-right">{l.fleet.dom || '—'}</td>
                    <td className={cn('px-2 py-2 text-right', GROUP_DIVIDER)}>{l.trips.util}</td>
                    <td className="px-2 py-2 text-right">{l.trips.sab}</td>
                    <td className="px-2 py-2 text-right">{l.trips.dom || '—'}</td>
                    <td className="px-2 py-2 text-right font-medium">{l.trips.mes.toLocaleString('pt-BR')}</td>
                  </>)}

                  {tab === 'km' && (<>
                    <KmGroupCells block={l.km.util} />
                    <KmGroupCells block={l.km.sab} divider />
                    <KmGroupCells block={l.km.dom} divider />
                    <KmGroupCells block={l.km.mes} divider withTotal />
                  </>)}

                  {tab === 'indicadores' && (<>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtSpeed(l.avgSpeed)}</td>
                    <td className="px-3 py-2">
                      <span className={cn('mx-auto flex w-16 items-center justify-center rounded-sm px-2 py-0.5 font-medium', STATUS_CLS[occupancyStatus(l.occupancy)])}>
                        {(l.occupancy * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-3 py-2"><HeadwayCell headway={l.headway} /></td>
                  </>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
