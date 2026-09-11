'use client'

// Prototype for FrequencyPanel.tsx's multi-line delta visualization (Fase 4,
// see docs/proposal/plan_generate_multiline_delta_v1.md). Style only, no
// interactivity — reuses the real TimeRuler/LABEL_WIDTH and the exact tick
// markup FrequencyPanel.tsx already renders, so this reads as a faithful
// preview of the row area, not a mockup.

import type { ViewportSnapshot } from '../transit/vehicle-plan/[id]/engine/gantt.types'
import { LABEL_WIDTH }           from '../transit/vehicle-plan/[id]/components/GanttBoard'
import { TimeRuler }             from '../transit/vehicle-plan/[id]/components/TimeRuler'

const DIRECTION_COLORS: Record<string, string> = {
  IDA:   'bg-blue-500',
  VOLTA: 'bg-emerald-500',
}

// Distinct from DIRECTION_COLORS on purpose — once a row mixes lines instead
// of one line per row, reusing blue/emerald would collide with the meaning
// those colors already carry elsewhere in this same panel (direction).
const LINE_COLORS = ['bg-sky-400', 'bg-orange-400']

function fmtMin(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
}

function minuteToX(min: number, vp: ViewportSnapshot): number {
  return (min - vp.dayStartMinute) * vp.pixelsPerMinute - vp.scrollX
}

// ── synthetic data — two lines sharing a delta on IDA only, VOLTA untouched ──
// (mirrors the real 308/308B shape used to validate Fase 4, but with a
// non-zero offset for one of the two lines so the reposition is visible —
// the real pair's IDA offsets both happen to be 0, which wouldn't show much)

const LINE_308  = { code: '308',  offsetToDelta: 45 } // origin is 45min away from the delta
const LINE_308B = { code: '308B', offsetToDelta: 0 }  // origin IS the delta

const DEP_308  = [290, 311, 332, 353, 374, 395, 416, 437] // 04:50, 05:11, ...
const DEP_308B = [310, 335, 360, 385, 410, 435]           // 05:10, 05:35, ...

const DEP_VOLTA = [350, 380, 410, 440, 470] // single line, no delta group — stays untouched throughout

const VP: ViewportSnapshot = { dayStartMinute: 240, pixelsPerMinute: 3, width: 760, scrollX: 0, scrollY: 0 }

interface Tick { min: number; colorClass: string; title: string }

function TickRow({ ticks, vp }: { ticks: Tick[]; vp: ViewportSnapshot }) {
  return (
    <div className="relative h-4 overflow-hidden">
      {ticks.map((t, i) => (
        <div
          key={i}
          title={t.title}
          className={`absolute top-0.5 bottom-0.5 w-px ${t.colorClass} opacity-80`}
          style={{ left: minuteToX(t.min, vp) }}
        />
      ))}
    </div>
  )
}

interface RowSpec { label: string; ticks: Tick[]; annotation?: string }

function Panel({ rows, vp }: { rows: RowSpec[]; vp: ViewportSnapshot }) {
  return (
    <div className="border rounded-md bg-card overflow-hidden">
      <div className="flex items-stretch">
        <div className="shrink-0 border-r flex flex-col justify-center py-2 px-2 gap-1" style={{ width: LABEL_WIDTH }}>
          {rows.map((r, i) => (
            <div key={i} className="h-4 flex flex-col items-end justify-center leading-none">
              <span className="text-[10px] font-medium text-muted-foreground tracking-wider">{r.label}</span>
              {r.annotation && <span className="text-[9px] text-muted-foreground/70">{r.annotation}</span>}
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0 overflow-hidden py-2 flex flex-col gap-1">
          {rows.map((r, i) => <TickRow key={i} ticks={r.ticks} vp={vp} />)}
        </div>
      </div>
      <div className="flex border-t">
        <div className="shrink-0 border-r" style={{ width: LABEL_WIDTH }} />
        <div className="flex-1 min-w-0">
          <TimeRuler viewport={vp} className="border-b-0" />
        </div>
      </div>
    </div>
  )
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${it.color}`} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

function Scenario({ title, description, rows, legend }: {
  title: string; description: string; rows: RowSpec[]; legend: { color: string; label: string }[]
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground max-w-2xl">{description}</p>
      </div>
      <Panel rows={rows} vp={VP} />
      <Legend items={legend} />
    </section>
  )
}

export default function PlaygroundPage() {
  const voltaTicks: Tick[] = DEP_VOLTA.map(min => ({ min, colorClass: DIRECTION_COLORS.VOLTA, title: fmtMin(min) }))

  // ── Hoje — baseline, unmodified FrequencyPanel: one row per direction,
  // every line sharing a direction already lands in the same row today, just
  // colored uniformly by direction and positioned at raw departure time ──
  const idaTicksToday: Tick[] = [
    ...DEP_308.map(min  => ({ min, colorClass: DIRECTION_COLORS.IDA, title: `308 · ${fmtMin(min)}` })),
    ...DEP_308B.map(min => ({ min, colorClass: DIRECTION_COLORS.IDA, title: `308B · ${fmtMin(min)}` })),
  ]
  const baselineRows: RowSpec[] = [
    { label: 'IDA',   ticks: idaTicksToday },
    { label: 'VOLTA', ticks: voltaTicks },
  ]

  // ── Proposta 1 — row extra combinada no delta, rows de hoje intactas ──
  const combinedTicks: Tick[] = [
    ...DEP_308.map(min  => ({ min: min + LINE_308.offsetToDelta,  colorClass: LINE_COLORS[0], title: `308 · cruza às ${fmtMin(min + LINE_308.offsetToDelta)}` })),
    ...DEP_308B.map(min => ({ min: min + LINE_308B.offsetToDelta, colorClass: LINE_COLORS[1], title: `308B · cruza às ${fmtMin(min + LINE_308B.offsetToDelta)}` })),
  ]
  const proposal1Rows: RowSpec[] = [
    { label: 'IDA',            ticks: idaTicksToday },
    { label: 'IDA · delta',    ticks: combinedTicks, annotation: 'Term Cpa 3' },
    { label: 'VOLTA',          ticks: voltaTicks },
  ]

  // ── Proposta 2 — reposiciona os pontos da própria row IDA para o instante
  // de cruzamento; VOLTA não tem grupo de delta aqui, continua como hoje ──
  const proposal2Rows: RowSpec[] = [
    { label: 'IDA', ticks: combinedTicks, annotation: 'delta: Term Cpa 3' },
    { label: 'VOLTA', ticks: voltaTicks },
  ]

  const directionLegend = [
    { color: DIRECTION_COLORS.IDA,   label: 'IDA (qualquer linha)' },
    { color: DIRECTION_COLORS.VOLTA, label: 'VOLTA (qualquer linha)' },
  ]
  const lineLegend = [
    { color: LINE_COLORS[0], label: '308' },
    { color: LINE_COLORS[1], label: '308B' },
    { color: DIRECTION_COLORS.VOLTA, label: 'VOLTA (sem grupo de delta, inalterada)' },
  ]

  return (
    <div className="p-6 space-y-10 max-w-4xl">
      <div className="space-y-1">
        <h1 className="text-base font-semibold">FrequencyPanel — visualização multilinha no delta</h1>
        <p className="text-sm text-muted-foreground">
          308 (offset 45min até o delta) e 308B (origem já é o delta) na IDA, sintéticos —
          o par real 308/308B tem offset 0 nas duas linhas na IDA, o que não deixaria a
          reposição visível. VOLTA não tem grupo de delta neste exemplo, fica como está hoje
          nos três cenários abaixo para servir de controle.
        </p>
      </div>

      <Scenario
        title="Hoje — baseline"
        description="FrequencyPanel.tsx atual: uma row por sentido, todas as linhas daquele sentido já caem juntas na mesma row, coloridas por direção, posicionadas no horário de partida bruto (não no cruzamento)."
        rows={baselineRows}
        legend={directionLegend}
      />

      <Scenario
        title="Proposta 1 — row extra combinada no delta"
        description="Rows de hoje ficam intactas; uma terceira row é inserida logo abaixo de IDA, mostrando as mesmas viagens já reposicionadas no instante de cruzamento no delta, coloridas por linha em vez de por sentido."
        rows={proposal1Rows}
        legend={[...directionLegend, ...lineLegend.slice(0, 2)]}
      />

      <Scenario
        title="Proposta 2 — reposiciona os pontos existentes (preferida)"
        description="A própria row IDA passa a plotar o instante de cruzamento no delta em vez do horário de partida, colorida por linha. VOLTA (sem grupo de delta aqui) continua exatamente como hoje — só a row com delta ativo muda de semântica."
        rows={proposal2Rows}
        legend={lineLegend}
      />
    </div>
  )
}
