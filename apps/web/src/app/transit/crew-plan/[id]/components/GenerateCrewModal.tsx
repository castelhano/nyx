'use client'

import { useState, useEffect, useRef } from 'react'
import type { CrewPlanSummary } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import { apiFetch, getToken } from '@/lib/auth'
import { cn, extractError } from '@/lib/utils'
import { useShortcutContext } from '@/lib/keywatch'
import { fmtDuration, KIND_LABEL } from '../board.types'

// "Otimizar › Gerar escala" — parameters, then the run (SSE) with the best proposal next
// to the current plan, then "Criar versão" (a new DRAFT crew plan). See
// docs/proposal/plan_crew_solver_v1.md.

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

interface Props {
  crewPlanId:  string
  current:     CrewPlanSummary | null
  lockedCount: number
  onCreated:   (newPlanId: string) => void
  onClose:     () => void
}

const DIRECTIONS: { value: Params['direction']; label: string }[] = [
  { value: 'balanced',     label: 'Equilibrado' },
  { value: 'fewer_duties', label: 'Menos jornadas' },
  { value: 'fewer_paid',   label: 'Menos horas pagas' },
]

export function GenerateCrewModal({ crewPlanId, current, lockedCount, onCreated, onClose }: Props) {
  useShortcutContext('generate_crew_md')
  const base = `/transit/crew-plan/${crewPlanId}/solver`

  const [params, setParams]       = useState<Params>({ base: 'complete', direction: 'balanced', fareCollector: false, assistant: false })
  const [jobId, setJobId]         = useState<string | null>(null)
  const [running, setRunning]     = useState(false)
  const [proposal, setProposal]   = useState<{ index: number; summary: CrewPlanSummary } | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [saving, setSaving]       = useState(false)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') void handleClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  })
  useEffect(() => () => esRef.current?.close(), [])

  async function handleStart() {
    setError(null); setProposal(null)
    const id = crypto.randomUUID()
    const res = await apiFetch(`${base}/start`, { method: 'POST', body: JSON.stringify({ jobId: id, params }) })
    if (!res.ok) { setError(extractError(await res.json().catch(() => ({})))); return }
    setJobId(id); setRunning(true)

    const es = new EventSource(`/api${base}/stream?jobId=${id}&token=${encodeURIComponent(getToken())}`)
    esRef.current = es
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as Message
      if (msg.type === 'proposal') setProposal(msg.proposal)
      if (msg.type === 'error') setError(msg.message)
      if (msg.type === 'done' || msg.type === 'error') { es.close(); setRunning(false) }
    }
    es.onerror = () => { es.close(); setRunning(false) }
  }

  async function handleStop() {
    if (jobId) await apiFetch(`${base}/stop`, { method: 'POST', body: JSON.stringify({ jobId }) }).catch(() => null)
  }

  async function handleClose() {
    if (running) await handleStop()
    esRef.current?.close()
    onClose()
  }

  async function handleAccept() {
    if (!jobId) return
    setSaving(true)
    try {
      const res  = await apiFetch(`${base}/accept`, { method: 'POST', body: JSON.stringify({ jobId, description }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(extractError(json)); return }
      onCreated((json as { id: string }).id)
    } finally {
      setSaving(false)
    }
  }

  const started = jobId != null
  const s = proposal?.summary

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => void handleClose()} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Gerar escala</h2>
          {started && (
            <span className={cn('text-xs', running ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400')}>
              {running ? 'Gerando…' : proposal ? 'Concluído' : ''}
            </span>
          )}
        </div>

        {!started && (
          <div className="space-y-3 text-sm">
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
              A escala é montada para motorista e replicada para os papéis marcados. O resultado vira uma nova versão em rascunho — esta escala não é alterada.
            </p>
          </div>
        )}

        {started && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left pb-2 font-medium">Métrica</th>
                <th className="text-right pb-2 font-medium">Escala atual</th>
                <th className="text-right pb-2 font-medium">Proposta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              <Row label="Jornadas"        current={current?.dutyCount}        next={s?.dutyCount} />
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

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" onClick={() => void handleClose()}>{started ? 'Descartar' : 'Cancelar'}</Button>
          {!started && (
            <Button type="button" size="sm" onClick={() => void handleStart()}>
              <Icons.Play className="w-3.5 h-3.5 me-1" /> Gerar
            </Button>
          )}
          {running && (
            <Button type="button" size="sm" variant="outline" onClick={() => void handleStop()}>
              <Icons.Square className="w-3.5 h-3.5 me-1" /> Parar
            </Button>
          )}
          {s && (
            <Button type="button" size="sm" disabled={saving || running} onClick={() => void handleAccept()}>
              {saving ? 'Criando…' : 'Criar versão'}
            </Button>
          )}
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
