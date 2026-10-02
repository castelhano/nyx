'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { VEHICLE_TYPE_LABELS, type PlanningSettings, type VehicleTypeValue } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import { apiFetch, getToken } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { useShortcutContext } from '@/lib/keywatch'
import { cn, extractError } from '@/lib/utils'
import { PlanningSettingsEditor, PLANNING_CRITERIA_LABEL } from '../../../settings/planning-settings-editor'

// "Otimizar" — one modal, three tabs:
//  Config    the plan's own planning settings. While it inherits (Scope/global) everything is
//            read-only and "Customizar" copies the effective values into the plan; once
//            customized they are editable (diffed against the inherited ones) and "Restaurar
//            padrão" drops the copy. Unsaved changes must be saved or discarded before
//            leaving the tab; read-only while a generation runs (the solver already read them).
//  Painel    solver parameters; "Gerar" starts a run (SSE) and jumps to Cenários.
//  Cenários  the run's best proposal next to the plan as it was, then "Aplicar" — the plan's
//            blocks are replaced in place (locked ones kept). A new run replaces it.
//            See docs/proposal/plan_vehicle_solver_v2.md.
// The generation belongs to the plan: closing the modal (or leaving the page) leaves it
// running on the server; reopening picks it up (`job`, from GET …/solver/current) and the stream
// replays its state. "Parar" ends it keeping the best proposal, "Descartar" throws it away.

export type OptimizeTab = 'config' | 'panel' | 'scenarios'

const TABS: { value: OptimizeTab; label: string }[] = [
  { value: 'config',    label: 'Config' },
  { value: 'panel',     label: 'Painel' },
  { value: 'scenarios', label: 'Cenários' },
]

interface SettingsView { settings: PlanningSettings; isCustom: boolean; inherited: PlanningSettings }

interface Params {
  base:      'complete' | 'scratch'
  direction: 'balanced' | 'fleet' | 'km'
}

// VehicleSolverSummary (apps/api/.../vehicle-solver/vehicle-solver.types.ts)
interface Summary {
  score:        number
  fleetCount:   number
  deadrunKm:    number
  productiveKm: number
  totalKm:      number
  issueBlocks:  number
  byBranch:     { branchId: string | null; fleet: number; km: number }[]
  byDepot:      { depotId: string; vehicleType: VehicleTypeValue; fleet: number }[]
  criteria:     { key: string; weight: number; value: number }[]
}

type StopReason = 'finished' | 'user_stopped' | 'max_time' | 'no_improvement'

// elapsed / sinceImprovement in ms
type Progress = { elapsed: number; attempts: number; improvements: number; bestScore: number; sinceImprovement: number }

type Message =
  | ({ type: 'progress' } & Progress)
  | { type: 'proposal'; proposal: { index: number; summary: Summary } }
  | { type: 'done'; stopReason: StopReason; elapsed: number; attempts: number }
  | { type: 'error'; message: string }

const STOP_LABEL: Record<StopReason, string> = {
  finished:       'Concluído',
  user_stopped:   'Interrompido',
  max_time:       'Tempo máximo atingido',
  no_improvement: 'Sem melhora',
}

const DIRECTIONS: { value: Params['direction']; label: string }[] = [
  { value: 'balanced', label: 'Equilibrado' },
  { value: 'fleet',    label: 'Menor frota' },
  { value: 'km',       label: 'Menor km' },
]

const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const fmtKm = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

// GET /transit/vehicle-plan/:id/solver/current (VehicleSolverJobState)
export interface SolverJob {
  jobId:             string
  params:            Params
  startedAt:         number
  running:           boolean
  stopReason:        StopReason | null
  error:             string | null
  progress:          Progress | null
  hasProposal:       boolean
  baseline:          Summary
  affectedCrewPlans: number
}

interface Props {
  planId:          string
  initialTab:      OptimizeTab
  // the plan's generation, running or ended and not yet used
  job:             SolverJob | null
  lockedCount:     number
  // after a generation starts, is applied or discarded
  onJobChanged:    () => void
  // the proposal was applied to the plan
  onApplied:       () => void
  // after a settings change — the server already recalculated the plan
  onSettingsSaved: () => void
  onClose:         () => void
}

interface Named { id: string; name: string }

async function callSettings(path: string, init?: RequestInit): Promise<SettingsView> {
  const res  = await apiFetch(path, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json))
  return json as SettingsView
}

async function fetchList(path: string): Promise<Named[]> {
  const res = await apiFetch(path)
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? json
}

export function OptimizeModal({ planId, initialTab, job, lockedCount, onJobChanged, onApplied, onSettingsSaved, onClose }: Props) {
  useShortcutContext('optimize_md')
  const { toast } = useToast()
  const confirm   = useConfirm()
  const settingsBase = `/transit/vehicle-plan/${planId}/settings`
  const solverBase   = `/transit/vehicle-plan/${planId}/solver`

  const [tab, setTab] = useState<OptimizeTab>(initialTab)

  // names for the per-operator / per-depot rows
  const { data: branches = [] } = useQuery({ queryKey: ['core', 'branch', 'all'], queryFn: () => fetchList('/core/branch?pageSize=999') })
  const { data: depots = [] }   = useQuery({ queryKey: ['transit', 'transit-locality', 'depots'], queryFn: () => fetchList('/transit/transit-locality?f_isDepot=true&pageSize=100') })
  const branchName = (id: string | null) => (id ? branches.find(b => b.id === id)?.name ?? id.slice(0, 8) : 'Sem empresa')
  const depotName  = (id: string) => depots.find(d => d.id === id)?.name ?? id.slice(0, 8)

  // ── config ──
  const { data: settingsView, refetch: refetchSettings } = useQuery<SettingsView>({
    queryKey: ['transit', 'vehicle-plan', planId, 'settings'],
    queryFn:  () => callSettings(settingsBase),
  })
  const [draft, setDraft]                   = useState<PlanningSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  // (re)seed the draft whenever the server copy changes (load, customize, save, restore)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (settingsView) setDraft(settingsView.settings) }, [settingsView])

  const dirty    = !!settingsView && !!draft && JSON.stringify(draft) !== JSON.stringify(settingsView.settings)
  const isCustom = !!settingsView?.isCustom

  // ── generation ──
  const [params, setParams]         = useState<Params>(job?.params ?? { base: 'complete', direction: 'balanced' })
  const [jobId, setJobId]           = useState<string | null>(job?.jobId ?? null)
  const [running, setRunning]       = useState(job?.running ?? false)
  const [proposal, setProposal]     = useState<{ index: number; summary: Summary } | null>(null)
  const [baseline, setBaseline]     = useState<Summary | null>(job?.baseline ?? null)
  const [affected, setAffected]     = useState(job?.affectedCrewPlans ?? 0)
  const [error, setError]           = useState<string | null>(job?.error ?? null)
  const [accepting, setAccepting]   = useState(false)
  const [progress, setProgress]     = useState<Progress | null>(job?.progress ?? null)
  const [stopReason, setStopReason] = useState<StopReason | null>(job?.stopReason ?? null)
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
      if (msg.type === 'done' || msg.type === 'error') { es.close(); setRunning(false); onJobChanged() }
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
    setJobId(null); setRunning(false); setProposal(null); setBaseline(null); setProgress(null); setStopReason(null); setError(null)
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
      description:  'Os valores personalizados deste planejamento serão descartados e ele volta a seguir a configuração do Scope/global.',
      confirmLabel: 'Restaurar',
      variant:      'destructive',
    })
    if (ok) await runSettings(() => callSettings(settingsBase, { method: 'DELETE' }), 'Configuração padrão restaurada')
  }

  // the plan's generation as the server has it (baseline, crew plans affected)
  async function refreshJob() {
    const res = await apiFetch(`${solverBase}/current`)
    if (!res.ok) return
    const { job: current } = (await res.json()) as { job: SolverJob | null }
    if (current) { setBaseline(current.baseline); setAffected(current.affectedCrewPlans) }
  }

  // a new run replaces the previous one (the server drops it)
  async function handleStart() {
    esRef.current?.close()
    setError(null); setProposal(null); setBaseline(null); setJobId(null); setProgress(null); setStopReason(null)
    setTab('scenarios')
    const id  = crypto.randomUUID()
    const res = await apiFetch(`${solverBase}/start`, { method: 'POST', body: JSON.stringify({ jobId: id, params }) })
    if (!res.ok) { setError(extractError(await res.json().catch(() => ({})))); return }
    setJobId(id); setRunning(true)
    attach(id)
    void refreshJob()
    onJobChanged()
  }

  async function handleAccept() {
    if (!jobId) return
    const ok = await confirm({
      title:        'Aplicar proposta',
      description:  `Os carros deste planejamento serão substituídos pela proposta${params.base === 'complete' ? ' (os travados são mantidos)' : ''}.`
        + (affected ? ` ${affected} ${affected === 1 ? 'escala tem' : 'escalas têm'} pegadas nesses carros e ${affected === 1 ? 'ficará' : 'ficarão'} com pegadas desvinculadas.` : ''),
      confirmLabel: 'Aplicar',
    })
    if (!ok) return
    setAccepting(true)
    try {
      const res  = await apiFetch(`${solverBase}/accept`, { method: 'POST', body: JSON.stringify({ jobId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(extractError(json)); return }
      onApplied()
    } finally {
      setAccepting(false)
    }
  }

  const editable = isCustom && !savingSettings && !running
  const s = proposal?.summary

  // per-operator / per-depot rows: the union of the plan's and the proposal's
  const branchRows = [...new Set([...(baseline?.byBranch ?? []), ...(s?.byBranch ?? [])].map(b => b.branchId))]
  const depotRows  = [...new Map([...(baseline?.byDepot ?? []), ...(s?.byDepot ?? [])].map(d => [`${d.depotId}:${d.vehicleType}`, d])).values()]
    .sort((a, b) => depotName(a.depotId).localeCompare(depotName(b.depotId)) || a.vehicleType.localeCompare(b.vehicleType))
  const criteriaRows = [...new Set([...(baseline?.criteria ?? []), ...(s?.criteria ?? [])].map(c => c.key))]
  const criterion = (sum: Summary | null | undefined, key: string) => sum?.criteria.find(c => c.key === key)?.value

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => void handleClose()} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl mx-4 h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-4 px-6 pt-4 border-b border-border">
          <div className="flex items-end gap-6">
            <h2 className="text-base font-semibold pb-3">Otimizar planejamento</h2>
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
                  ? <span className="text-xs font-medium rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-400">Personalizada</span>
                  : <span className="text-xs font-medium rounded px-1.5 py-0.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Padrão (Scope/global)</span>)}
                {running && <span className="text-xs text-muted-foreground">Somente leitura durante a geração</span>}
              </div>
              {settingsView && !isCustom && (
                <div className="flex items-center gap-x-2 rounded-sm p-3 mb-5 text-sm text-slate-50 bg-slate-500 dark:text-slate-300 dark:bg-slate-800/50">
                  <Icons.Info className="w-4 h-4 shrink-0" />
                  <span>Este planejamento segue a configuração do Scope/global. Clique em &quot;Customizar&quot; para copiar os valores e ajustá-los só para este planejamento.</span>
                </div>
              )}
              {draft && settingsView ? (
                <PlanningSettingsEditor
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
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={params.base === 'complete'} onChange={() => setParams(p => ({ ...p, base: 'complete' }))} />
                  Respeita travados ({lockedCount})
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={params.base === 'scratch'} onChange={() => setParams(p => ({ ...p, base: 'scratch' }))} />
                  Completa (refaz todos os carros)
                </label>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">Direção</span>
                <Select value={params.direction} onChange={e => setParams(p => ({ ...p, direction: e.target.value as Params['direction'] }))} size="sm" wrapperClassName="w-48">
                  {DIRECTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                O solver distribui todas as viagens do planejamento — de todas as linhas — em carros, decidindo empresa, garagem e tipo de veículo,
                com as regras da aba Config, a participação das empresas no escopo, as garagens e capacidades cadastradas e os tipos de veículo das linhas.
                O resultado substitui os carros deste planejamento{params.base === 'complete' ? ' — os travados são mantidos' : ''}.
                {jobId && ' Gerar novamente descarta o cenário atual.'}
              </p>
            </div>
          )}

          {tab === 'scenarios' && (
            <div className="max-w-3xl space-y-5">
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
                      <th className="text-right pb-2 font-medium">Planejamento atual</th>
                      <th className="text-right pb-2 font-medium">Proposta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    <Row label="Nota"           current={baseline?.score}       next={s?.score} />
                    <Row label="Frota"          current={baseline?.fleetCount}  next={s?.fleetCount} />
                    <Row label="Km ocioso"      current={baseline?.deadrunKm}   next={s?.deadrunKm} fmt={fmtKm} />
                    <Row label="Km total"       current={baseline?.totalKm}     next={s?.totalKm}   fmt={fmtKm} />
                    <Row label="Com pendências" current={baseline?.issueBlocks} next={s?.issueBlocks} />
                    {branchRows.length > 1 && <Section label="Frota por empresa" />}
                    {branchRows.length > 1 && branchRows.map(id => {
                      const cur = baseline?.byBranch.find(b => b.branchId === id), nxt = s?.byBranch.find(b => b.branchId === id)
                      return <Row key={id ?? '-'} label={branchName(id)} current={cur?.fleet} next={nxt?.fleet} detail={[cur, nxt].map(x => x && `${fmtKm(x.km)} km`)} />
                    })}
                    <Section label="Frota por garagem" />
                    {depotRows.map(d => (
                      <Row
                        key={`${d.depotId}:${d.vehicleType}`}
                        label={`${depotName(d.depotId)} · ${VEHICLE_TYPE_LABELS[d.vehicleType] ?? d.vehicleType}`}
                        current={baseline?.byDepot.find(x => x.depotId === d.depotId && x.vehicleType === d.vehicleType)?.fleet ?? 0}
                        next={s ? s.byDepot.find(x => x.depotId === d.depotId && x.vehicleType === d.vehicleType)?.fleet ?? 0 : undefined}
                      />
                    ))}
                    <Section label="Critérios (nota 0–100%)" />
                    {criteriaRows.map(key => (
                      <Row
                        key={key}
                        label={PLANNING_CRITERIA_LABEL[key] ?? key}
                        current={criterion(baseline, key)}
                        next={criterion(s, key)}
                        fmt={v => `${Math.round(v * 100)}%`}
                      />
                    ))}
                  </tbody>
                </table>
              )}
              {s && !running && affected > 0 && (
                <div className="flex items-start gap-2 rounded-sm p-3 text-sm text-amber-800 bg-amber-500/10 dark:text-amber-300">
                  <Icons.AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {affected} {affected === 1 ? 'escala deste planejamento tem pegadas' : 'escalas deste planejamento têm pegadas'} nos carros que serão substituídos —
                    ao aplicar, essas pegadas ficam desvinculadas (desatualizadas).
                  </span>
                </div>
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
              <Button type="button" size="sm" disabled={savingSettings || running} onClick={() => void runSettings(() => callSettings(`${settingsBase}/customize`, { method: 'POST' }), 'Configuração copiada para este planejamento')}>
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
                {accepting ? 'Aplicando…' : 'Aplicar proposta'}
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

function Section({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={3} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</td>
    </tr>
  )
}

function Row({ label, current, next, fmt = (n: number) => n.toLocaleString('pt-BR'), detail }: {
  label: string; current: number | undefined; next: number | undefined; fmt?: (n: number) => string
  // a second line under each value (e.g. km)
  detail?: (string | undefined)[]
}) {
  return (
    <tr>
      <td className="py-2 text-muted-foreground">{label}</td>
      {[current, next].map((v, i) => (
        <td key={i} className="py-2 text-right font-mono tabular-nums">
          {v != null ? fmt(v) : '—'}
          {detail?.[i] && <span className="block text-xs text-muted-foreground">{detail[i]}</span>}
        </td>
      ))}
    </tr>
  )
}
