'use client'

// Painel de Escala — the analyses of the snapshot (GET /transit/console). Layout validated in the
// prototype: KPIs and alerts on top, a side menu with each analysis' status, the chosen one beside.

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  CONSOLE_SECTIONS, CONSOLE_SECTION_LABEL,
  type ConsoleAlert, type ConsoleLink, type ConsoleSection, type ConsoleSectionStatus, type ConsoleSeverity, type ConsoleSnapshot,
} from '@nyx/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ConsoleAction } from './AdjustModal'
import { Icons, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export const fmtTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const fmtDay  = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
export const signed  = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

// the page's context, for the links that go to the Escala
export interface ConsoleCtx { branchId: string; role: string; onSection: (s: ConsoleSection) => void }

export function hrefOf(link: ConsoleLink, ctx: ConsoleCtx): string | null {
  switch (link.kind) {
    case 'vehicle-plan':      return `/transit/vehicle-plan/${link.id}`
    case 'crew-plan':         return `/transit/crew-plan/${link.id}`
    case 'crew-member':       return `/transit/crew-member/${link.id}`
    case 'crew-member-lines': return `/transit/crew-member-line?crewMemberId=${link.id}`
    case 'crew-shift':        return `/transit/crew-shift/${link.id}`
    case 'rest-pattern':      return `/transit/rest-pattern/${link.id}`
    case 'employee':          return `/hr/employee/${link.id}`
    case 'escala':            return `/transit/daily-operation?${new URLSearchParams({ empresa: ctx.branchId, funcao: ctx.role, data: link.date, modo: 'dia' })}`
    case 'section':           return null
  }
}

export function GoTo({ link, ctx, label }: { link: ConsoleLink; ctx: ConsoleCtx; label: string }) {
  const href = hrefOf(link, ctx)
  const cls = 'inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap'
  if (!href) return <button type="button" onClick={() => link.kind === 'section' && ctx.onSection(link.section)} className={cls}>{label}</button>
  return <Link href={href} className={cls}>{label}<Icons.ExternalLink className="w-3 h-3" /></Link>
}

const LINK_LABEL: Record<ConsoleLink['kind'], string> = {
  'vehicle-plan': 'Planejamento', 'crew-plan': 'Escala lógica', escala: 'Escala', 'crew-member': 'Operador', 'crew-member-lines': 'Linhas',
  'crew-shift': 'Turno', 'rest-pattern': 'Regime', employee: 'Funcionário', section: 'Abrir',
}

export function Card({ title, icon: Icon, aside, children, className }: { title: string; icon: LucideIcon; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card flex flex-col min-w-0', className)}>
      <header className="flex items-center gap-2 px-4 h-11 border-b border-border">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ms-auto flex items-center gap-2">{aside}</div>
      </header>
      <div className="p-4 text-sm flex-1">{children}</div>
    </section>
  )
}

// the page's shape while the snapshot is computed (the sizing takes a few seconds)
export function ConsoleSkeleton() {
  const bar = 'rounded-sm bg-muted animate-pulse'
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="Calculando o quadro">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
            <div className={cn(bar, 'h-3 w-20')} />
            <div className={cn(bar, 'h-7 w-14')} />
            <div className={cn(bar, 'h-2.5 w-32')} />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card flex flex-col items-center justify-center gap-2 py-10">
        <Icons.Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm font-medium">Calculando o quadro…</p>
        <p className="text-xs text-muted-foreground">Simulando a escala de 5 semanas — pode levar alguns segundos</p>
      </div>
      <div className="grid md:grid-cols-[15rem_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-2">{Array.from({ length: 7 }, (_, i) => <div key={i} className={cn(bar, 'h-9 w-full')} />)}</div>
        <div className={cn(bar, 'h-64 w-full rounded-lg')} />
      </div>
    </div>
  )
}

const balanceCls = (b: number) =>
  b < 0 ? 'bg-destructive/12 text-destructive' : b >= 4 ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' : 'bg-muted/60 text-foreground'

const SEV: Record<ConsoleSeverity, { icon: LucideIcon; cls: string }> = {
  error:   { icon: Icons.XCircle,       cls: 'text-destructive' },
  warning: { icon: Icons.AlertTriangle, cls: 'text-amber-600 dark:text-amber-400' },
  info:    { icon: Icons.Info,          cls: 'text-sky-600 dark:text-sky-400' },
}

export const SECTION_ICON: Record<ConsoleSection, LucideIcon> = {
  plans: Icons.Layers, staffing: Icons.Users, shifts: Icons.Clock, groups: Icons.CalendarRange,
  crew: Icons.IdCard, daily: Icons.CalendarX, adjust: Icons.ClipboardList,
}

// the day types the analyses show: those with days in the window or an effective plan
export const shownDayTypes = (s: ConsoleSnapshot) => s.dayTypes.filter(t => t.days > 0 || s.plans.some(p => p.dayTypeId === t.id))

// ── KPIs and alerts ─────────────────────────────────────────────────────────

export function KpiStrip({ snapshot }: { snapshot: ConsoleSnapshot }) {
  const errors = snapshot.alerts.filter(a => a.severity === 'error').length
  const z      = snapshot.sizing
  const main   = shownDayTypes(snapshot).map(t => ({ t, x: snapshot.staffing.totals[t.id] })).filter(x => x.x).sort((a, b) => b.x.demand - a.x.demand)[0]
  // aside: a second figure beside the value, almost as prominent
  const tiles: { label: string; value: string; detail: ReactNode; bad?: boolean; aside?: ReactNode }[] = [
    { label: 'Erros', value: String(errors), detail: `${snapshot.alerts.length} alertas no total`, bad: errors > 0 },
    {
      label:  z.balance < 0 ? 'Falta no quadro' : z.balance > 0 ? 'Sobra no quadro' : 'Quadro',
      value:  z.balance < 0 ? `−${-z.balance}` : z.balance > 0 ? `+${z.balance}` : 'ok',
      detail: (
        <>
          operacional {z.operational} · férias +{z.vacation}
          {z.bank > 0 && <span className="block">abater {z.bankPct}% do banco: +{z.bank}</span>}
        </>
      ),
      bad:    z.balance < 0,
      aside: (
        <span className="flex flex-col items-center rounded-md bg-muted/70 px-3 py-1 leading-tight" title={`atual ${z.current} · necessário ${z.required}`}>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">necessário</span>
          <span className="text-2xl font-semibold tabular-nums">{z.required}</span>
        </span>
      ),
    },
    main
      ? { label: `Cobríveis · ${main.t.name}`, value: `${main.x.coverable}/${main.x.demand}`, detail: 'tabelas, pelo encaixe de horário', bad: main.x.coverable < main.x.demand }
      : { label: 'Cobríveis', value: '—', detail: 'sem plano efetivo' },
    { label: 'Operadores', value: String(snapshot.crew.active), detail: `${snapshot.crew.away} afastados · ${snapshot.crew.vacation} de férias` },
    { label: 'Dias gerados c/ erro', value: String(snapshot.dailyErrors.length), detail: 'não publicados, até 30 dias', bad: snapshot.dailyErrors.length > 0 },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">{t.label}</div>
          <div className="flex items-start justify-between gap-2 mt-0.5">
            <div className={cn('text-2xl font-semibold tabular-nums', t.bad && 'text-destructive')}>{t.value}</div>
            {t.aside}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{t.detail}</div>
        </div>
      ))}
    </div>
  )
}

export function AlertsCard({ alerts, ctx }: { alerts: ConsoleAlert[]; ctx: ConsoleCtx }) {
  const [all, setAll] = useState(false)
  if (!alerts.length) {
    return (
      <Card title="Alertas" icon={Icons.Bell}>
        <p className="flex items-center gap-2 text-muted-foreground"><Icons.CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />Escala equilibrada — nenhum alerta.</p>
      </Card>
    )
  }
  const shown = all ? alerts : alerts.slice(0, 6)
  return (
    <Card title="Alertas" icon={Icons.Bell} aside={alerts.length > 6 && (
      <button type="button" onClick={() => setAll(v => !v)} className="text-xs text-muted-foreground hover:text-foreground">{all ? 'Mostrar menos' : `Ver todos (${alerts.length})`}</button>
    )}>
      <ul className="grid md:grid-cols-2 gap-x-8 gap-y-1.5">
        {shown.map((a, i) => {
          const { icon: Icon, cls } = SEV[a.severity]
          return (
            <li key={`${a.code}-${i}`} className="flex items-start gap-2">
              <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', cls)} />
              <button type="button" onClick={() => ctx.onSection(a.section)} className="flex-1 text-left hover:underline underline-offset-2" title="Abrir a análise">{a.text}</button>
              {a.link && <GoTo link={a.link} ctx={ctx} label={LINK_LABEL[a.link.kind]} />}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export function SectionNav({ value, status, onChange }: { value: ConsoleSection; status: Record<ConsoleSection, ConsoleSectionStatus>; onChange: (s: ConsoleSection) => void }) {
  return (
    <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible md:sticky md:top-0 self-start">
      {CONSOLE_SECTIONS.map(key => {
        const st = status[key]
        const sev = st.severity === 'ok' ? null : SEV[st.severity]
        const Icon = SECTION_ICON[key]
        return (
          <button key={key} type="button" onClick={() => onChange(key)}
            className={cn('flex items-center gap-2.5 rounded-md px-3 h-9 text-sm whitespace-nowrap text-left transition-colors',
              value === key ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{CONSOLE_SECTION_LABEL[key]}</span>
            {sev
              ? <span className={cn('flex items-center gap-1 text-xs tabular-nums', sev.cls)}><sev.icon className="w-3.5 h-3.5" />{st.count}</span>
              : key !== 'adjust' && <Icons.CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
          </button>
        )
      })}
    </nav>
  )
}

// ── A: effective plans ──────────────────────────────────────────────────────

export function PlansSection({ snapshot }: { snapshot: ConsoleSnapshot }) {
  const typeName = new Map(snapshot.dayTypes.map(t => [t.id, t.name]))
  return (
    <Card title="Escalas efetivas" icon={Icons.Layers} aside={<span className="text-xs text-muted-foreground">plano sem data de fim de cada tipo de dia</span>}>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="[&>th]:pb-2 [&>th]:font-medium [&>th]:text-left [&>th]:px-1.5">
            <th>Tipo de dia</th><th>Planejamento · escala</th><th className="text-right!">Frota</th><th className="text-right!">Reserva</th><th className="text-right!">%</th><th className="text-right!">Tabelas</th>
            <th className="text-right!">Jornada</th><th className="text-right!">Extra</th><th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.plans.map(p => {
            const c = p.crewPlan, vp = p.vehiclePlan
            const ok = vp && c && !c.noBranch && !c.uncoveredMinutes && !c.stale && !p.future && !p.linesWithoutPlan.length
            return (
              <tr key={p.dayTypeId} className="border-t border-border/60 [&>td]:py-1.5 [&>td]:px-1.5 tabular-nums align-top">
                <td className="whitespace-nowrap">{typeName.get(p.dayTypeId)}</td>
                <td className="max-w-0 w-full">
                  {vp ? <Link href={`/transit/vehicle-plan/${vp.id}`} className="block truncate hover:underline">{vp.label}</Link> : <span className="text-muted-foreground">sem planejamento efetivo</span>}
                  {c ? <Link href={`/transit/crew-plan/${c.id}`} className="block text-[11px] text-muted-foreground truncate hover:underline">{c.label}</Link>
                    : vp && <span className="block text-[11px] text-destructive">sem escala ativa</span>}
                </td>
                <td className="text-right">{vp?.fleet ?? '—'}</td>
                <td className={cn('text-right', vp && vp.reserve < 0 && 'text-destructive')}>{vp ? vp.reserve : '—'}</td>
                <td className="text-right text-muted-foreground">{vp?.fleet ? `${(Math.round(vp.reserve / vp.fleet * 1000) / 10).toLocaleString('pt-BR')}%` : '—'}</td>
                <td className="text-right">{c?.duties ?? '—'}</td>
                <td className="text-right">{c ? fmtTime(c.avgWorkMinutes) : '—'}</td>
                <td className="text-right">{c ? `${c.overtimePct.toLocaleString('pt-BR')}%` : '—'}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {p.future && vp?.validFrom && <Badge label={`a partir de ${fmtDay(vp.validFrom)}`} color="info" />}
                    {vp && !c && <Badge label="sem escala ativa" color="destructive" />}
                    {c?.noBranch ? <Badge label={`${c.noBranch} sem empresa`} color="destructive" /> : null}
                    {p.linesWithoutPlan.length > 0 && <Badge label={`linha ${p.linesWithoutPlan.join(', ')} fora`} color="destructive" />}
                    {c?.uncoveredMinutes ? <Badge label={`${c.uncoveredMinutes} min descobertos`} color="warning" /> : null}
                    {c?.stale ? <Badge label={`${c.stale} desatualizadas`} color="warning" /> : null}
                    {ok && <Badge label="ok" color="success" />}
                  </div>
                </td>
              </tr>
            )
          })}
          {!snapshot.plans.length && <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">Nenhum plano efetivo no escopo.</td></tr>}
        </tbody>
      </table>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <dt className="font-medium text-foreground/80">Frota</dt><dd>carros da empresa em uso no planejamento (blocos com viagens)</dd>
        <dt className="font-medium text-foreground/80">Reserva</dt><dd>carros ativos da empresa (inclusive em manutenção) além da frota em uso; % sobre a frota em uso</dd>
        <dt className="font-medium text-foreground/80">Tabelas</dt><dd>jornadas da empresa na escala lógica, da função selecionada</dd>
        <dt className="font-medium text-foreground/80">Jornada</dt><dd>média do tempo trabalhado por tabela</dd>
        <dt className="font-medium text-foreground/80">Extra</dt><dd>parte das horas pagas que é hora extra</dd>
      </dl>
      {snapshot.scopes.length > 1 && <p className="mt-3 text-[11px] text-muted-foreground">A empresa opera em mais de um escopo — o quadro é o mesmo em todos.</p>}
    </Card>
  )
}

// ── B: demand × crew ────────────────────────────────────────────────────────

export function StaffingSection({ snapshot, onSuggest }: { snapshot: ConsoleSnapshot; onSuggest?: () => void }) {
  const types = shownDayTypes(snapshot)
  const shiftById = new Map(snapshot.shifts.map(s => [s.id, s]))
  const sizeOf = new Map(snapshot.sizing.shifts.map(s => [s.shiftId, s]))
  const moves = snapshot.sizing.groups.filter(g => g.add !== g.remove)
  return (
    <Card title="Demanda × quadro por turno" icon={Icons.Users} aside={
      <Button size="sm" variant="outline" disabled={!onSuggest} onClick={onSuggest} title={onSuggest ? undefined : 'Em breve'}><Icons.Sparkles className="w-3.5 h-3.5" />Sugestões</Button>
    }>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="[&>th]:pb-2 [&>th]:font-medium [&>th]:px-1.5">
            <th className="text-left">Turno</th>
            {types.map(t => <th key={t.id}>{t.name}</th>)}
            <th className="text-right" title="Operadores disponíveis / necessários: cobrir todas as tabelas em todos os dias da janela, mais a reserva de férias e a do banco de horas">Quadro</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {snapshot.staffing.rows.map(r => {
            const s = shiftById.get(r.shiftId)!
            return (
              <tr key={r.shiftId} className="[&>td]:p-1">
                <td className="px-1.5! whitespace-nowrap">{s.name}<span className="ms-1.5 text-[11px] text-muted-foreground">{fmtTime(s.startFloor)}–{fmtTime(s.startCeiling)}</span></td>
                {types.map(t => {
                  const c = r.cells[t.id]
                  if (!c) return <td key={t.id} className="text-center text-muted-foreground">—</td>
                  return (
                    <td key={t.id}>
                      <div className={cn('rounded-md px-2 py-1.5 text-center', balanceCls(c.balance))} title={`Pior dia: ${c.worst} operadores · média ${c.avg.toFixed(1).replace('.', ',')}`}>
                        <div className="text-base font-semibold leading-tight">{signed(c.balance)}</div>
                        <div className="text-[11px] opacity-75">{c.demand} tab · {c.worst} op</div>
                      </div>
                    </td>
                  )
                })}
                {(() => {
                  const z = sizeOf.get(r.shiftId)
                  if (!z) return <td />
                  return (
                    <td className={cn('text-right px-1.5! whitespace-nowrap', z.current < z.required && 'text-destructive font-medium')}
                      title={`operacional ${z.operational} · férias +${z.vacation}${z.bank ? ` · abatimento do banco +${z.bank}, à parte` : ''}`}>
                      {z.current}<span className="text-muted-foreground font-normal"> / {z.required}</span>
                    </td>
                  )
                })()}
              </tr>
            )
          })}
          <tr className="[&>td]:p-1 text-xs text-muted-foreground">
            <td className="px-1.5!">Sem turno</td>
            {types.map(t => <td key={t.id} className="text-center">{snapshot.staffing.noShift[t.id] ? `${snapshot.staffing.noShift[t.id]} tab` : '—'}</td>)}
            <td />
          </tr>
          <tr className="[&>td]:p-1 [&>td]:pt-2 border-t border-border text-xs">
            <td className="px-1.5! text-muted-foreground" title="Máximo de tabelas cobríveis no pior dia, pelas regras do gerador — considera a flexibilidade entre turnos">Cobríveis (encaixe)</td>
            {types.map(t => {
              const x = snapshot.staffing.totals[t.id]
              return <td key={t.id} className={cn('text-center font-medium', x && x.coverable < x.demand && 'text-destructive')}>{x ? `${x.coverable} / ${x.demand}` : '—'}</td>
            })}
            <td />
          </tr>
        </tbody>
      </table>
      {moves.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">Para cobrir com o mínimo de gente:</span>{' '}
          {moves.map(g => `${shiftById.get(g.shiftId)?.name ?? '?'}${g.label ? ` ${g.label}` : ''} ${signed(g.add - g.remove)}`).join(' · ')}
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Saldo = operadores no pior dia do tipo (janela de 5 semanas) − tabelas do plano efetivo, plantões incluídos. Férias não descontam; afastados sim.
        Quadro = necessário para cobrir todas as tabelas de todos os dias, pelas regras da escala, mais férias (30 dias/ano). O abatimento do banco de horas ({snapshot.sizing.bankPct}% com folga) vem à parte: +{snapshot.sizing.bank}.
      </p>
    </Card>
  )
}

// ── C: shifts ───────────────────────────────────────────────────────────────

// the chart spans 03:00–22:00 at least, widened to whole hours to fit every start and shift window
const H_FROM = 180, H_TO = 1320, BIN = 30
// a clock time for the chart — a start before the operational day's midnight (negative) shows as the evening before
const clock = (m: number) => fmtTime(((m % 1440) + 1440) % 1440)

export function ShiftsSection({ snapshot }: { snapshot: ConsoleSnapshot }) {
  const types = shownDayTypes(snapshot)
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const t = types.find(x => x.id === typeId) ?? types[0]
  const starts = useMemo(() => (t ? snapshot.shiftsAnalysis.starts[t.id] ?? [] : []), [snapshot, t])
  const [from, to] = useMemo(() => [
    Math.floor(Math.min(H_FROM, ...starts, ...snapshot.shifts.map(s => s.startFloor)) / 60) * 60,
    Math.ceil(Math.max(H_TO, ...starts.map(x => x + BIN), ...snapshot.shifts.map(s => s.startCeiling)) / 60) * 60,
  ], [starts, snapshot.shifts])
  const bins = useMemo(() => {
    const out = new Array((to - from) / BIN).fill(0)
    for (const s of starts) out[Math.floor((s - from) / BIN)]++
    return out
  }, [starts, from, to])
  const max = Math.max(...bins, 1)
  const pct = (m: number) => `${((Math.min(Math.max(m, from), to) - from) / (to - from)) * 100}%`
  const ticks = Array.from({ length: Math.floor((to - from) / 180) + 1 }, (_, i) => from + i * 180)
  const shiftById = new Map(snapshot.shifts.map(s => [s.id, s]))
  const none = t ? snapshot.shiftsAnalysis.noShift[t.id] : null
  const idle = snapshot.shiftsAnalysis.idle.filter(x => x.dayTypeId === t?.id)

  return (
    <Card title="Distribuição de turnos" icon={Icons.Clock} aside={<DayTypeTabs types={types} value={t?.id ?? ''} onChange={setTypeId} />}>
      <div className="space-y-1">
        <div className="relative h-28 flex items-end gap-px">
          {bins.map((n, i) => (
            <div key={i} className="flex-1 rounded-t-sm bg-foreground/15 hover:bg-foreground/30" style={{ height: `${(n / max) * 100}%` }}
              title={`${clock(from + i * BIN)}–${clock(from + (i + 1) * BIN)}: ${n} tabela(s) iniciando`} />
          ))}
        </div>
        {snapshot.shifts.map(s => (
          <div key={s.id} className="relative h-4">
            <div className="absolute inset-y-1 rounded-sm bg-sky-500/20" style={{ left: pct(s.startFloor), width: `calc(${pct(s.startCeiling)} - ${pct(s.startFloor)})` }} />
            <div className="absolute inset-y-1 rounded-sm bg-sky-500/55" style={{ left: pct(s.startIdealMin), width: `calc(${pct(s.startIdealMax)} - ${pct(s.startIdealMin)})` }} />
            <span className="absolute text-[10px] leading-4 text-muted-foreground" style={{ left: `calc(${pct(s.startCeiling)} + 4px)` }}>{s.code}</span>
          </div>
        ))}
        <div className="relative h-4 text-[10px] text-muted-foreground tabular-nums">
          {ticks.map((m, i) => (
            <span key={m} className={cn('absolute', i > 0 && '-translate-x-1/2', m === to && '-translate-x-full')} style={{ left: pct(m) }}>{clock(m)}</span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Barras: tabelas iniciando a cada 30 min. Faixas: janela de início de cada turno — fraca = mínimo a máximo, forte = ideal.
        </p>
      </div>

      <ul className="mt-3 space-y-1.5 text-sm">
        {none && none.count > 0 && (
          <li className="flex gap-2"><Icons.AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span className="flex-1">
              {none.count} tabela(s) não cabem em nenhum turno
              {none.earliest != null && ` (início ${fmtTime(none.earliest)}${none.latest !== none.earliest ? `–${fmtTime(none.latest!)}` : ''})`} — ajustar a janela de um turno ou criar um turno para elas.
            </span>
          </li>
        )}
        {snapshot.shiftsAnalysis.overlaps.map(o => (
          <li key={o.shiftIds.join()} className="flex gap-2"><Icons.Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
            <span className="flex-1">{o.count} tabela(s) cabem em {shiftById.get(o.shiftIds[0])?.name} e {shiftById.get(o.shiftIds[1])?.name} — decididas só pela prioridade.</span>
          </li>
        ))}
        {idle.map(x => (
          <li key={x.shiftId} className="flex gap-2"><Icons.Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
            <span className="flex-1">{shiftById.get(x.shiftId)?.name}: {x.crew} operador(es) trabalhando e nenhuma tabela no {t?.name.toLowerCase()}.</span>
          </li>
        ))}
        {snapshot.shiftsAnalysis.noCrew.map(id => (
          <li key={id} className="flex gap-2"><Icons.AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span className="flex-1">{shiftById.get(id)?.name} tem tabelas e nenhum operador.</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function DayTypeTabs({ types, value, onChange }: { types: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex rounded-md border border-border text-xs overflow-hidden">
      {types.map(t => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)}
          className={cn('px-2.5 h-7 whitespace-nowrap', value === t.id ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted')}>
          {t.name}
        </button>
      ))}
    </div>
  )
}

// ── D: rest groups ──────────────────────────────────────────────────────────

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

export function GroupsSection({ snapshot, onSuggest }: { snapshot: ConsoleSnapshot; onSuggest?: (shiftId: string) => void }) {
  const withCrew = snapshot.groups.filter(g => g.patterns.length || g.noPattern)
  const [shiftId, setShiftId] = useState(withCrew[0]?.shiftId ?? '')
  const g = withCrew.find(x => x.shiftId === shiftId) ?? withCrew[0]
  const shiftById = new Map(snapshot.shifts.map(s => [s.id, s]))
  if (!g) return <Card title="Grupos de folga × demanda" icon={Icons.CalendarRange}><p className="text-muted-foreground">Nenhum operador nos turnos.</p></Card>
  const top = Math.max(...g.weekdays.flatMap(w => [w.supply, w.demand]), 1)
  const aligned = g.worstIdeal <= g.worstNow

  return (
    <Card title="Grupos de folga × demanda" icon={Icons.CalendarRange} aside={
      <>
        <div className="flex rounded-md border border-border text-xs overflow-hidden">
          {withCrew.map(x => (
            <button key={x.shiftId} type="button" onClick={() => setShiftId(x.shiftId)}
              className={cn('px-2 h-7', g.shiftId === x.shiftId ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted')}>{shiftById.get(x.shiftId)?.code}</button>
          ))}
        </div>
        <Button size="sm" variant="outline" disabled={!onSuggest || aligned} onClick={() => onSuggest?.(g.shiftId)} title={!onSuggest ? 'Em breve' : aligned ? 'Os grupos já seguem a demanda' : undefined}>
          <Icons.Sparkles className="w-3.5 h-3.5" />Sugestões
        </Button>
      </>
    }>
      <div className="grid grid-cols-7 gap-2">
        {g.weekdays.map((w, i) => {
          const b = w.supply - w.demand
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="relative h-24 w-full flex items-end justify-center gap-1">
                <div className="w-3 rounded-t-sm bg-foreground/25" style={{ height: `${(w.supply / top) * 100}%` }} title={`${w.supply} operadores trabalham (pior data)`} />
                <div className="w-3 rounded-t-sm border border-foreground/40 border-b-0" style={{ height: `${(w.demand / top) * 100}%` }} title={`${w.demand} tabelas`} />
              </div>
              <span className="text-xs">{WEEKDAYS[i]}</span>
              <span className={cn('text-xs font-medium tabular-nums rounded px-1.5', balanceCls(b))}>{signed(b)}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Barras: cheia = operadores que trabalham, contorno = tabelas. Pior dia do turno: {signed(g.worstNow)} hoje, {signed(g.worstIdeal)} com os grupos pela demanda.
        {g.noPattern > 0 && ` ${g.noPattern} operador(es) sem regime.`}
      </p>

      {g.patterns.map(p => (
        <div key={p.patternId} className="mt-4">
          <div className="flex items-baseline gap-2 mb-1">
            <Link href={`/transit/rest-pattern/${p.patternId}`} className="text-sm font-medium hover:underline">{p.name}</Link>
            {p.maxRun > 6 && <Badge label={`até ${p.maxRun} dias seguidos`} color="warning" />}
            {p.outside > 0 && <span className="text-[11px] text-muted-foreground">{p.outside} entre grupos</span>}
          </div>
          <table className="w-full text-xs tabular-nums">
            <tbody>
              <tr className="[&>td]:py-1 text-muted-foreground">
                <td className="w-24">Grupo</td>
                {p.groups.map(x => <td key={x.offset} className="text-center">{x.label}</td>)}
              </tr>
              <tr className="[&>td]:py-1 border-t border-border/60">
                <td className="text-muted-foreground">Atual</td>
                {p.groups.map(x => <td key={x.offset} className={cn('text-center', x.count !== x.ideal && 'font-semibold')}>{x.count}</td>)}
              </tr>
              <tr className="[&>td]:py-1 border-t border-border/60">
                <td className="text-muted-foreground">Pela demanda</td>
                {p.groups.map(x => <td key={x.offset} className="text-center text-muted-foreground">{x.ideal}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </Card>
  )
}

// ── E: crew records ─────────────────────────────────────────────────────────

// how far the bonded crew is from the margin: none / under half / under it / there
function BondBadge({ bonded, ideal }: { bonded: number; ideal: number }) {
  const missing = ideal - bonded
  if (missing <= 0) return <Badge label="vínculo ok" color="success" />
  const share = bonded / ideal
  return <Badge label={`faltam ${missing} · ${Math.round(share * 100)}%`} color={share === 0 ? 'destructive' : share < 0.5 ? 'warning' : 'info'} />
}

export function CrewSection({ snapshot, ctx, onAction }: { snapshot: ConsoleSnapshot; ctx: ConsoleCtx; onAction?: (a: ConsoleAction) => void }) {
  const d = snapshot.crewData
  const shiftById = new Map(snapshot.shifts.map(s => [s.id, s]))
  // habilitação: below the need (error), below the margin (warning), fine; the bond (priority /
  // preferred) is only informative — the generator spreads the lines without it
  const short  = d.lines.filter(l => l.gap < 0)
  const margin = d.lines.filter(l => l.gap >= 0 && l.enabled < l.ideal)
  // the most short of bonded crew (against the margin) first
  const fine   = d.lines.filter(l => l.enabled >= l.ideal).sort((a, b) => (b.ideal - b.bonded) - (a.ideal - a.bonded) || a.lineCode.localeCompare(b.lineCode))
  const [showFine, setShowFine] = useState(false)

  const rows: { label: string; items: { key: string; text: string; link: ConsoleLink }[]; severity: 'warning' | 'info'; action?: ReactNode }[] = [
    {
      label: 'Funcionários sem perfil de operador', severity: 'warning',
      action: onAction && d.noProfile.length > 0 && <button type="button" onClick={() => onAction({ kind: 'profiles' })} className="text-xs font-medium hover:underline">Criar perfis</button>,
      items: d.noProfile.map(e => ({ key: e.employeeId, text: `${e.code} ${e.name} — ${e.jobTitle}`, link: { kind: 'employee', id: e.employeeId } })) },
    { label: 'Operadores sem turno vigente', severity: 'warning', items: d.noShift.map(m => ({ key: m.id, text: `${m.code} ${m.name}`, link: { kind: 'crew-member', id: m.id } })) },
    { label: 'Operadores sem regime de folga', severity: 'warning', items: d.noPattern.map(m => ({ key: m.id, text: `${m.code} ${m.name}`, link: { kind: 'crew-member', id: m.id } })) },
    { label: 'Carro fixo com conflito', severity: 'warning', items: d.fixedCar.map(m => ({ key: m.id, text: `${m.code} ${m.name} — ${m.vehicleCode}: ${m.reason}`, link: { kind: 'crew-member', id: m.id } })) },
    { label: 'Fora do gerador', severity: 'info', items: d.outOfGenerator.map(m => ({ key: m.id, text: `${m.code} ${m.name}`, link: { kind: 'crew-member', id: m.id } })) },
    { label: 'Afastados (fora do quadro)', severity: 'info', items: d.away.map(m => ({ key: m.id, text: `${m.code} ${m.name} — ${m.reason} até ${fmtDay(m.until)}`, link: { kind: 'crew-member', id: m.id } })) },
    { label: 'De férias (contam no quadro)', severity: 'info', items: d.vacation.map(m => ({ key: m.id, text: `${m.code} ${m.name} — até ${fmtDay(m.until)}${m.cover ? ` · ferista ${m.cover}` : ''}`, link: { kind: 'crew-member', id: m.id } })) },
  ]

  return (
    <Card title="Cadastro do quadro" icon={Icons.IdCard}>
      <ul className="space-y-1">
        {rows.map(r => <RecordRow key={r.label} {...r} ctx={ctx} />)}
      </ul>

      <div className="mt-5">
        <div className="flex items-baseline gap-2 mb-1.5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Habilitação por linha e turno</h3>
          <span className="text-[11px] text-muted-foreground">sobra num turno não cobre falta em outro</span>
        </div>
        {short.length + margin.length ? (
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="[&>th]:pb-1 [&>th]:font-medium [&>th]:px-1.5">
                <th className="text-left">Linha · turno</th>
                <th className="text-right" title="Tabelas do turno com a linha como dominante, no tipo de dia mais cheio">Tabelas</th>
                <th className="text-right" title="Operadores para cobrir todo dia (ciclo do regime)">Necessário</th>
                <th className="text-right" title="Necessário + a margem da empresa (férias, faltas)">Com margem</th>
                <th className="text-right" title="Operadores do turno que podem operar a linha">Habilitados</th>
                <th />
                {onAction && <th />}
              </tr>
            </thead>
            <tbody>
              {[...short, ...margin].map(l => (
                <tr key={l.lineId + l.shiftId} className="border-t border-border/60 [&>td]:py-1 [&>td]:px-1.5">
                  <td className="whitespace-nowrap"><span className="font-medium">{l.lineCode}</span> · {shiftById.get(l.shiftId)?.name}</td>
                  <td className="text-right">{l.duties}</td>
                  <td className="text-right">{l.need}</td>
                  <td className="text-right text-muted-foreground">{l.ideal}</td>
                  <td className={cn('text-right font-medium', l.gap < 0 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')}>{l.enabled}</td>
                  <td className="text-right">
                    {l.gap < 0 ? <Badge label={`faltam ${-l.gap}`} color="destructive" /> : <Badge label={`margem: faltam ${l.ideal - l.enabled}`} color="warning" />}
                  </td>
                  {onAction && (
                    <td className="text-right whitespace-nowrap">
                      <button type="button" className="text-xs font-medium hover:underline" onClick={() => onAction({ kind: 'lines', shiftId: l.shiftId, lineId: l.lineId })}>Habilitar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground"><Icons.CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />Todas as linhas com habilitados suficientes, com margem, em cada turno.</p>
        )}
        {fine.length > 0 && (
          <div className="mt-2 text-xs">
            <button type="button" onClick={() => setShowFine(v => !v)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
              {showFine ? <Icons.ChevronDown className="w-3.5 h-3.5" /> : <Icons.ChevronRight className="w-3.5 h-3.5" />}
              {fine.length} linha · turno ok
            </button>
            {showFine && (
              <table className="mt-1 ms-5 text-xs tabular-nums text-muted-foreground">
                <thead>
                  <tr className="[&>th]:pb-0.5 [&>th]:pe-4 [&>th]:font-medium [&>th]:text-left">
                    <th>Linha · turno</th><th>Habilitados</th><th>Com margem</th>
                    <th title="Com a linha prioritária (empresa) ou preferida (operador) — informativo: o gerador distribui as linhas sem isso">Vinculados</th>
                    <th />
                    {onAction && <th />}
                  </tr>
                </thead>
                <tbody>
                  {fine.map(l => (
                    <tr key={l.lineId + l.shiftId} className="[&>td]:py-0.5 [&>td]:pe-4">
                      <td className="whitespace-nowrap"><span className="text-foreground">{l.lineCode}</span> · {shiftById.get(l.shiftId)?.name}</td>
                      <td>{l.enabled}</td>
                      <td>{l.ideal}</td>
                      <td>{l.bonded} de {l.need}</td>
                      <td><BondBadge bonded={l.bonded} ideal={l.ideal} /></td>
                      {onAction && (
                        <td>
                          {l.bonded < l.need && (
                            <button type="button" className="font-medium hover:underline hover:text-foreground" onClick={() => onAction({ kind: 'priority', shiftId: l.shiftId, lineId: l.lineId })}>Prioritárias</button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function RecordRow({ label, items, severity, ctx, action }: { label: string; items: { key: string; text: string; link: ConsoleLink }[]; severity: 'warning' | 'info'; ctx: ConsoleCtx; action?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ok = items.length === 0
  return (
    <li>
      <div className="flex items-center gap-2">
        <button type="button" disabled={ok} onClick={() => setOpen(v => !v)} className="flex items-center gap-2 flex-1 text-left disabled:cursor-default">
          {ok ? <Icons.CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            : open ? <Icons.ChevronDown className="w-4 h-4 text-muted-foreground" /> : <Icons.ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <span className={cn(ok && 'text-muted-foreground')}>{label}</span>
        </button>
        {action}
        <span className={cn('tabular-nums text-sm font-medium', !ok && severity === 'warning' && 'text-amber-600 dark:text-amber-400')}>{items.length}</span>
      </div>
      {open && (
        <ul className="ms-6 mt-1 mb-2 space-y-0.5 text-xs text-muted-foreground">
          {items.map(i => <li key={i.key} className="flex items-center gap-2"><span className="flex-1">{i.text}</span><GoTo link={i.link} ctx={ctx} label={LINK_LABEL[i.link.kind]} /></li>)}
        </ul>
      )}
    </li>
  )
}

// ── F: generated days with errors ───────────────────────────────────────────

export function DailySection({ snapshot, ctx }: { snapshot: ConsoleSnapshot; ctx: ConsoleCtx }) {
  const ahead = (d: string) => Math.round((Date.parse(d) - Date.parse(snapshot.today)) / 86_400_000)
  return (
    <Card title="Dias gerados com erro" icon={Icons.CalendarX} aside={<span className="text-xs text-muted-foreground">planejados, até 30 dias — corrigir na Escala</span>}>
      {!snapshot.dailyErrors.length && (
        <p className="flex items-center gap-2 text-muted-foreground"><Icons.CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />Nenhum dia gerado com erro.</p>
      )}
      <ul className="space-y-2">
        {snapshot.dailyErrors.map(d => (
          <li key={d.operationId} className="flex items-start gap-3">
            <div className="w-16 shrink-0">
              <div className="font-medium tabular-nums">{fmtDay(d.date)}</div>
              <div className="text-[11px] text-muted-foreground">{ahead(d.date) === 0 ? 'hoje' : ahead(d.date) === 1 ? 'amanhã' : `em ${ahead(d.date)} dias`}</div>
            </div>
            <div className="flex-1 space-y-1">
              {d.outdated && <div className="text-xs text-amber-700 dark:text-amber-400">{d.outdated}</div>}
              <div className="flex flex-wrap gap-1">
                {d.issues.map(i => <Badge key={i.code} label={`${i.count} ${i.label.toLowerCase()}`} color="destructive" />)}
              </div>
            </div>
            <GoTo link={{ kind: 'escala', date: d.date }} ctx={ctx} label="Escala" />
          </li>
        ))}
      </ul>
    </Card>
  )
}
