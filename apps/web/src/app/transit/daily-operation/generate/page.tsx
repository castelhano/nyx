'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CREW_ROLES, CREW_ROLE_LABEL, ROSTER_MAX_HORIZON_DAYS, type CrewRole, type RosterGeneratorParams, type RosterProposalSummary } from '@nyx/schemas'
import { Icons }            from '@/lib/icons'
import { Breadcrumb }       from '@/components/ui/breadcrumb'
import { Select }           from '@/components/ui/select'
import { Switch }           from '@/components/ui/switch'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch, getToken } from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { useConfirm }       from '@/lib/confirm-context'
import { cn, extractError } from '@/lib/utils'
import { localToday }       from '@/lib/plan-vigence'

const ORIGIN  = 'apps/web/src/app/transit/daily-operation/generate/page'
const FORM_ID = 'roster-generator-form'
const BASE    = '/transit/roster-generator'

// "Gerar escala" — the real roster of one empresa and role over a horizon of days. Starting
// creates the missing days, then the search runs on the server (it keeps running if the page is
// left; coming back to the same empresa/role picks it up). "Aceitar" writes the best proposal
// into the days: everything not locked is replaced. See plan_crew_rostering_impl_v2.md §5.

type StopReason = 'finished' | 'user_stopped' | 'max_time' | 'no_improvement'
type Progress = { elapsed: number; attempts: number; improvements: number; bestScore: number; sinceImprovement: number }
type Message =
  | { type: 'stage'; message: string }
  | ({ type: 'progress' } & Progress)
  | { type: 'proposal'; proposal: { index: number; summary: RosterProposalSummary } }
  | { type: 'done'; stopReason: StopReason; elapsed: number; attempts: number }
  | { type: 'error'; message: string }

const STOP_LABEL: Record<StopReason, string> = {
  finished:       'Concluído',
  user_stopped:   'Interrompido',
  max_time:       'Tempo máximo atingido',
  no_improvement: 'Sem melhora',
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const defaults = (): RosterGeneratorParams => {
  const from = addDays(localToday(), 1)
  return { branchId: '', role: 'DRIVER', from, to: addDays(from, 6), ensureMonthlyLoad: true, maxChanges: 4, restrictToBranchLines: true, vehicles: true, includePublished: false }
}

export default function RosterGeneratorPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { toast }    = useToast()
  const confirm      = useConfirm()

  // the Escala screen sends its empresa, role and period
  const [params, setParams] = useState<RosterGeneratorParams>(() => {
    const p = defaults()
    const get = (k: string) => searchParams.get(k) ?? undefined
    return { ...p, branchId: get('branchId') ?? p.branchId, role: (get('role') ?? p.role) as CrewRole, from: get('from') ?? p.from, to: get('to') ?? p.to }
  })
  const [jobId, setJobId]           = useState<string | null>(null)
  const [running, setRunning]       = useState(false)
  const [stages, setStages]         = useState<string[]>([])
  const [progress, setProgress]     = useState<Progress | null>(null)
  const [proposal, setProposal]     = useState<RosterProposalSummary | null>(null)
  const [stopReason, setStopReason] = useState<StopReason | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [accepting, setAccepting]   = useState(false)
  const esRef = useRef<EventSource | null>(null)
  useEffect(() => () => esRef.current?.close(), [])

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      if (!res.ok) throw new Error()
      const json = await res.json()
      return json.data ?? json
    },
  })

  const set = <K extends keyof RosterGeneratorParams>(k: K, v: RosterGeneratorParams[K]) => setParams(p => ({ ...p, [k]: v }))

  function clear() {
    esRef.current?.close()
    setJobId(null); setRunning(false); setStages([]); setProgress(null); setProposal(null); setStopReason(null); setError(null)
  }

  // the stream sends the job's state first, then what comes next
  function attach(id: string) {
    esRef.current?.close()
    const es = new EventSource(`/api${BASE}/stream?jobId=${id}&token=${encodeURIComponent(getToken())}`)
    esRef.current = es
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as Message
      if (msg.type === 'stage')    setStages(s => [...s, msg.message])
      if (msg.type === 'progress') setProgress(msg)
      if (msg.type === 'proposal') setProposal(msg.proposal.summary)
      if (msg.type === 'done')     setStopReason(msg.stopReason)
      if (msg.type === 'error')    setError(msg.message)
      if (msg.type === 'done' || msg.type === 'error') { es.close(); setRunning(false) }
    }
    es.onerror = () => { es.close(); setRunning(false) }
  }

  // the empresa/role's generation, running or ended and not yet used
  useEffect(() => {
    if (!params.branchId) return
    let cancelled = false
    void apiFetch(`${BASE}/current?branchId=${params.branchId}&role=${params.role}`)
      .then(r => r.json())
      .then((json: { job: { jobId: string; params: RosterGeneratorParams; running: boolean } | null }) => {
        if (cancelled) return
        clear()
        if (!json.job) return
        setParams(json.job.params)
        setJobId(json.job.jobId)
        setRunning(json.job.running)
        setStages([])
        attach(json.job.jobId)
      })
      .catch(() => null)
    return () => { cancelled = true }
  }, [params.branchId, params.role])

  async function handleStart(e?: React.FormEvent) {
    e?.preventDefault()
    if (!params.branchId || running) return
    clear()
    const id  = crypto.randomUUID()
    const res = await apiFetch(`${BASE}/start`, { method: 'POST', body: JSON.stringify({ jobId: id, params }) })
    if (!res.ok) { setError(extractError(await res.json().catch(() => ({})))); return }
    setJobId(id); setRunning(true)
    attach(id)
  }

  async function handleStop() {
    if (jobId) await apiFetch(`${BASE}/stop`, { method: 'POST', body: JSON.stringify({ jobId }) }).catch(() => null)
  }

  async function handleDiscard() {
    if (jobId) await apiFetch(`${BASE}/discard`, { method: 'POST', body: JSON.stringify({ jobId }) }).catch(() => null)
    clear()
  }

  async function handleAccept() {
    if (!jobId || !proposal) return
    const ok = await confirm({
      title:        'Aceitar a escala',
      description:  `As alocações não travadas de ${fmtDay(params.from)} a ${fmtDay(params.to)} (dias ainda planejados) são substituídas pela proposta.`,
      confirmLabel: 'Aceitar',
    })
    if (!ok) return
    setAccepting(true)
    try {
      const res  = await apiFetch(`${BASE}/accept`, { method: 'POST', body: JSON.stringify({ jobId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      toast.success(`Escala gravada: ${json.assigned} tabela(s), ${json.dayOffs} folga(s), ${json.vehicles} veículo(s)`)
      clear()
      router.push(`/transit/daily-operation?empresa=${params.branchId}&funcao=${params.role}&data=${params.from}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao aceitar')
    } finally {
      setAccepting(false)
    }
  }

  const tooLong = params.from > params.to || (Date.parse(params.to) - Date.parse(params.from)) / 86_400_000 + 1 > ROSTER_MAX_HORIZON_DAYS

  useTopbarActions([
    { label: 'Gerar', icon: Icons.Sparkles, type: 'submit', form: FORM_ID, primary: true, disabled: running || !params.branchId || tooLong, keybind: 'ALT+G' },
    ...(running ? [{ label: 'Parar', icon: Icons.Square, onClick: handleStop, variant: 'ghost' as const }] : []),
    ...(proposal && !running ? [{ label: 'Aceitar', icon: Icons.Check, onClick: handleAccept, disabled: accepting }] : []),
    ...(jobId && !running ? [{ label: 'Descartar', icon: Icons.Trash2, onClick: handleDiscard, variant: 'ghost' as const }] : []),
  ], [running, params, proposal, jobId, accepting, tooLong])
  useShortcut('alt+g', () => void handleStart(), { desc: 'Gerar escala', icon: Icons.Sparkles, origin: ORIGIN })
  useShortcut('alt+v', () => router.push('/transit/daily-operation'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN })
  useShortcut('alt+l', () => { if (!running) setParams(p => ({ ...defaults(), branchId: p.branchId, role: p.role })) }, { display: false, origin: ORIGIN })

  const inputCls = 'h-8 border border-input rounded-sm text-sm bg-input-bg px-2 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60'

  return (
    <div className="p-6 space-y-5">
      <Breadcrumb segments={[
        { label: 'Operação', href: '/transit' },
        { label: 'Escala Diária', href: '/transit/daily-operation' },
        { label: 'Gerar escala' },
      ]} />

      <form id={FORM_ID} onSubmit={handleStart} className="grid grid-cols-[11rem_1fr] items-center gap-3 max-w-3xl">
        <label className="text-sm font-medium" htmlFor="branch">Empresa</label>
        <Select id="branch" value={params.branchId} onChange={e => set('branchId', e.target.value)} size="sm" className="w-72" disabled={running} autoFocus>
          <option value="">Selecione…</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>

        <label className="text-sm font-medium" htmlFor="role">Função</label>
        <Select id="role" value={params.role} onChange={e => set('role', e.target.value as CrewRole)} size="sm" className="w-72" disabled={running}>
          {CREW_ROLES.map(r => <option key={r} value={r}>{CREW_ROLE_LABEL[r]}</option>)}
        </Select>

        <label className="text-sm font-medium">Período</label>
        <div className="flex items-center gap-2">
          <input type="date" value={params.from} onChange={e => set('from', e.target.value)} className={cn(inputCls, 'w-40')} disabled={running} />
          <span className="text-sm text-muted-foreground">até</span>
          <input type="date" value={params.to} onChange={e => set('to', e.target.value)} className={cn(inputCls, 'w-40')} disabled={running} />
          {tooLong && <span className="text-xs text-red-600 dark:text-red-400">até {ROSTER_MAX_HORIZON_DAYS} dias</span>}
        </div>

        <label className="text-sm font-medium" htmlFor="maxChanges">Máx. de Trocas</label>
        <div className="flex items-center gap-2">
          <input
            id="maxChanges" type="number" min={0} max={31} value={params.maxChanges} disabled={running}
            onChange={e => set('maxChanges', Math.max(0, Math.min(31, Math.round(Number(e.target.value) || 0))))}
            className={cn(inputCls, 'w-20 text-right')}
          />
          <span className="text-xs text-muted-foreground">trocas de tabela (linha principal ou turno) por operador no período da carga</span>
        </div>

        <ToggleRow label="Garantir Carga" checked={params.ensureMonthlyLoad} onToggle={() => set('ensureMonthlyLoad', !params.ensureMonthlyLoad)} disabled={running}
          hint="Prioriza quem está abaixo da carga do período; desligado, pesa a preferência por horas extras" />
        <ToggleRow label="Consistir Linha da Empresa" checked={params.restrictToBranchLines} onToggle={() => set('restrictToBranchLines', !params.restrictToBranchLines)} disabled={running}
          hint="Só escala tabelas cujas linhas a empresa opera" />
        <ToggleRow label="Alocar Veículos" checked={params.vehicles} onToggle={() => set('vehicles', !params.vehicles)} disabled={running}
          hint="Ao aceitar, refaz os carros dos dias gerados — preferido, habitual, depois qualquer elegível" />
      </form>

      {(jobId || error) && (
        <section className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-3 text-sm">
            {running && <Icons.Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <span className="font-medium">{running ? 'Gerando…' : stopReason ? STOP_LABEL[stopReason] : error ? 'Falhou' : ''}</span>
            {progress && (
              <span className="text-muted-foreground tabular-nums">
                {fmtClock(progress.elapsed)} · {progress.attempts.toLocaleString('pt-BR')} tentativas · {progress.improvements} melhorias
              </span>
            )}
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {stages.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5 max-h-28 overflow-y-auto">
              {stages.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          {proposal && <ProposalView summary={proposal} />}
        </section>
      )}
    </div>
  )
}

function ToggleRow({ label, hint, checked, onToggle, disabled }: { label: string; hint: string; checked: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <>
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <Switch checked={checked} onToggle={onToggle} disabled={disabled} />
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
    </>
  )
}

const th = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap'
const td = 'px-2 py-1 tabular-nums'

function ProposalView({ summary }: { summary: RosterProposalSummary }) {
  const kpis: { label: string; value: string | number; tone?: string }[] = [
    { label: 'Pontuação',    value: summary.score },
    { label: 'Tabelas',      value: summary.duties },
    { label: 'Escaladas',    value: summary.assigned },
    { label: 'Sem operador', value: summary.unassigned, tone: summary.unassigned ? 'text-red-600 dark:text-red-400' : undefined },
    { label: 'Com pendência', value: summary.warnings, tone: summary.warnings ? 'text-amber-600 dark:text-amber-400' : undefined },
    { label: 'Folgas',       value: summary.dayOffs },
  ]
  const members = [...summary.members].sort((a, b) => (a.workedMinutes - a.targetMinutes) - (b.workedMinutes - b.targetMinutes))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {kpis.map(k => (
          <div key={k.label} className="rounded-lg border border-border px-4 py-2 min-w-28">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className={cn('text-lg font-semibold tabular-nums', k.tone)}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr] items-start">
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr><th className={th}>Dia</th><th className={th}>Tabelas</th><th className={th}>Escaladas</th><th className={th}>Livres</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.days.map(d => (
                <tr key={d.date}>
                  <td className={td}>{fmtDay(d.date)}</td>
                  <td className={td}>{d.duties}</td>
                  <td className={cn(td, d.assigned < d.duties && 'text-red-600 dark:text-red-400')}>{d.assigned}</td>
                  <td className={td}>{d.free}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className={th}>Matrícula</th><th className={th}>Nome</th><th className={th}>Dias</th><th className={th}>Folgas</th>
                <th className={th}>Horas / Carga</th><th className={th}>Trocas</th><th className={th}>Preferência</th><th className={th}>Pendências</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map(m => {
                const short = m.targetMinutes > 0 && m.workedMinutes < m.targetMinutes
                return (
                  <tr key={m.crewMemberId}>
                    <td className={td}>{m.code}</td>
                    <td className="px-2 py-1">{m.name}</td>
                    <td className={td}>{m.workedDays}</td>
                    <td className={td}>{m.dayOffs}</td>
                    <td className={cn(td, short && 'text-amber-600 dark:text-amber-400')}>{hm(m.workedMinutes)} / {hm(m.targetMinutes)}</td>
                    <td className={td}>{m.changes}</td>
                    <td className={td}>{m.prefShare == null ? '—' : `${m.prefShare}%`}</td>
                    <td className={cn(td, m.warnings > 0 && 'text-amber-600 dark:text-amber-400')}>{m.warnings || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Horas e trocas contam o período da carga até o fim do horizonte (dias anteriores incluídos).</p>
    </div>
  )
}
