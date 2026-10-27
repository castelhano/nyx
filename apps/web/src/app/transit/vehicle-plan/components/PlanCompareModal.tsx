'use client'

import { useEffect, useMemo, useState, Fragment } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { CREW_ROLE_LABEL, type CrewPlanSummary, type CrewRole } from '@nyx/schemas'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'
import { useShortcutContext } from '@/lib/keywatch'
import { Select } from '@/components/ui/select'
import { PLAN_STATUS_LABEL } from '../[id]/components/LineSummaryView'
import { METRICS, CATEGORIES, goodness, DeltaPill, HourTooltip, hourLabel, int, dec, type PlanOverview } from '../[id]/components/PlanSummaryView'

type PlanStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED'

interface CrewPlanOption {
  id:          string
  description: string | null
  status:      PlanStatus
  generatedAt: string | null
  summary:     CrewPlanSummary | null
  isCustom:    boolean
}

interface ComparedLine {
  lineId:         string
  code:           string
  name:           string
  lineScheduleId: string | null
  approvalRef:    string | null
  isDrifted:      boolean
}

// VehiclePlanService.comparePlans
interface ComparedPlan extends PlanOverview {
  planId:      string
  description: string | null
  status:      PlanStatus
  validFrom:   string | null
  validTo:     string | null
  generatedAt: string | null
  // own: the stored one; base: under the inherited settings, live — the one compared
  score:       { own: number | null; base: number | null; isCustom: boolean }
  lines:       ComparedLine[]
  crewPlans:   CrewPlanOption[]
}

interface CompareResponse {
  scope:   string
  dayType: string
  plans:   ComparedPlan[]
}

interface CrewMetricDef {
  label:    string
  unit:     string
  get:      (s: CrewPlanSummary, p: ComparedPlan) => number | null
  fmt:      (v: number) => string
  inverse?: boolean
}

const hours = (minutes: number) => minutes / 60

const CREW_METRICS: CrewMetricDef[] = [
  { label: 'Tabelas',                 unit: '',             get: s => s.dutyCount,                fmt: int, inverse: true },
  ...(Object.keys(CREW_ROLE_LABEL) as CrewRole[]).map((role): CrewMetricDef => ({
    label: `Tabelas · ${CREW_ROLE_LABEL[role].toLowerCase()}`, unit: '', get: s => s.byRole[role] ?? null, fmt: int, inverse: true,
  })),
  { label: 'Horas pagas',             unit: 'h',            get: s => hours(s.paidMinutes),       fmt: dec, inverse: true },
  { label: 'Horas extras',            unit: 'h',            get: s => hours(s.overtimeMinutes),   fmt: dec, inverse: true },
  { label: 'Horas noturnas',          unit: 'h',            get: s => hours(s.nightMinutes),      fmt: dec, inverse: true },
  { label: 'Descoberto',              unit: 'h',            get: s => hours(s.uncoveredMinutes),  fmt: dec, inverse: true },
  { label: 'Motoristas por veículo',  unit: '',             get: s => s.driversPerVehicle ?? null, fmt: dec, inverse: true },
  { label: 'Horas pagas / h-veículo', unit: '',             get: (s, p) => p.summary && p.summary.totalMinutes > 0 ? s.paidMinutes / p.summary.totalMinutes : null, fmt: v => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), inverse: true },
  { label: 'Tabelas com pendência',   unit: '',             get: s => s.issueDutyCount,           fmt: int, inverse: true },
]

// categorical slots 1–3 (dataviz reference palette), one per compared plan, in column order
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)']

const fmtDate = (v: string | null) => v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null

// ACTIVE, else the most recent (crewPlans come newest first)
function defaultCrewPlan(p: ComparedPlan): string {
  return (p.crewPlans.find(c => c.status === 'ACTIVE') ?? p.crewPlans[0])?.id ?? ''
}

// lines whose service may differ between the plans: missing from some, pinned to different
// OSOs, still without an OSO, or with trips diverging from it
function divergentLines(plans: ComparedPlan[]) {
  const ids = [...new Set(plans.flatMap(p => p.lines.map(l => l.lineId)))]
  return ids.flatMap(lineId => {
    const cells = plans.map(p => p.lines.find(l => l.lineId === lineId) ?? null)
    const any   = cells.find(c => c)!
    const missing   = cells.some(c => !c)
    const schedules = new Set(cells.filter(c => c).map(c => c!.lineScheduleId))
    const diverges  = missing || schedules.size > 1 || schedules.has(null) || cells.some(c => c?.isDrifted)
    return diverges ? [{ lineId, code: any.code, name: any.name, cells }] : []
  }).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }))
}

interface Props {
  // selection order — the reference is the ACTIVE plan if selected, else the first
  planIds: string[]
  onClose: () => void
}

export function PlanCompareModal({ planIds, onClose }: Props) {
  useShortcutContext('plan_compare_md')

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const { data, isLoading, error } = useQuery<CompareResponse>({
    queryKey: ['transit', 'vehicle-plan', 'compare', planIds],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/compare?ids=${planIds.join(',')}`)
      if (!res.ok) throw new Error('Erro ao carregar comparação')
      return res.json()
    },
  })

  const plans = useMemo(() => {
    const list = data?.plans ?? []
    return [...list.filter(p => p.status === 'ACTIVE'), ...list.filter(p => p.status !== 'ACTIVE')]
  }, [data])
  const ref = plans[0]

  // crew plan picked per vehicle plan — '' = none
  const [crewPick, setCrewPick] = useState<Record<string, string>>({})
  const crewOf = (p: ComparedPlan) => {
    const id = crewPick[p.planId] ?? defaultCrewPlan(p)
    return p.crewPlans.find(c => c.id === id) ?? null
  }
  const crews = plans.map(crewOf)

  const baseScores = useQueries({
    queries: crews.map(c => ({
      queryKey: ['transit', 'crew-plan', c?.id, 'base-score'],
      queryFn:  async () => {
        const res = await apiFetch(`/transit/crew-plan/${c!.id}/base-score`)
        if (!res.ok) throw new Error('Erro ao calcular score base')
        return (await res.json()).score as number
      },
      enabled: !!c?.summary,
    })),
  })
  const crewScore = (i: number): number | null => {
    const c = crews[i]
    return c?.summary ? baseScores[i]?.data ?? null : null
  }

  const divergent = useMemo(() => divergentLines(plans), [plans])
  const [showLines, setShowLines] = useState(false)
  const anyCustom = plans.some(p => p.score.isCustom) || crews.some(c => c?.isCustom)

  const chartData = useMemo(() => {
    const hoursSet = new Set(plans.flatMap(p => p.fleetByHour.map(h => h.hour)))
    return [...hoursSet].sort((a, b) => a - b).map(hour => ({
      hourLabel: hourLabel(hour),
      ...Object.fromEntries(plans.map((p, i) => [`p${i}`, p.fleetByHour.find(h => h.hour === hour)?.fleet ?? 0])),
    }))
  }, [plans])

  const planName = (p: ComparedPlan) => p.description || PLAN_STATUS_LABEL[p.status]
  const cols = `minmax(13rem, 1fr) repeat(${plans.length || planIds.length}, minmax(11rem, 1fr))`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="plan-compare relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl mx-4 h-[90vh] flex flex-col overflow-hidden">
        <style>{`
          .plan-compare { --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; }
          .dark .plan-compare { --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; }
        `}</style>

        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
          <Icons.GitCompare className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Comparar planejamentos</h2>
          {data && <span className="text-sm text-muted-foreground">{data.scope} · {data.dayType}</span>}
          <button onClick={onClose} title="Fechar" className="ml-auto p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        {error ? (
          <div className="flex-1 flex items-center justify-center p-10 text-sm text-destructive">{(error as Error).message}</div>
        ) : isLoading || !ref ? (
          <div className="flex-1 flex items-center justify-center p-10 text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {divergent.length > 0 && (
              <div className="rounded-lg border text-sm bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25">
                <button onClick={() => setShowLines(v => !v)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
                  <Icons.AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="flex-1">
                    {divergent.length} {divergent.length === 1 ? 'linha difere' : 'linhas diferem'} entre os planos (ausente, OSO diferente, sem OSO ou viagens divergentes da OSO) — a comparação pode não refletir a mesma oferta.
                  </span>
                  {showLines ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
                </button>
                {showLines && (
                  <div className="border-t border-amber-500/25 px-4 py-2 max-h-56 overflow-y-auto text-foreground">
                    <div className="grid gap-x-3 text-xs" style={{ gridTemplateColumns: cols }}>
                      {divergent.map(l => (
                        <Fragment key={l.lineId}>
                          <span className="py-1 truncate" title={l.name}><b>{l.code}</b> <span className="text-muted-foreground">{l.name}</span></span>
                          {l.cells.map((c, i) => (
                            <span key={i} className="py-1 tabular-nums flex items-center gap-1">
                              {!c ? <span className="text-muted-foreground italic">ausente</span>
                                : c.approvalRef ? c.approvalRef
                                : <span className="text-muted-foreground italic">sem OSO</span>}
                              {c?.isDrifted && <span title="Viagens divergentes da OSO"><Icons.AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" /></span>}
                            </span>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {anyCustom && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm bg-muted/40 text-muted-foreground border-border">
                <Icons.Info className="w-4 h-4 shrink-0" />
                Há planos com configuração própria — o score comparado é recalculado com a configuração herdada (escopo/global); o próprio aparece abaixo.
              </div>
            )}

            {/* plans × metrics — one grid so every row lines up across the columns */}
            <div className="bg-card border border-border rounded-xl overflow-x-auto">
              <div className="grid min-w-max" style={{ gridTemplateColumns: cols }}>
                <div className="px-4 py-3 border-b border-border" />
                {plans.map((p, i) => (
                  <div key={p.planId} className={cn('px-4 py-3 border-b border-l border-border space-y-1', i === 0 && 'bg-primary/5')}>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-0.5 rounded shrink-0" style={{ background: SERIES[i] }} />
                      <span className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full font-semibold border',
                        p.status === 'ACTIVE'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                          : 'bg-muted/60 text-muted-foreground border-border',
                      )}>
                        {PLAN_STATUS_LABEL[p.status].toUpperCase()}
                      </span>
                      {i === 0 && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Referência</span>}
                    </div>
                    <p className="text-sm font-medium truncate" title={planName(p)}>{planName(p)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {p.validFrom ? `Vigência ${fmtDate(p.validFrom)}${p.validTo ? ` – ${fmtDate(p.validTo)}` : ''}` : p.generatedAt ? `Gerado em ${fmtDate(p.generatedAt)}` : '—'}
                    </p>
                    {!p.summary && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                        <Icons.AlertTriangle className="w-3 h-3" /> Não calculado — recalcule o plano
                      </p>
                    )}
                  </div>
                ))}

                <SectionRow label="Planejamento" span={plans.length} />
                <MetricRow
                  label="Score" unit="config. herdada"
                  values={plans.map(p => p.score.base)}
                  fmt={int}
                  notes={plans.map(p => p.score.isCustom && p.score.own != null ? `própria: ${int(p.score.own)}` : null)}
                />
                {CATEGORIES.map(cat => (
                  <Fragment key={cat}>
                    <SectionRow label={cat} span={plans.length} minor />
                    {METRICS.filter(m => m.cat === cat).map(m => (
                      <MetricRow key={m.label} label={m.label} unit={m.unit} values={plans.map(m.get)} fmt={m.fmt} inverse={m.inverse} />
                    ))}
                  </Fragment>
                ))}

                <SectionRow label="Escala" span={plans.length} />
                <div className="px-4 py-2 text-sm text-muted-foreground border-b border-border/40">Escala comparada</div>
                {plans.map((p, i) => (
                  <div key={p.planId} className={cn('px-3 py-1.5 border-b border-l border-border/40', i === 0 && 'bg-primary/5')}>
                    {p.crewPlans.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">Sem escala</span>
                    ) : (
                      <Select size="sm" value={crewOf(p)?.id ?? ''} onChange={e => setCrewPick(prev => ({ ...prev, [p.planId]: e.target.value }))} wrapperClassName="w-full">
                        {p.crewPlans.map(c => (
                          <option key={c.id} value={c.id}>
                            {(c.description || 'Sem descrição') + ` · ${PLAN_STATUS_LABEL[c.status]}`}
                          </option>
                        ))}
                      </Select>
                    )}
                    {crews[i] && (crews[i]!.summary?.staleDutyCount ?? 0) > 0 && (
                      <p className="text-[11px] mt-1 text-amber-700 dark:text-amber-400 flex items-center gap-1">
                        <Icons.AlertTriangle className="w-3 h-3" /> {crews[i]!.summary!.staleDutyCount} tabelas desatualizadas
                      </p>
                    )}
                  </div>
                ))}
                <MetricRow
                  label="Score" unit="config. herdada"
                  values={plans.map((_, i) => crewScore(i))}
                  fmt={int}
                  notes={crews.map((c, i) => !c?.summary ? null
                    : baseScores[i]?.isLoading ? 'calculando…'
                    : c.isCustom ? `própria: ${int(c.summary.score)}` : null)}
                />
                {CREW_METRICS
                  .filter(m => crews.some((c, i) => c?.summary && m.get(c.summary, plans[i]) != null))
                  .map(m => (
                    <MetricRow
                      key={m.label} label={m.label} unit={m.unit} fmt={m.fmt} inverse={m.inverse}
                      values={crews.map((c, i) => c?.summary ? m.get(c.summary, plans[i]) : null)}
                    />
                  ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <h3 className="font-semibold text-sm">Frota em operação por hora</h3>
                <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                  {plans.map((p, i) => (
                    <span key={p.planId} className="flex items-center gap-1.5">
                      <span className="w-3 h-0.5 rounded inline-block" style={{ background: SERIES[i] }} />
                      {planName(p)}
                    </span>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="hourLabel" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                  <Tooltip content={<HourTooltip />} />
                  {plans.map((p, i) => (
                    <Line key={p.planId} dataKey={`p${i}`} name={planName(p)} stroke={SERIES[i]} strokeWidth={2} dot={{ r: 3, fill: SERIES[i] }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SectionRow({ label, span, minor }: { label: string; span: number; minor?: boolean }) {
  return (
    <div
      className={cn('px-4 border-b border-border', minor ? 'pt-2.5 pb-1 text-[10px] text-muted-foreground' : 'py-2 text-xs text-foreground bg-accent/15')}
      style={{ gridColumn: `span ${span + 1}` }}
    >
      <span className="font-semibold uppercase tracking-widest">{label}</span>
    </div>
  )
}

// first value is the reference — the others carry their variation against it
function MetricRow({ label, unit, values, fmt, inverse, notes }: {
  label:   string
  unit:    string
  values:  (number | null)[]
  fmt:     (v: number) => string
  inverse?: boolean
  notes?:  (string | null)[]
}) {
  return (
    <>
      <div className="px-4 py-2 border-b border-border/40 text-sm">
        {label}
        {unit && <span className="ml-1.5 text-[11px] text-muted-foreground">{unit}</span>}
      </div>
      {values.map((v, i) => (
        <div key={i} className={cn('px-4 py-2 border-b border-l border-border/40 flex items-center justify-end gap-2', i === 0 && 'bg-primary/5')}>
          <div className="text-right">
            <span className="tabular-nums font-medium">{v == null ? '—' : fmt(v)}</span>
            {notes?.[i] && <p className="text-[10px] text-muted-foreground">{notes[i]}</p>}
          </div>
          {i > 0 && <DeltaPill g={goodness(values[0], v, inverse)} />}
        </div>
      ))}
    </>
  )
}
