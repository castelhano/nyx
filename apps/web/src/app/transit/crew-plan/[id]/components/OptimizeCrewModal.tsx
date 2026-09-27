'use client'

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
//            DRAFT crew plan). A new run replaces it. See docs/proposal/plan_crew_solver_v1.md.

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
}

type Message =
  | { type: 'progress'; elapsed: number; attempts: number; bestScore: number }
  | { type: 'proposal'; proposal: { index: number; summary: CrewPlanSummary } }
  | { type: 'done'; stopReason: string; elapsed: number }
  | { type: 'error'; message: string }

const DIRECTIONS: { value: Params['direction']; label: string }[] = [
  { value: 'balanced',     label: 'Equilibrado' },
  { value: 'fewer_duties', label: 'Menor quadro' },
  { value: 'fewer_paid',   label: 'Menor jornada' },
]

interface Props {
  crewPlanId:      string
  initialTab:      OptimizeTab
  current:         CrewPlanSummary | null
  lockedCount:     number
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

export function OptimizeCrewModal({ crewPlanId, initialTab, current, lockedCount, onSettingsSaved, onCreated, onClose }: Props) {
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
  const [params, setParams]           = useState<Params>({ base: 'complete', direction: 'balanced', fareCollector: false, assistant: false })
  const [jobId, setJobId]             = useState<string | null>(null)
  const [running, setRunning]         = useState(false)
  const [proposal, setProposal]       = useState<{ index: number; summary: CrewPlanSummary } | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [accepting, setAccepting]     = useState(false)
  const esRef = useRef<EventSource | null>(null)
  useEffect(() => () => esRef.current?.close(), [])

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

  async function handleClose() {
    if (tab === 'config' && !(await leaveConfigAllowed())) return
    if (running && jobId) await handleStop()
    esRef.current?.close()
    onClose()
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

  // a new run replaces the previous scenario
  async function handleStart() {
    esRef.current?.close()
    setError(null); setProposal(null); setDescription(''); setJobId(null)
    setTab('scenarios')
    const id  = crypto.randomUUID()
    const res = await apiFetch(`${solverBase}/start`, { method: 'POST', body: JSON.stringify({ jobId: id, params }) })
    if (!res.ok) { setError(extractError(await res.json().catch(() => ({})))); return }
    setJobId(id); setRunning(true)

    const es = new EventSource(`/api${solverBase}/stream?jobId=${id}&token=${encodeURIComponent(getToken())}`)
    esRef.current = es
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as Message
      if (msg.type === 'proposal') setProposal(msg.proposal)
      if (msg.type === 'error') setError(msg.message)
      if (msg.type === 'done' || msg.type === 'error') { es.close(); setRunning(false) }
    }
    es.onerror = () => { es.close(); setRunning(false) }
  }

  async function handleAccept() {
    if (!jobId) return
    setAccepting(true)
    try {
      const res  = await apiFetch(`${solverBase}/accept`, { method: 'POST', body: JSON.stringify({ jobId, description }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(extractError(json)); return }
      onCreated((json as { id: string }).id)
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
                {running ? 'Gerando…' : proposal ? 'Concluído' : ''}
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
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={params.base === 'complete'} onChange={() => setParams(p => ({ ...p, base: 'complete' }))} />
                  Completar — mantém as jornadas travadas ({lockedCount}) e cobre o restante
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={params.base === 'scratch'} onChange={() => setParams(p => ({ ...p, base: 'scratch' }))} />
                  Do zero — só os carros
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
              <p className="text-xs text-muted-foreground">
                A escala é montada para motorista e replicada para os papéis marcados, com as regras da aba Config. O resultado vira uma nova versão em rascunho — esta escala não é alterada.
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
                  </tbody>
                </table>
              )}
              {s && (
                <p className="text-xs text-muted-foreground">
                  {(Object.entries(s.byKind) as [keyof typeof KIND_LABEL, number][]).map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(' · ')}
                </p>
              )}
              {s && !running && (
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

            {tab === 'scenarios' && running && (
              <Button type="button" size="sm" variant="outline" onClick={() => void handleStop()}>
                <Icons.Square className="w-3.5 h-3.5 me-1" /> Parar
              </Button>
            )}
            {tab === 'scenarios' && s && (
              <Button type="button" size="sm" disabled={accepting || running} onClick={() => void handleAccept()}>
                {accepting ? 'Criando…' : 'Criar versão'}
              </Button>
            )}
          </div>
        </div>
      </div>
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
