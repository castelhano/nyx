'use client'

import { useEffect, useRef, useState } from 'react'
import type { CrewRole, RosterExtraStandby, RosterProposalSummary } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Icons } from '@/lib/icons'
import { apiFetch, getToken } from '@/lib/auth'
import { useConfirm } from '@/lib/confirm-context'
import { cn, extractError } from '@/lib/utils'
import { fmtDay } from './board'
import { QualityTable } from './QualityTable'
import { ShortageList } from './ShortageList'
import { CompensationSummary, ExtraStandbyEditor } from './ExtraStandby'

// "Gerar" inside the Escala screen: the period, empresa and role are the screen's; the run goes
// on in the server (SSE), and each better proposal is drawn over the board (the parent gets its
// allocation) until it is accepted or discarded. The days missing are created by the run.
// "Incluir dias publicados" redoes the PUBLISHED days too, changing as little as it can; who
// changes is listed, accepting asks first and each change goes to the day's log.

const BASE = '/transit/roster-generator'

type StopReason = 'finished' | 'user_stopped' | 'max_time' | 'no_improvement'
type Message =
  | { type: 'stage'; message: string }
  | { type: 'progress'; elapsed: number; attempts: number; improvements: number }
  | { type: 'proposal'; proposal: { index: number; summary: RosterProposalSummary } }
  | { type: 'done'; stopReason: StopReason }
  | { type: 'error'; message: string }

// includePublished: the run may change the PUBLISHED days too
export interface Proposal { assignments: [string, string][]; dayOffs: [string, string][]; compOffs: [string, string][]; summary: RosterProposalSummary; includePublished: boolean }

const STOP_LABEL: Record<StopReason, string> = { finished: 'Concluída', user_stopped: 'Interrompida', max_time: 'Tempo máximo', no_improvement: 'Sem melhora' }

interface Props {
  branchId:   string
  role:       CrewRole
  from:       string
  to:         string
  // the best proposal so far (null: none / discarded)
  onProposal: (p: Proposal | null) => void
  // the board must be read again (days created, proposal accepted)
  onRefresh:  () => void
  onClose:    () => void
  // a duty from the "why" list
  onSelectDuty?: (dutyId: string) => void
}

export function GeneratePanel({ branchId, role, from, to, onProposal, onRefresh, onClose, onSelectDuty }: Props) {
  const confirm = useConfirm()
  const [opts, setOpts] = useState({
    ensureMonthlyLoad: true, maxChanges: 4, restrictToBranchLines: true, vehicles: true, includePublished: false,
    extraStandby: [] as RosterExtraStandby[], compensate: false,
  })
  // the run's own — a run picked up from the server keeps what it was started with
  const runPublished = useRef(false)
  const [jobId, setJobId]       = useState<string | null>(null)
  const [running, setRunning]   = useState(false)
  const [stage, setStage]       = useState<string | null>(null)
  const [progress, setProgress] = useState<{ elapsed: number; attempts: number; improvements: number } | null>(null)
  const [summary, setSummary]   = useState<RosterProposalSummary | null>(null)
  const [end, setEnd]           = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const refreshed = useRef(false)
  useEffect(() => () => esRef.current?.close(), [])

  async function loadProposal(id: string) {
    const res = await apiFetch(`${BASE}/proposal?jobId=${id}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.proposal) onProposal({ ...json.proposal, includePublished: runPublished.current })
  }

  function attach(id: string) {
    esRef.current?.close()
    refreshed.current = false
    const es = new EventSource(`/api${BASE}/stream?jobId=${id}&token=${encodeURIComponent(getToken())}`)
    esRef.current = es
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as Message
      if (msg.type === 'stage') setStage(msg.message)
      if (msg.type === 'progress') setProgress(msg)
      if (msg.type === 'proposal') {
        setSummary(msg.proposal.summary)
        // the run created the missing days: the board needs them under the proposal
        if (!refreshed.current) { refreshed.current = true; onRefresh() }
        void loadProposal(id)
      }
      if (msg.type === 'done') setEnd(STOP_LABEL[msg.stopReason])
      if (msg.type === 'error') setError(msg.message)
      if (msg.type === 'done' || msg.type === 'error') { es.close(); setRunning(false) }
    }
    es.onerror = () => { es.close(); setRunning(false) }
  }

  // this empresa/role's run, when it is for this period
  useEffect(() => {
    let cancelled = false
    void apiFetch(`${BASE}/current?branchId=${branchId}&role=${role}`).then(r => r.json()).then(json => {
      const job = json.job as { jobId: string; running: boolean; params: { from: string; to: string; includePublished?: boolean } } | null
      if (cancelled || !job || job.params.from !== from || job.params.to !== to) return
      runPublished.current = !!job.params.includePublished
      setJobId(job.jobId); setRunning(job.running)
      attach(job.jobId)
    }).catch(() => null)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, role, from, to])

  function reset() {
    esRef.current?.close()
    setJobId(null); setRunning(false); setStage(null); setProgress(null); setSummary(null); setEnd(null); setError(null)
    onProposal(null)
  }

  async function start() {
    reset()
    const id = crypto.randomUUID()
    runPublished.current = opts.includePublished
    const res = await apiFetch(`${BASE}/start`, { method: 'POST', body: JSON.stringify({ jobId: id, params: { branchId, role, from, to, ...opts } }) })
    if (!res.ok) { setError(extractError(await res.json().catch(() => ({})))); return }
    setJobId(id); setRunning(true)
    attach(id)
  }

  async function accept() {
    if (!jobId) return
    const changed = summary?.publishedChanges ?? []
    if (changed.length && !(await confirm({
      title: 'Alterar dias publicados',
      description: `${changed.length} dia(s) de ${new Set(changed.map(c => c.crewMemberId)).size} operador(es) mudam em dias já publicados. Cada mudança fica no histórico do dia e o operador aparece como alterado após a publicação.`,
      confirmLabel: 'Aceitar',
    }))) return
    setAccepting(true)
    try {
      const res = await apiFetch(`${BASE}/accept`, { method: 'POST', body: JSON.stringify({ jobId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      reset()
      setEnd(`Gravada: ${json.assigned} tabela(s), ${json.dayOffs} folga(s)${json.compOffs ? `, ${json.compOffs} folga(s) compensada(s)` : ''}, ${json.vehicles} veículo(s)${json.changed ? ` · ${json.changed} alteração(ões) em dias publicados` : ''}`)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao aceitar')
    } finally {
      setAccepting(false)
    }
  }

  async function discard() {
    if (jobId) await apiFetch(`${BASE}/discard`, { method: 'POST', body: JSON.stringify({ jobId }) }).catch(() => null)
    reset()
  }

  const num = 'h-7 w-14 border border-input rounded-sm text-xs bg-input-bg px-1.5 text-right'
  return (
    <section className="rounded-lg border border-primary/50 p-3 space-y-3 text-sm">
      <div className="flex items-center">
        <p className="font-medium">Gerar escala · {fmtDay(from)}–{fmtDay(to)}</p>
        <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground cursor-pointer" title="Fechar (a geração continua)"><Icons.X className="w-4 h-4" /></button>
      </div>

      {!jobId && (
        <div className="space-y-2 text-xs">
          <Toggle label="Garantir carga" on={opts.ensureMonthlyLoad} set={v => setOpts(o => ({ ...o, ensureMonthlyLoad: v }))} />
          <Toggle label="Consistir linha da empresa" on={opts.restrictToBranchLines} set={v => setOpts(o => ({ ...o, restrictToBranchLines: v }))} />
          <Toggle label="Alocar veículos" on={opts.vehicles} set={v => setOpts(o => ({ ...o, vehicles: v }))} />
          <Toggle label="Incluir dias publicados" on={opts.includePublished} set={v => setOpts(o => ({ ...o, includePublished: v }))} />
          <Toggle label="Compensar banco com a sobra" on={opts.compensate} set={v => setOpts(o => ({ ...o, compensate: v }))} />
          {opts.compensate && (
            <p className="text-[11px] text-muted-foreground">
              Quem sobrar no dia recebe folga compensada — fica livre quem tem mais horas no banco (saldo do mês anterior primeiro).
              Um preferencial só cede a tabela ao próximo da lista.
            </p>
          )}
          <ExtraStandbyEditor value={opts.extraStandby} from={from} to={to} onChange={extraStandby => setOpts(o => ({ ...o, extraStandby }))} />
          <label className="flex items-center gap-2">
            <input type="number" min={0} max={31} value={opts.maxChanges} className={num}
              onChange={e => setOpts(o => ({ ...o, maxChanges: Math.max(0, Math.min(31, Math.round(Number(e.target.value) || 0))) }))} />
            máx. de trocas de tabela por operador no período da carga
          </label>
          <p className="text-muted-foreground">
            Cria os dias que faltam. Alocações travadas, {opts.includePublished ? '' : 'dias publicados, '}dias encerrados, folgas compensadas e folgas lançadas à mão ficam como estão.
            {opts.includePublished && ' Nos dias publicados muda o mínimo possível — cada mudança fica registrada.'}
          </p>
          <Button size="sm" onClick={() => void start()}><Icons.Sparkles className="w-3.5 h-3.5" />Gerar</Button>
        </div>
      )}

      {jobId && (
        <div className="space-y-2">
          <p className="text-xs flex items-center gap-1.5">
            {running && <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span className="font-medium">{running ? (summary ? 'Melhorando…' : stage ?? 'Preparando…') : end ?? (error ? 'Falhou' : '')}</span>
            {progress && <span className="text-muted-foreground tabular-nums">· {Math.round(progress.elapsed / 1000)}s · {progress.improvements} melhorias</span>}
          </p>
          {summary && (
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <Kpi label="Pontuação" value={summary.score} />
              <Kpi label="Escaladas" value={`${summary.assigned}/${summary.duties}`} warn={summary.unassigned > 0} />
              <Kpi label="Com pendência" value={summary.warnings} warn={summary.warnings > 0} />
            </div>
          )}
          {summary?.quality && <QualityTable columns={[...(summary.current ? [{ label: 'Atual', q: summary.current }] : []), { label: 'Proposta', q: summary.quality }]} />}
          {summary && summary.standby?.duties > 0 && (
            <p className={cn('text-[11px]', summary.standby.assigned < summary.standby.duties ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
              Plantões preenchidos com quem sobrou: {summary.standby.assigned}/{summary.standby.duties}
            </p>
          )}
          {summary && summary.unassigned > 0 && (
            <p className={cn('text-[11px]', summary.assigned >= summary.bound ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
              {summary.assigned >= summary.bound
                ? `Cobertura máxima com o quadro atual (${summary.bound}/${summary.duties}) — daqui em diante só a qualidade melhora.`
                : `O quadro atual permite cobrir até ${summary.bound}/${summary.duties}.`}
            </p>
          )}
          {summary?.compensation && <CompensationSummary c={summary.compensation} />}
          {summary && <ShortageList groups={summary.shortage} onSelectDuty={onSelectDuty} />}
          {summary && summary.publishedChanges?.length > 0 && <PublishedChanges list={summary.publishedChanges} />}
          {summary && <p className="text-[11px] text-muted-foreground">As células com contorno tracejado mostram o que a proposta muda.</p>}
          <div className="flex gap-1.5">
            {running && <Button size="sm" variant="outline" onClick={() => void apiFetch(`${BASE}/stop`, { method: 'POST', body: JSON.stringify({ jobId }) })}>Parar</Button>}
            {summary && <Button size="sm" variant="safeConfirm" disabled={accepting} onClick={() => void accept()}>Aceitar</Button>}
            <Button size="sm" variant="ghost" onClick={() => void discard()}>Descartar</Button>
          </div>
        </div>
      )}
      {!jobId && end && <p className="text-xs text-emerald-600 dark:text-emerald-400">{end}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  )
}

// who changes on a PUBLISHED day — grouped by crew member
function PublishedChanges({ list }: { list: RosterProposalSummary['publishedChanges'] }) {
  const byMember = new Map<string, { label: string; dates: string[] }>()
  for (const c of list) {
    const m = byMember.get(c.crewMemberId) ?? { label: `${c.code} ${c.name}`, dates: [] }
    m.dates.push(c.date)
    byMember.set(c.crewMemberId, m)
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="font-medium text-amber-600 dark:text-amber-400">{list.length} dia(s) publicado(s) mudam · {byMember.size} operador(es)</p>
      <ul className="max-h-32 overflow-y-auto space-y-0.5 text-[11px] text-muted-foreground">
        {[...byMember.values()].map(m => <li key={m.label}>{m.label} — {m.dates.map(fmtDay).join(', ')}</li>)}
      </ul>
    </div>
  )
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Switch checked={on} onToggle={() => set(!on)} />
      {label}
    </label>
  )
}

function Kpi({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="rounded-sm bg-muted/40 px-2 py-1">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums font-medium', warn && 'text-amber-600 dark:text-amber-400')}>{value}</p>
    </div>
  )
}
