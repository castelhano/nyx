'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CrewPlanSummary, CrewSettings } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import { apiFetch, getToken } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { useShortcutContext } from '@/lib/keywatch'
import { cn, extractError } from '@/lib/utils'
import { CrewSettingsEditor } from '../../../settings/crew-settings-editor'
import { fmtDuration, KIND_LABEL } from '../board.types'
import { Badge } from './DutyPanel'

// "Otimizar" — one modal, three tabs:
//  Config    the plan's own duty rules. While it inherits (Scope/global) everything is
//            read-only and "Customizar" copies the effective values into the plan; once
//            customized they are editable (diffed against the inherited ones) and "Restaurar
//            padrão" drops the copy. Unsaved changes must be saved or discarded before
//            leaving the tab; read-only while a generation runs (the solver already read them).
//  Painel    solver parameters; "Gerar" starts a run (SSE) and jumps to Cenários.
//  Cenários  the run's best proposal next to the current plan, then "Criar versão" (a new
//            DRAFT crew plan) — or, on a DRAFT plan, "Aplicar nesta escala" (its duties are
//            replaced, locked ones kept). A new run replaces it. See docs/architecture/transit/crew-solver.md.
// The generation belongs to the crew plan: closing the modal (or leaving the page) leaves it
// running on the server; reopening picks it up (`job`, from GET …/solver/current) and the stream
// replays its state. "Parar" ends it keeping the best proposal, "Descartar" throws it away.

export type OptimizeTab = 'config' | 'panel' | 'scenarios'

const TABS: { value: OptimizeTab; label: string }[] = [
  { value: 'config',    label: 'Config' },
  { value: 'panel',     label: 'Painel' },
  { value: 'scenarios', label: 'Cenários' },
]

interface SettingsView { settings: CrewSettings; isCustom: boolean; inherited: CrewSettings }

interface Params {
  base:          'complete' | 'scratch'
  direction:     'balanced' | 'fewer_duties' | 'fewer_paid'
  fareCollector: boolean
  assistant:     boolean
  optimize:      boolean
}

type StopReason = 'finished' | 'user_stopped' | 'max_time' | 'no_improvement'

// elapsed / sinceImprovement in ms
type Progress = { elapsed: number; attempts: number; improvements: number; bestScore: number; sinceImprovement: number }

type Message =
  | ({ type: 'progress' } & Progress)
  | { type: 'proposal'; proposal: { index: number; summary: CrewPlanSummary } }
  | { type: 'done'; stopReason: StopReason; elapsed: number; attempts: number }
  | { type: 'error'; message: string }

const STOP_LABEL: Record<StopReason, string> = {
  finished:       'Concluído',
  user_stopped:   'Interrompido',
  max_time:       'Tempo máximo atingido',
  no_improvement: 'Sem melhora',
}

const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const DIRECTIONS: { value: Params['direction']; label: string }[] = [
  { value: 'balanced',     label: 'Equilibrado' },
  { value: 'fewer_duties', label: 'Menor quadro' },
  { value: 'fewer_paid',   label: 'Menor jornada' },
]

// GET /transit/crew-plan/:id/solver/current (CrewSolverJobState)
export interface SolverJob {
  jobId:       string
  params:      Params
  startedAt:   number
  running:     boolean
  stopReason:  StopReason | null
  error:       string | null
  progress:    Progress | null
  hasProposal: boolean
}

interface Props {
  crewPlanId:      string
  initialTab:      OptimizeTab
  // a DRAFT plan takes the proposal in place; an ACTIVE one gets a new DRAFT version
  planStatus:      'DRAFT' | 'ACTIVE' | 'SUPERSEDED'
  // the plan's generation, running or ended and not yet used
  job:             SolverJob | null
  // after a generation starts, ends up accepted or is discarded
  onJobChanged:    () => void
  // the proposal was applied to this (DRAFT) plan
  onApplied:       () => void
  current:         CrewPlanSummary | null
  lockedCount:     number
  // vehicles with modeling errors (VehicleBlock.issues) — the generation inherits them
  flaggedBlocks:   number
  vehiclePlanId:   string
  // after a settings change — the server already recalculated the plan
  onSettingsSaved: () => void
  onCreated:       (newPlanId: string) => void
  onClose:         () => void
}

async function callSettings(path: string, init?: RequestInit): Promise<SettingsView> {
  const res  = await apiFetch(path, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json))
  return json as SettingsView
}

export function OptimizeCrewModal({ crewPlanId, initialTab, planStatus, job, onJobChanged, onApplied, current, lockedCount, flaggedBlocks, vehiclePlanId, onSettingsSaved, onCreated, onClose }: Props) {
  useShortcutContext('optimize_crew_md')
  const { toast } = useToast()
  const confirm   = useConfirm()
  const settingsBase = `/transit/crew-plan/${crewPlanId}/settings`
  const solverBase   = `/transit/crew-plan/${crewPlanId}/solver`

  const [tab, setTab] = useState<OptimizeTab>(initialTab)

  // ── config ──
  const { data: settingsView, refetch: refetchSettings } = useQuery<SettingsView>({
    queryKey: ['transit', 'crew-plan', crewPlanId, 'settings'],
    queryFn:  () => callSettings(settingsBase),
  })
  const [draft, setDraft]                   = useState<CrewSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  // (re)seed the draft whenever the server copy changes (load, customize, save, restore)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (settingsView) setDraft(settingsView.settings) }, [settingsView])

  const dirty    = !!settingsView && !!draft && JSON.stringify(draft) !== JSON.stringify(settingsView.settings)
  const isCustom = !!settingsView?.isCustom

  // ── generation ──
  const [params, setParams]           = useState<Params>({ base: 'complete', direction: 'balanced', fareCollector: false, assistant: false, optimize: true, ...job?.params })
  const [jobId, setJobId]             = useState<string | null>(job?.jobId ?? null)
  const [running, setRunning]         = useState(job?.running ?? false)
  const [proposal, setProposal]       = useState<{ index: number; summary: CrewPlanSummary } | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [accepting, setAccepting]     = useState(false)
  const [progress, setProgress]       = useState<Progress | null>(job?.progress ?? null)
  const [stopReason, setStopReason]   = useState<StopReason | null>(job?.stopReason ?? null)
  const esRef = useRef<EventSource | null>(null)
  useEffect(() => () => esRef.current?.close(), [])

  // the stream sends the job's state first, then what comes next
  function attach(id: string) {
    esRef.current?.close()
    const es = new EventSource(`/api${solverBase}/stream?jobId=${id}&token=${encodeURIComponent(getToken())}`)
    esRef.current = es
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as Message
      if (msg.type === 'proposal') setProposal(msg.proposal)
      if (msg.type === 'progress') setProgress(msg)
      if (msg.type === 'done') setStopReason(msg.stopReason)
      if (msg.type === 'error') setError(msg.message)
      if (msg.type === 'done' || msg.type === 'error') { es.close(); setRunning(false) }
    }
    es.onerror = () => { es.close(); setRunning(false) }
  }

  // pick up the plan's generation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (job) attach(job.jobId) }, [])

  async function handleStop() {
    if (jobId) await apiFetch(`${solverBase}/stop`, { method: 'POST', body: JSON.stringify({ jobId }) }).catch(() => null)
  }

  // a pending "save or discard" prompt — Esc must not open a second one
  const promptingRef = useRef(false)

  async function leaveConfigAllowed(): Promise<boolean> {
    if (!dirty) return true
    if (promptingRef.current) return false
    promptingRef.current = true
    const ok = await confirm({
      title:        'Alterações não salvas',
      description:  'As configurações foram alteradas. Salve ou descarte as alterações antes de continuar.',
      confirmLabel: 'Descartar',
      variant:      'destructive',
    }).finally(() => { promptingRef.current = false })
    if (ok && settingsView) setDraft(settingsView.settings)
    return ok
  }

  async function switchTab(next: OptimizeTab) {
    if (next === tab) return
    if (tab === 'config' && !(await leaveConfigAllowed())) return
    setTab(next)
  }

  // the generation keeps running on the server
  async function handleClose() {
    if (tab === 'config' && !(await leaveConfigAllowed())) return
    esRef.current?.close()
    onClose()
  }

  async function handleDiscard() {
    if (!jobId) return
    await apiFetch(`${solverBase}/discard`, { method: 'POST', body: JSON.stringify({ jobId }) }).catch(() => null)
    esRef.current?.close()
    setJobId(null); setRunning(false); setProposal(null); setProgress(null); setStopReason(null); setError(null); setDescription('')
    onJobChanged()
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape' && !promptingRef.current) void handleClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  })

  async function runSettings(fn: () => Promise<unknown>, success: string) {
    setSavingSettings(true)
    try {
      await fn()
      await refetchSettings()
      onSettingsSaved()
      toast.success(success)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar configuração')
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleRestore() {
    const ok = await confirm({
      title:        'Restaurar configuração padrão',
      description:  'Os valores personalizados desta escala serão descartados e ela volta a seguir a configuração do Scope/global.',
      confirmLabel: 'Restaurar',
      variant:      'destructive',
    })
    if (ok) await runSettings(() => callSettings(settingsBase, { method: 'DELETE' }), 'Configuração padrão restaurada')
  }

  // a new run replaces the previous one (the server drops it)
  async function handleStart() {
    esRef.current?.close()
    setError(null); setProposal(null); setDescription(''); setJobId(null); setProgress(null); setStopReason(null)
    setTab('scenarios')
    const id  = crypto.randomUUID()
    const res = await apiFetch(`${solverBase}/start`, { method: 'POST', body: JSON.stringify({ jobId: id, params }) })
    if (!res.ok) { setError(extractError(await res.json().catch(() => ({})))); return }
    setJobId(id); setRunning(true)
    attach(id)
    onJobChanged()
  }

  const inPlace = planStatus === 'DRAFT'

  async function handleAccept() {
    if (!jobId) return
    if (inPlace && !(await confirm({
      title:        'Aplicar nesta escala',
      description:  'As jornadas desta escala serão substituídas pela proposta (as travadas são mantidas quando a base é "Completar").',
      confirmLabel: 'Aplicar',
    }))) return
    setAccepting(true)
    try {
      const res  = await apiFetch(`${solverBase}/accept`, { method: 'POST', body: JSON.stringify({ jobId, description }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(extractError(json)); return }
      if (inPlace) onApplied()
      else onCreated((json as { id: string }).id)
    } finally {
      setAccepting(false)
    }
  }

  const editable = isCustom && !savingSettings && !running
  const s = proposal?.summary

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => void handleClose()} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl mx-4 h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-4 px-6 pt-4 border-b border-border">
          <div className="flex items-end gap-6">
            <h2 className="text-base font-semibold pb-3">Otimizar escala</h2>
            <div className="flex">
              {TABS.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => void switchTab(t.value)}
                  className={cn(
                    'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                    t.value === tab ? 'border-ring text-ring' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 pb-3">
            {jobId && (
              <span className={cn('text-xs', running ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400')}>
                {running ? 'Gerando…' : stopReason ? STOP_LABEL[stopReason] : proposal ? 'Concluído' : ''}
              </span>
            )}
            <button type="button" onClick={() => void handleClose()} className="text-muted-foreground hover:text-foreground" title="Fechar">
              <Icons.X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'config' && (
            <>
              <div className="flex items-center gap-2 mb-4">
                {settingsView && (isCustom
                  ? <Badge tone="amber">Personalizada</Badge>
                  : <Badge tone="green">Padrão (Scope/global)</Badge>)}
                {running && <span className="text-xs text-muted-foreground">Somente leitura durante a geração</span>}
              </div>
              {settingsView && !isCustom && (
                <div className="flex items-center gap-x-2 rounded-sm p-3 mb-5 text-sm text-slate-50 bg-slate-500 dark:text-slate-300 dark:bg-slate-800/50">
                  <Icons.Info className="w-4 h-4 shrink-0" />
                  <span>Esta escala segue a configuração do Scope/global. Clique em &quot;Customizar&quot; para copiar os valores e ajustá-los só para esta escala.</span>
                </div>
              )}
              {draft && settingsView ? (
                <CrewSettingsEditor
                  value={draft}
                  reference={isCustom ? settingsView.inherited : null}
                  onChange={setDraft}
                  disabled={!editable}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              )}
            </>
          )}

          {tab === 'panel' && (
            <div className="max-w-xl space-y-4 text-sm">
              {flaggedBlocks > 0 && (
                <div className="flex items-start gap-2 rounded-sm p-3 text-amber-800 bg-amber-500/10 dark:text-amber-300">
                  <Icons.AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {flaggedBlocks} {flaggedBlocks === 1 ? 'carro tem' : 'carros têm'} lançamento a revisar no{' '}
                    <Link href={`/transit/vehicle-plan/${vehiclePlanId}`} className="underline">planejamento de veículos</Link>
                    {' '}(sem acesso, parado sem intervalo, local diferente…). A geração herda esses erros.
                  </span>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={params.base === 'complete'} onChange={() => setParams(p => ({ ...p, base: 'complete' }))} />
                  Respeita travadas ({lockedCount})
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={params.base === 'scratch'} onChange={() => setParams(p => ({ ...p, base: 'scratch' }))} />
                  Completa
                </label>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">Direção</span>
                <Select value={params.direction} onChange={e => setParams(p => ({ ...p, direction: e.target.value as Params['direction'] }))} size="sm" wrapperClassName="w-48">
                  {DIRECTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </Select>
              </div>
              <div className="flex items-center gap-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={params.fareCollector} onChange={e => setParams(p => ({ ...p, fareCollector: e.target.checked }))} />
                  Gerar cobrador
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={params.assistant} onChange={e => setParams(p => ({ ...p, assistant: e.target.checked }))} />
                  Gerar auxiliar
                </label>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={params.optimize} onChange={e => setParams(p => ({ ...p, optimize: e.target.checked }))} />
                Otimizar após o corte inicial
              </label>
              <p className="text-xs text-muted-foreground">
                A escala é montada para motorista e replicada para os papéis marcados, com as regras da aba Config. {inPlace ? 'O resultado substitui as jornadas desta escala (rascunho) — as travadas são mantidas em "Completar".' : 'O resultado vira uma nova versão em rascunho — esta escala não é alterada.'}
                {jobId && ' Gerar novamente descarta o cenário atual.'}
              </p>
            </div>
          )}

          {tab === 'scenarios' && (
            <div className="max-w-2xl space-y-4">
              {!jobId && !error && (
                <p className="text-sm text-muted-foreground">Nenhum cenário gerado. Use o Painel para gerar uma proposta.</p>
              )}
              {jobId && (
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <RunStat label="Cenários analisados" value={progress ? progress.attempts.toLocaleString('pt-BR') : '—'} />
                  <RunStat label="Melhorias"           value={progress ? progress.improvements.toLocaleString('pt-BR') : '—'} />
                  <RunStat label="Tempo total"         value={progress ? fmtClock(progress.elapsed) : '—'} />
                  <RunStat label="Desde a última melhora" value={progress ? fmtClock(progress.sinceImprovement) : '—'} />
                </div>
              )}
              {jobId && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="text-left pb-2 font-medium">Métrica</th>
                      <th className="text-right pb-2 font-medium">Escala atual</th>
                      <th className="text-right pb-2 font-medium">Proposta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    <Row label="Quadro"          current={current?.dutyCount}        next={s?.dutyCount} />
                    <Row label="Sem motorista"   current={current?.uncoveredMinutes} next={s?.uncoveredMinutes} fmt={fmtDuration} />
                    <Row label="Trabalhado"      current={current?.workMinutes}      next={s?.workMinutes}      fmt={fmtDuration} />
                    <Row label="Extra"           current={current?.overtimeMinutes}  next={s?.overtimeMinutes}  fmt={fmtDuration} />
                    <Row label="Com pendências"  current={current?.issueDutyCount}   next={s?.issueDutyCount} />
                    <Row label="Score"           current={current?.score}            next={s?.score} />
                    <Row label="Score sem teto"  current={current?.rawScore}         next={s?.rawScore} />
                  </tbody>
                </table>
              )}
              {s && (
                <p className="text-xs text-muted-foreground">
                  {(Object.entries(s.byKind) as [keyof typeof KIND_LABEL, number][]).map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(' · ')}
                </p>
              )}
              {s && !running && !inPlace && (
                <input
                  value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição da nova versão (opcional)"
                  className="w-full h-8 border border-input rounded-sm text-sm bg-input-bg px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
          <div>
            {tab === 'config' && isCustom && (
              <Button type="button" variant="destructive" size="sm" disabled={savingSettings || running} onClick={() => void handleRestore()}>
                <Icons.RotateCcw className="w-3.5 h-3.5 me-1" /> Restaurar padrão
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {tab === 'config' && dirty ? (
              <Button type="button" variant="cancel" size="sm" disabled={savingSettings} onClick={() => settingsView && setDraft(settingsView.settings)}>Descartar</Button>
            ) : (
              <Button type="button" variant="cancel" size="sm" onClick={() => void handleClose()}>Fechar</Button>
            )}

            {tab === 'config' && !isCustom && settingsView && (
              <Button type="button" size="sm" disabled={savingSettings || running} onClick={() => void runSettings(() => callSettings(`${settingsBase}/customize`, { method: 'POST' }), 'Configuração copiada para esta escala')}>
                <Icons.Settings2 className="w-3.5 h-3.5 me-1" /> Customizar
              </Button>
            )}
            {tab === 'config' && isCustom && (
              <Button type="button" size="sm" disabled={!editable || !dirty} onClick={() => void runSettings(() => callSettings(settingsBase, { method: 'PUT', body: JSON.stringify(draft) }), 'Configuração salva')}>
                <Icons.Save className="w-3.5 h-3.5 me-1" /> {savingSettings ? 'Salvando…' : 'Salvar'}
              </Button>
            )}

            {tab === 'panel' && (
              <Button type="button" size="sm" disabled={running} onClick={() => void handleStart()}>
                <Icons.Play className="w-3.5 h-3.5 me-1" /> Gerar
              </Button>
            )}

            {tab === 'scenarios' && jobId && (
              <Button type="button" size="sm" variant="outline" disabled={accepting} onClick={() => void handleDiscard()}>
                <Icons.Trash2 className="w-3.5 h-3.5 me-1" /> Descartar
              </Button>
            )}
            {tab === 'scenarios' && running && (
              <Button type="button" size="sm" variant="outline" onClick={() => void handleStop()}>
                <Icons.Square className="w-3.5 h-3.5 me-1" /> Parar
              </Button>
            )}
            {tab === 'scenarios' && s && (
              <Button type="button" size="sm" disabled={accepting || running} onClick={() => void handleAccept()}>
                {accepting ? (inPlace ? 'Aplicando…' : 'Criando…') : (inPlace ? 'Aplicar nesta escala' : 'Criar versão')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RunStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/40 px-2 py-1">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium font-mono tabular-nums">{value}</p>
    </div>
  )
}

function Row({ label, current, next, fmt = (n: number) => n.toLocaleString('pt-BR') }: {
  label: string; current: number | undefined; next: number | undefined; fmt?: (n: number) => string
}) {
  return (
    <tr>
      <td className="py-2 text-muted-foreground">{label}</td>
      <td className="py-2 text-right font-mono tabular-nums">{current != null ? fmt(current) : '—'}</td>
      <td className="py-2 text-right font-mono tabular-nums">{next != null ? fmt(next) : '—'}</td>
    </tr>
  )
}
