'use client'

// Goal planning (docs/proposal/plan_goal_planning_v1.md) — etapa 1: the goal (step 1) and the
// suggestion (step 2). The API builds the context and the suggested levers; every edit of a lever
// is re-evaluated here with the same pure functions (evaluateGoal).

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  evaluateGoal, hourToLabel, GOAL_NO_BRANCH,
  type VehiclePlanGoal, type VehiclePlanGoalInput, type GoalContext, type GoalLever, type GoalEvaluation,
  type GoalLeverDetail, type GoalLine, type GoalLineAlert,
} from '@nyx/schemas'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Stepper } from '@/components/ui/stepper'
import { Badge } from '@/components/ui/badge'
import { MultiSelect } from '@/components/ui/multi-select'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { useToast } from '@/lib/toast-context'
import { apiFetch } from '@/lib/auth'
import { Icons } from '@/lib/icons'
import { extractError, cn } from '@/lib/utils'

const FORM_ID = 'vehicle-plan-goal-form'

interface GoalOptions {
  plan:     { id: string; description: string | null; status: string; dayTypeName: string }
  lines:    { lineId: string; code: string; name: string }[]
  branches: { id: string; name: string; abbr: string }[]
}

interface GoalAnalysis {
  goal:       VehiclePlanGoal
  context:    GoalContext
  levers:     GoalLever[]
  evaluation: GoalEvaluation
}

interface FormState {
  amount:                number
  branchIds:             string[]
  lineIds:               string[]
  lockedLineIds:         string[]
  maxCutPerBand:         string
  maxHeadwayMinutes:     string
  useLinesWithoutDemand: boolean
}

const EMPTY_FORM: FormState = {
  amount: 5, branchIds: [], lineIds: [], lockedLineIds: [],
  maxCutPerBand: '', maxHeadwayMinutes: '', useLinesWithoutDemand: true,
}

const LINE_ALERT: Record<GoalLineAlert, string> = {
  NO_DEMAND: 'Sem demanda: impacto na ocupação não avaliado',
  NO_CYCLE:  'Sem ciclo cadastrado em parte do dia: essas faixas não entram na sugestão',
  IRREGULAR: 'Intervalo irregular: a frota pela frequência difere em mais de 1 carro da frota em serviço',
  LOCKED:    'Tem viagens em bloco travado: gerar a linha tira essas viagens do bloco',
  BUNDLED:   'Tem grupos de viagens: gerar a linha desfaz os grupos',
  DRIFTED:   'Já diverge da OSO: reforços e viagens editadas à mão saem ao gerar',
}

const fmtMin    = (v: number) => (Number.isFinite(v) ? `${Math.round(v)}'` : '—')
const fmtPct    = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)

function toGoalInput(f: FormState): VehiclePlanGoalInput {
  return {
    kind:                  'FLEET_REDUCE',
    amount:                f.amount,
    branchIds:             f.branchIds,
    lineIds:               f.lineIds,
    lockedLineIds:         f.lockedLineIds,
    maxCutPerBand:         f.maxCutPerBand ? Number(f.maxCutPerBand) : null,
    maxHeadwayMinutes:     f.maxHeadwayMinutes ? Number(f.maxHeadwayMinutes) : null,
    useLinesWithoutDemand: f.useLinesWithoutDemand,
  }
}

export default function VehiclePlanGoalPage() {
  const { id }    = useParams<{ id: string }>()
  const router    = useRouter()
  const { toast } = useToast()

  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [analysis, setAnalysis]   = useState<GoalAnalysis | null>(null)
  const [levers, setLevers]       = useState<GoalLever[]>([])
  const [extraLines, setExtraLines] = useState<string[]>([])
  const [isPending, setIsPending] = useState(false)

  const { data: options } = useQuery<GoalOptions>({
    queryKey: ['transit', 'vehicle-plan', id, 'goal-options'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/goal/options`)
      if (!res.ok) throw new Error('Erro ao carregar o plano')
      return res.json()
    },
  })

  const evaluation = useMemo(
    () => (analysis ? evaluateGoal(analysis.context, analysis.goal, levers) : null),
    [analysis, levers],
  )

  const branchAbbr = (key: string) =>
    key === GOAL_NO_BRANCH ? 'Sem empresa' : options?.branches.find(b => b.id === key)?.abbr ?? key.slice(0, 6)

  async function analyze(e?: React.FormEvent) {
    e?.preventDefault()
    if (isPending) return
    setIsPending(true)
    try {
      const res  = await apiFetch(`/transit/vehicle-plan/${id}/goal/analyze`, { method: 'POST', body: JSON.stringify(toGoalInput(form)) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(extractError(json, 'Erro ao analisar')); return }
      const result = json as GoalAnalysis
      setAnalysis(result)
      setLevers(result.levers)
      setExtraLines([])
    } finally {
      setIsPending(false)
    }
  }

  function reset() {
    setForm(EMPTY_FORM)
    setAnalysis(null)
    setLevers([])
    setExtraLines([])
  }

  function setCut(lineId: string, bandIndex: number, cut: number) {
    setLevers(prev => {
      const rest = prev.filter(l => !(l.lineId === lineId && l.bandIndex === bandIndex))
      return cut > 0 ? [...rest, { lineId, bandIndex, cut }] : rest
    })
  }

  const backToPlan = () => router.push(`/transit/vehicle-plan/${id}`)

  useTopbarActions(
    [
      { label: 'Voltar ao plano', icon: Icons.ArrowLeft, onClick: backToPlan, variant: 'ghost' as const, keybind: 'ALT+V' },
      { label: 'Limpar', icon: Icons.Undo2, onClick: reset, disabled: !analysis && form === EMPTY_FORM, keybind: 'ALT+L' },
      { label: isPending ? 'Analisando…' : 'Analisar', icon: isPending ? Icons.Loader2 : Icons.Search, type: 'submit' as const, form: FORM_ID, disabled: isPending, primary: true, keybind: 'ALT+G' },
    ],
    [isPending, analysis, form],
  )

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Analisar meta', icon: Icons.Search, origin: 'vehicle-plan/goal' })
  useShortcut('alt+v', backToPlan, { desc: 'Voltar ao plano', icon: Icons.ArrowLeft, origin: 'vehicle-plan/goal' })
  useShortcut('alt+l', reset, { desc: 'Limpar meta', icon: Icons.Undo2, display: false, origin: 'vehicle-plan/goal' })

  const lineOptions   = (options?.lines ?? []).map(l => ({ id: l.lineId, label: l.code, secondary: l.name }))
  const branchOptions = (options?.branches ?? []).map(b => ({ id: b.id, label: b.name, secondary: b.abbr }))

  return (
    <div className="p-6 flex flex-col gap-6">
      <Breadcrumb segments={[
        { label: 'Início', href: '/' },
        { label: 'Operação', href: '/transit' },
        { label: 'Planejamentos', href: '/transit/vehicle-plan' },
        { label: options?.plan.description ?? '…', href: `/transit/vehicle-plan/${id}` },
        { label: 'Planejar por meta' },
      ]} />

      {options && options.plan.status !== 'DRAFT' && (
        <div className="flex items-center gap-2 rounded-sm px-4 py-3 text-sm bg-yellow-500/15 text-yellow-700 dark:text-yellow-300">
          <Icons.Info className="w-4 h-4 shrink-0" />
          <span>Plano não é rascunho: a análise funciona, mas para gerar as tabelas é preciso criar uma cópia rascunho do plano.</span>
        </div>
      )}

      <GoalForm
        form={form} onChange={setForm} onSubmit={analyze}
        lineOptions={lineOptions} branchOptions={branchOptions}
      />

      {analysis && evaluation && (
        <>
          <GoalSummary evaluation={evaluation} amount={analysis.goal.amount} />
          <LeverList
            context={analysis.context}
            evaluation={evaluation}
            levers={levers}
            extraLines={extraLines}
            onAddLine={lineId => setExtraLines(prev => [...prev, lineId])}
            onCut={setCut}
            branchAbbr={branchAbbr}
            filteredBranches={analysis.goal.branchIds}
          />
        </>
      )}
    </div>
  )
}

// ── step 1: goal ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

function GoalForm({ form, onChange, onSubmit, lineOptions, branchOptions }: {
  form:          FormState
  onChange:      (f: FormState) => void
  onSubmit:      (e: React.FormEvent) => void
  lineOptions:   { id: string; label: string; secondary?: string }[]
  branchOptions: { id: string; label: string; secondary?: string }[]
}) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => onChange({ ...form, [key]: value })
  return (
    <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Meta" hint="Etapa 1: redução de frota">
          <Select value="FLEET_REDUCE" disabled onChange={() => undefined}>
            <option value="FLEET_REDUCE">Reduzir frota</option>
          </Select>
        </Field>
        <Field label="Carros a reduzir" hint="Nenhum momento do dia acima do pico atual menos este valor">
          <Input type="number" min={1} max={500} value={form.amount} onChange={e => set('amount', Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        <Field label="Empresas" hint="Vazio: o plano todo">
          <MultiSelect value={form.branchIds} options={branchOptions} onChange={v => set('branchIds', v)} placeholder="Todas" />
        </Field>
        <Field label="Usar linhas sem demanda" hint="Só depois das linhas com demanda">
          <div className="h-9 flex items-center">
            <Switch checked={form.useLinesWithoutDemand} onToggle={() => set('useLinesWithoutDemand', !form.useLinesWithoutDemand)} />
          </div>
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Linhas analisadas" hint="Vazio: todas as linhas do plano">
          <MultiSelect value={form.lineIds} options={lineOptions} onChange={v => set('lineIds', v)} placeholder="Todas" />
        </Field>
        <Field label="Linhas travadas" hint="A sugestão nunca mexe nelas">
          <MultiSelect value={form.lockedLineIds} options={lineOptions} onChange={v => set('lockedLineIds', v)} placeholder="Nenhuma" />
        </Field>
        <Field label="Máximo por faixa" hint="Carros que uma faixa de linha pode perder (vazio: sem limite)">
          <Input type="number" min={1} value={form.maxCutPerBand} onChange={e => set('maxCutPerBand', e.target.value)} />
        </Field>
        <Field label="Intervalo máximo (min)" hint="Vazio: o teto do critério Maior Vão">
          <Input type="number" min={1} value={form.maxHeadwayMinutes} onChange={e => set('maxHeadwayMinutes', e.target.value)} />
        </Field>
      </div>
    </form>
  )
}

// ── step 2: suggestion ───────────────────────────────────────────────────────

function GoalSummary({ evaluation, amount }: { evaluation: GoalEvaluation; amount: number }) {
  const ev = evaluation
  const missing = ev.maxAfter - ev.ceiling
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Pico atual" value={`${ev.reference} carros`} />
        <Stat label="Teto da meta" value={`${ev.ceiling} carros`} sub={`−${amount}`} />
        <Stat label="Pico depois" value={`${ev.maxAfter} carros`} />
        <Stat
          label="Meta"
          value={ev.reached ? 'Atingida' : `Faltam ${missing}`}
          tone={ev.reached ? 'success' : 'warning'}
          sub={ev.reached ? undefined : `${ev.excessSlots.length} meia(s) hora(s) acima do teto`}
        />
      </div>
      <CurveTable evaluation={ev} />
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'success' | 'warning' }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold tabular-nums',
        tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'warning' && 'text-yellow-600 dark:text-yellow-400')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// carros na rua por hora (a maior das duas meias horas), antes e depois
function CurveTable({ evaluation }: { evaluation: GoalEvaluation }) {
  const hours = Array.from({ length: 24 }, (_, h) => h)
  const at = (curve: number[], h: number) => Math.max(curve[h * 2], curve[h * 2 + 1])
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">Hora</th>
            {hours.map(h => <th key={h} className="px-1.5 py-1.5 font-medium">{String(h).padStart(2, '0')}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <td className="px-2 py-1.5 text-muted-foreground">Antes</td>
            {hours.map(h => <td key={h} className="px-1.5 py-1.5 text-center">{at(evaluation.curveBefore, h)}</td>)}
          </tr>
          <tr className="border-t border-border">
            <td className="px-2 py-1.5 text-muted-foreground">Depois</td>
            {hours.map(h => {
              const v = at(evaluation.curveAfter, h)
              return (
                <td key={h} className={cn('px-1.5 py-1.5 text-center', v > evaluation.ceiling && 'text-yellow-600 dark:text-yellow-400 font-semibold')}>
                  {v}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function LeverList({ context, evaluation, levers, extraLines, onAddLine, onCut, branchAbbr, filteredBranches }: {
  context:          GoalContext
  evaluation:       GoalEvaluation
  levers:           GoalLever[]
  extraLines:       string[]
  onAddLine:        (lineId: string) => void
  onCut:            (lineId: string, bandIndex: number, cut: number) => void
  branchAbbr:       (key: string) => string
  filteredBranches: string[]
}) {
  const shownIds = [...new Set([...levers.map(l => l.lineId), ...extraLines])]
  const shown    = context.lines
    .filter(l => shownIds.includes(l.lineId))
    .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }))
  const addable  = context.lines
    .filter(l => !shownIds.includes(l.lineId) && l.bands.some(b => b.fleet > 1 && b.cycleMinutes > 0))
    .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }))
  const details  = new Map(evaluation.levers.map(d => [`${d.lineId}#${d.bandIndex}`, d]))
  const totalCut = levers.reduce((s, l) => s + l.cut, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold">
          Sugestão · {shown.length} linha(s), {totalCut} carro(s) a menos em faixas
        </h2>
        {addable.length > 0 && (
          <div className="w-64">
            <Select value="" onChange={e => e.target.value && onAddLine(e.target.value)} size="sm">
              <option value="">Adicionar linha…</option>
              {addable.map(l => <option key={l.lineId} value={l.lineId}>{l.code}</option>)}
            </Select>
          </div>
        )}
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma faixa pode ser ajustada dentro das restrições. Afrouxe o intervalo máximo, permita linhas sem demanda ou reduza a meta.
        </p>
      )}

      {shown.map(line => (
        <LineCard
          key={line.lineId}
          line={line}
          levers={levers}
          details={details}
          onCut={onCut}
          branchAbbr={branchAbbr}
          filteredBranches={filteredBranches}
        />
      ))}
    </div>
  )
}

function LineCard({ line, levers, details, onCut, branchAbbr, filteredBranches }: {
  line:             GoalLine
  levers:           GoalLever[]
  details:          Map<string, GoalLeverDetail>
  onCut:            (lineId: string, bandIndex: number, cut: number) => void
  branchAbbr:       (key: string) => string
  filteredBranches: string[]
}) {
  const [showAll, setShowAll] = useState(false)
  const cutOf = (i: number) => levers.find(l => l.lineId === line.lineId && l.bandIndex === i)?.cut ?? 0
  const rows  = line.bands
    .map((band, i) => ({ band, i }))
    .filter(({ band, i }) => band.fleet > 0 && band.cycleMinutes > 0 && (showAll || cutOf(i) > 0))

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border">
        <span className="text-sm font-semibold">{line.code}</span>
        {line.alerts.map(a => (
          <span key={a} title={LINE_ALERT[a]} className="inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-300">
            <Icons.AlertTriangle className="w-3.5 h-3.5" />{LINE_ALERT[a].split(':')[0]}
          </span>
        ))}
        <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Só faixas ajustadas' : 'Todas as faixas'}
        </button>
      </div>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="px-4 py-1.5 text-left font-medium">Faixa</th>
            <th className="px-2 py-1.5 text-left font-medium">Carros a menos</th>
            <th className="px-2 py-1.5 text-left font-medium">Frota</th>
            <th className="px-2 py-1.5 text-left font-medium">Intervalo</th>
            <th className="px-2 py-1.5 text-left font-medium">Ocupação</th>
            <th className="px-2 py-1.5 text-left font-medium">Empresas</th>
            <th className="px-2 py-1.5 text-left font-medium">Custo</th>
            <th className="px-2 py-1.5 text-left font-medium">Alertas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ band, i }) => {
            const cut = cutOf(i)
            const d   = details.get(`${line.lineId}#${i}`)
            return (
              <tr key={i} className="border-t border-border">
                <td className="px-4 py-1.5 whitespace-nowrap">{hourToLabel(band.from)}–{hourToLabel(band.to)}</td>
                <td className="px-2 py-1.5">
                  <Stepper value={cut} min={0} max={band.fleet - 1} onChange={v => onCut(line.lineId, i, v)} />
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">{band.fleet} → {band.fleet - cut}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{fmtMin(band.cycleMinutes / band.fleet)} → {d ? fmtMin(d.after.headway) : fmtMin(band.cycleMinutes / band.fleet)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{d ? `${fmtPct(d.occBefore)} → ${fmtPct(d.after.occupancy)}` : '—'}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                  {d ? <BranchSplit detail={d} branchAbbr={branchAbbr} /> : '—'}
                </td>
                <td className="px-2 py-1.5">{d ? d.after.cost.toFixed(2) : '—'}</td>
                <td className="px-2 py-1.5 text-xs">{d ? <LeverAlerts detail={d} filteredBranches={filteredBranches} /> : null}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BranchSplit({ detail, branchAbbr }: { detail: GoalLeverDetail; branchAbbr: (key: string) => string }) {
  const keys = Object.keys(detail.byBranchBefore)
  return (
    <span className="flex flex-col">
      {keys.map(k => (
        <span key={k}>{branchAbbr(k)} {detail.byBranchBefore[k]} → {detail.byBranchAfter[k] ?? 0}</span>
      ))}
    </span>
  )
}

function LeverAlerts({ detail, filteredBranches }: { detail: GoalLeverDetail; filteredBranches: string[] }) {
  const alerts: string[] = []
  if (detail.after.blocked) alerts.push('Fora das restrições (intervalo máximo ou faixa sem carro)')
  if (detail.after.tier === 3) alerts.push('Ocupação acima do teto')
  if (detail.after.tier === 2) alerts.push('Sem demanda')
  const others = Object.keys(detail.byBranchBefore).filter(k => filteredBranches.length > 0 && !filteredBranches.includes(k)
    && detail.byBranchBefore[k] !== (detail.byBranchAfter[k] ?? 0))
  if (others.length > 0) alerts.push('Linha compartilhada: afeta empresa fora do filtro')
  if (detail.requirements.length > 0) alerts.push(`Marco: ${detail.requirements.join(', ')}`)
  if (alerts.length === 0) return null
  return (
    <span className="flex flex-col gap-0.5">
      {alerts.map(a => <Badge key={a} label={a} color="warning" />)}
    </span>
  )
}
