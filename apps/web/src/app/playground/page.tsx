'use client'

import { Icons } from '@/lib/icons'

// Rota de teste — não linkada no menu. Protótipos de linguagem visual para
// blocos de intervalo (breaks) no Gantt de apps/web/.../vehicle-plan/[id].
// Estilo atual: pill cinza-chumbo, sólido/tracejado para pago/não-pago,
// hachura âmbar para irregularidade (ver engine/renderer.ts).

const SCALE = 5 // px por minuto, só para a largura do slot do intervalo

interface Scenario {
  key:         string
  label:       string
  code:        string
  isPaid:      boolean
  minutes:     number
  minMinutes:  number | null
  maxMinutes:  number | null
}

const SCENARIOS: Scenario[] = [
  { key: 'paid-ok',      label: 'Pago · dentro da faixa (30min, 20–45)',       code: 'REF',  isPaid: true,  minutes: 30, minMinutes: 20, maxMinutes: 45 },
  { key: 'unpaid-ok',    label: 'Não pago · dentro da faixa (15min, 10–20)',   code: 'DESC', isPaid: false, minutes: 15, minMinutes: 10, maxMinutes: 20 },
  { key: 'paid-over',    label: 'Pago · acima do máximo (55min, máx 40)',      code: 'REF',  isPaid: true,  minutes: 55, minMinutes: 20, maxMinutes: 40 },
  { key: 'unpaid-under', label: 'Não pago · abaixo do mínimo (5min, mín 10)',  code: 'DESC', isPaid: false, minutes: 5,  minMinutes: 10, maxMinutes: 20 },
]

function irregularityOf(sc: Scenario): 'over' | 'under' | null {
  if (sc.maxMinutes != null && sc.minutes > sc.maxMinutes) return 'over'
  if (sc.minMinutes != null && sc.minutes < sc.minMinutes) return 'under'
  return null
}

function TripBlock({ label }: { label: string }) {
  return (
    <div className="w-16 h-9 flex-shrink-0 rounded-sm bg-sky-700/70 flex items-center justify-center text-[9px] text-white font-medium">
      {label}
    </div>
  )
}

// ── 1. bracket ────────────────────────────────────────────────────────────

function renderBracket(sc: Scenario) {
  const irr        = irregularityOf(sc)
  const lineBorder = irr ? 'border-amber-500' : 'border-slate-400'
  const labelText  = irr ? 'text-amber-500' : 'text-muted-foreground'
  return (
    <>
      <div className={`absolute inset-x-0 border-t ${sc.isPaid ? '' : 'border-dashed'} ${lineBorder}`} style={{ top: '50%' }} />
      <div className={`absolute left-0 top-1/4 bottom-1/4 border-l ${lineBorder}`} />
      <div className={`absolute right-0 top-1/4 bottom-1/4 border-l ${lineBorder}`} />
      <div className={`absolute inset-x-0 text-center text-[9px] leading-none whitespace-nowrap ${labelText}`} style={{ top: 'calc(50% + 3px)' }}>
        {sc.minutes}'
      </div>
    </>
  )
}

// ── 2. pílula listrada ───────────────────────────────────────────────────

function renderStripedPill(sc: Scenario) {
  const irr = irregularityOf(sc)
  const bg = sc.isPaid
    ? 'repeating-linear-gradient(135deg, rgb(99 102 241) 0px, rgb(99 102 241) 4px, rgb(79 70 229) 4px, rgb(79 70 229) 8px)'
    : 'repeating-linear-gradient(135deg, rgba(148,163,184,0.35) 0px, rgba(148,163,184,0.35) 3px, transparent 3px, transparent 9px)'
  return (
    <div
      className={`absolute inset-y-1.5 inset-x-0 rounded-full flex items-center justify-center overflow-hidden ${irr ? 'ring-2 ring-amber-500' : ''}`}
      style={{ backgroundImage: bg }}
    >
      <span className={`text-[9px] font-medium px-1 truncate ${sc.isPaid ? 'text-white' : 'text-slate-300'}`}>
        {sc.minutes}m
      </span>
    </div>
  )
}

// ── 3. selo com ícone ────────────────────────────────────────────────────

function renderIconBadge(sc: Scenario) {
  const irr  = irregularityOf(sc)
  const Icon = sc.isPaid ? Icons.Coffee : Icons.Timer
  return (
    <>
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
      <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center ring-2 ring-background ${sc.isPaid ? 'bg-indigo-500' : 'bg-slate-500'}`}>
        <Icon className="w-3.5 h-3.5 text-white" />
        {irr && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 flex items-center justify-center">
            <Icons.AlertCircle className="w-2.5 h-2.5 text-white" />
          </span>
        )}
      </div>
      <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground whitespace-nowrap">
        {sc.minutes}min
      </div>
    </>
  )
}

// ── 4. bloco preenchido ──────────────────────────────────────────────────

function renderFilledBlock(sc: Scenario) {
  const irr = irregularityOf(sc)
  return (
    <div className={`absolute inset-0 rounded-sm flex items-center border ${
      sc.isPaid ? 'bg-indigo-500/20 border-indigo-500/60' : 'bg-transparent border-dashed border-slate-400'
    }`}>
      <div className={`w-1 self-stretch rounded-l-sm ${sc.isPaid ? 'bg-indigo-500' : 'bg-slate-400'}`} />
      <span className="text-[9px] px-1 truncate text-foreground/80">{sc.code} {sc.minutes}m</span>
      {irr && (
        <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-amber-500 flex items-center justify-center">
          <Icons.AlertCircle className="w-2.5 h-2.5 text-white" />
        </span>
      )}
    </div>
  )
}

// ── 5. bandeirola ────────────────────────────────────────────────────────

function renderFlagTag(sc: Scenario) {
  const irr = irregularityOf(sc)
  return (
    <>
      <div className="absolute left-0 top-0 bottom-0 border-l border-dashed border-muted-foreground/40" />
      <div className="absolute right-0 top-0 bottom-0 border-l border-dashed border-muted-foreground/40" />
      <div
        className={`absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 pt-0.5 pb-1.5 text-[9px] font-medium text-white whitespace-nowrap ${
          irr ? 'bg-amber-500' : sc.isPaid ? 'bg-slate-600' : 'bg-slate-400'
        }`}
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%)' }}
      >
        {sc.code}
      </div>
      <div className="absolute -top-9 inset-x-0 text-center text-[8px] text-muted-foreground whitespace-nowrap">
        {sc.minutes}min
      </div>
    </>
  )
}

// ── 6. faixa de conformidade (gauge) ────────────────────────────────────

function renderGaugeRange(sc: Scenario) {
  const irr           = irregularityOf(sc)
  const min           = sc.minMinutes ?? 0
  const max           = sc.maxMinutes ?? min + 20
  const span          = Math.max(max - min, 1)
  const fillPct       = Math.min(100, Math.max(0, ((sc.minutes - min) / span) * 100))
  const overflowOver  = irr === 'over'
  const overflowUnder = irr === 'under'
  const barColor      = irr ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <>
      <div className="absolute inset-y-2 inset-x-0 rounded-sm bg-slate-400/15 border border-border" />
      <div className="absolute -top-9 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
        <div className="relative w-16 h-1.5 rounded-full bg-muted">
          <div
            className={`absolute left-0 top-0 h-full rounded-full ${barColor}`}
            style={{ width: `${overflowUnder ? 6 : fillPct}%` }}
          />
          {overflowOver  && <span className="absolute -right-2 -top-1 text-amber-500 text-[10px] leading-none">›</span>}
          {overflowUnder && <span className="absolute -left-2 -top-1 text-amber-500 text-[10px] leading-none">‹</span>}
        </div>
        <span className="text-[8px] text-muted-foreground whitespace-nowrap">{sc.minutes}m ({min}–{max})</span>
      </div>
    </>
  )
}

// ── page ──────────────────────────────────────────────────────────────────

const STYLES: Array<{ key: string; title: string; description: string; render: (sc: Scenario) => React.ReactNode }> = [
  { key: 'bracket', title: '1. Bracket / silêncio',            description: 'Sem preenchimento — só marcações de início/fim e uma linha guia, como um "silêncio" numa partitura. Rótulo flutua acima.',                          render: renderBracket },
  { key: 'striped', title: '2. Pílula listrada',                description: 'Evolução do padrão atual: textura em vez de cor sólida para diferenciar pago/não-pago; anel âmbar sinaliza irregularidade.',                            render: renderStripedPill },
  { key: 'icon',    title: '3. Selo com ícone',                 description: 'Ícone central (café = pago, timer = não-pago) sobre linha fina conectando as viagens; irregularidade vira um badge sobreposto.',                         render: renderIconBadge },
  { key: 'filled',  title: '4. Bloco preenchido',                description: 'Mesma altura da viagem, com barra de acento à esquerda indicando o tipo; irregularidade vira um badge no canto.',                                        render: renderFilledBlock },
  { key: 'flag',    title: '5. Bandeirola',                     description: 'Guias tracejadas verticais delimitam o intervalo; uma bandeirola com o código flutua acima — linguagem visual bem distinta das viagens.',                render: renderFlagTag },
  { key: 'gauge',   title: '6. Faixa de conformidade (gauge)',  description: 'Mini barra comparando a duração real contra o intervalo mínimo/máximo permitido — mostra a política, não só um alerta binário.',                          render: renderGaugeRange },
]

function StyleSection({ title, description, render }: { title: string; description: string; render: (sc: Scenario) => React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="border border-border rounded-md bg-card px-6 pt-16 pb-6 flex flex-wrap gap-10">
        {SCENARIOS.map(sc => (
          <div key={sc.key} className="flex flex-col items-center gap-3">
            <div className="flex items-end">
              <TripBlock label="1203A" />
              <div className="relative h-9" style={{ width: Math.max(sc.minutes * SCALE, 28) }}>
                {render(sc)}
              </div>
              <TripBlock label="1203B" />
            </div>
            <span className="text-[10px] text-muted-foreground text-center max-w-[150px] leading-tight">{sc.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function PlaygroundPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-10">
      <header>
        <h1 className="text-xl font-semibold">Playground — representação visual de intervalos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rota de teste (sem link no menu). Seis linguagens visuais alternativas para o bloco de intervalo
          (break) no Gantt do planejamento de veículos, cada uma com os mesmos 4 cenários: pago/não-pago × normal/irregular.
        </p>
      </header>

      {STYLES.map(style => (
        <StyleSection key={style.key} title={style.title} description={style.description} render={style.render} />
      ))}

      <section className="border border-border rounded-md bg-card p-6 space-y-2">
        <h2 className="text-sm font-semibold">Observações</h2>
        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
          <li><strong className="text-foreground">Bracket</strong> e <strong className="text-foreground">bandeirola</strong> deixam a timeline mais "limpa" (não competem visualmente com os retângulos de viagem), mas dependem de espaço vertical acima da linha — pode conflitar com zoom baixo ou linhas muito próximas.</li>
          <li><strong className="text-foreground">Selo com ícone</strong> é o mais legível para reconhecer o tipo de intervalo à distância (café vs. timer), mas não escala bem para blocos muito estreitos (zoom alto).</li>
          <li><strong className="text-foreground">Bloco preenchido</strong> é o mais parecido com o padrão atual (mesma linguagem retangular das viagens) — troca mais fácil, risco de confundir com deadrun.</li>
          <li><strong className="text-foreground">Faixa de conformidade (gauge)</strong> é a única que expõe a política (mín/máx) diretamente, não só um alerta binário — mais útil operacionalmente, mas é o mais "carregado" visualmente.</li>
          <li>Todas usam âmbar só para irregularidade, mantendo esse sinal consistente com o resto do Gantt (mesma cor de <code>IRREGULAR_COLOR</code> em <code>renderer.ts</code>).</li>
        </ul>
      </section>
    </div>
  )
}
