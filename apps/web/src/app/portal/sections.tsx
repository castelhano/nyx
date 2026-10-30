'use client'

// The crew portal's tabs: roster (week by week), requests (with the quotas), preferred lines and
// notices.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PortalChangeOptions, PortalChangeRequest, PortalLines, PortalMe, PortalNotification, PortalOccurrence, PortalQuotaBalance, PortalRosterDay } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { portalFetch } from '@/lib/portal-auth'

export const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTH = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const toMinutes = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const localToday = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
const periodLabel = (p: PortalQuotaBalance['period']) => (p === 'WEEK' ? 'nesta semana' : p === 'MONTH' ? 'neste mês' : 'neste ano')

export const field = 'w-full h-11 rounded-lg border border-input bg-input-bg px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
export const primary = 'w-full h-11 rounded-lg bg-primary text-white font-medium disabled:opacity-50 cursor-pointer'

// the native select with its own chevron, away from the edge
function PortalSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={cn(field, 'appearance-none pe-11', className)} />
      <Icons.ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

// weeks reachable from the current one, back and ahead
const WEEKS_BACK = 4
const WEEKS_AHEAD = 4

// ── roster ──────────────────────────────────────────────────────────────────

export function Roster() {
  const today = localToday()
  const monday = addDays(today, -((weekday(today) + 6) % 7))
  const [week, setWeek] = useState(0)
  const from = addDays(monday, week * 7)
  const end = addDays(from, 6)
  const { data: days, isLoading, error } = useQuery({
    queryKey: ['portal', 'roster', from],
    queryFn:  () => portalFetch<PortalRosterDay[]>(`/roster?from=${from}&to=${end}`),
  })
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setWeek(w => w - 1)} disabled={week <= -WEEKS_BACK} className="rounded-lg p-2 hover:bg-muted disabled:opacity-30 cursor-pointer"><Icons.ChevronLeft className="h-5 w-5" /></button>
        <p className="flex-1 text-center text-sm font-medium">
          {Number(from.slice(8, 10))} {MONTH[Number(from.slice(5, 7)) - 1]} – {Number(end.slice(8, 10))} {MONTH[Number(end.slice(5, 7)) - 1]}
          {week === 0 && <span className="block text-xs font-normal text-muted-foreground">esta semana</span>}
        </p>
        <button type="button" onClick={() => setWeek(w => w + 1)} disabled={week >= WEEKS_AHEAD} className="rounded-lg p-2 hover:bg-muted disabled:opacity-30 cursor-pointer"><Icons.ChevronRight className="h-5 w-5" /></button>
      </div>
      {isLoading && <div className="flex justify-center py-8"><Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {days?.map(d => <DayCard key={d.date} d={d} today={today} />)}
    </div>
  )
}

const KIND: Record<NonNullable<PortalRosterDay['kind']>, { label: string; tone: string }> = {
  DUTY:     { label: 'Trabalho',  tone: 'bg-primary/15 text-primary' },
  STANDBY:  { label: 'Plantão',   tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  DAY_OFF:  { label: 'Folga',     tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  COMP_OFF: { label: 'Folga',     tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  ABSENCE:  { label: 'Ausência',  tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
}

function DayCard({ d, today }: { d: PortalRosterDay; today: string }) {
  const isToday = d.date === today
  const k = d.kind ? KIND[d.kind] : null
  return (
    <div className={cn('flex gap-3 rounded-xl border bg-card p-3', isToday ? 'border-primary ring-1 ring-primary' : 'border-border', !d.kind && 'border-dashed bg-transparent')}>
      <div className="w-11 shrink-0 text-center">
        <p className="text-[11px] uppercase text-muted-foreground">{WEEKDAY[weekday(d.date)]}</p>
        <p className="text-xl font-semibold leading-tight tabular-nums">{d.date.slice(8, 10)}</p>
        {isToday && <p className="text-[10px] font-medium text-primary">hoje</p>}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {!d.kind && <p className="pt-2 text-sm text-muted-foreground">Escala ainda não publicada</p>}
        {k && (
          <div className="flex items-center gap-2">
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', k.tone)}>{k.label}</span>
            {d.duty && d.kind === 'DUTY' && <span className="text-sm font-semibold">Tabela {d.duty.label}</span>}
          </div>
        )}
        {d.duty?.start != null && d.duty.end != null && (
          <p className="text-lg font-semibold tabular-nums">{clock(d.duty.start)} <span className="text-muted-foreground">–</span> {clock(d.duty.end)}</p>
        )}
        {d.duty && (d.duty.lines.length > 0 || d.duty.vehicles.length > 0) && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
            {d.duty.lines.length > 0 && <span className="flex items-center gap-1"><Icons.Route className="h-3.5 w-3.5" />Linha {d.duty.lines.join(' · ')}</span>}
            {d.duty.vehicles.length > 0 && <span className="flex items-center gap-1"><Icons.Bus className="h-3.5 w-3.5" />Carro {d.duty.vehicles.join(' · ')}</span>}
          </div>
        )}
        {d.reason && <p className="text-sm">{d.reason}</p>}
        {d.window && <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><Icons.Clock className="h-3.5 w-3.5" />Restrição aprovada: {d.window}</p>}
      </div>
    </div>
  )
}

// ── requests ────────────────────────────────────────────────────────────────

const STATUS: Record<PortalOccurrence['status'], { label: string; tone: string }> = {
  REQUESTED: { label: 'Aguardando', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  APPROVED:  { label: 'Aprovado',   tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  REJECTED:  { label: 'Recusado',   tone: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  CANCELLED: { label: 'Cancelado',  tone: 'bg-muted text-muted-foreground' },
}

const CHANGE_STATUS: Record<PortalChangeRequest['status'], { label: string; tone: string }> = {
  REQUESTED: { label: 'Aguardando',        tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  QUEUED:    { label: 'Aprovado · na fila', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  FULFILLED: { label: 'Atendido',          tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  REJECTED:  { label: 'Recusado',          tone: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  CANCELLED: { label: 'Cancelado',         tone: 'bg-muted text-muted-foreground' },
}

type Kind = 'ABSENCE' | 'TIME_WINDOW' | 'SHIFT' | 'REST_GROUP'
const KIND_LABEL: Record<Kind, string> = { ABSENCE: 'Ausência', TIME_WINDOW: 'Horário', SHIFT: 'Turno', REST_GROUP: 'Folga' }
const isChange = (k: Kind): k is 'SHIFT' | 'REST_GROUP' => k === 'SHIFT' || k === 'REST_GROUP'

export function Requests({ me, onSent }: { me: PortalMe; onSent: () => void }) {
  const qc = useQueryClient()
  const today = localToday()
  const p = me.permissions
  const { data: options } = useQuery({
    queryKey: ['portal', 'change-options'],
    queryFn:  () => portalFetch<PortalChangeOptions>('/change-requests/options'),
    enabled:  p.requestShiftChange || p.requestRestGroupChange,
  })
  // no requestable absence type / no other shift / a single rest group: nothing to ask for
  const kinds = ([
    p.requestAbsence && me.absenceTypes.length > 0 && 'ABSENCE',
    p.requestTimeWindow && 'TIME_WINDOW',
    p.requestShiftChange && options && options.shifts.some(s => !s.current) && 'SHIFT',
    p.requestRestGroupChange && options?.restGroups && 'REST_GROUP',
  ] as const).filter((k): k is Kind => !!k)
  const [open, setOpen] = useState(false)
  const [picked, setKind] = useState<Kind | null>(null)
  const kind = picked && kinds.includes(picked) ? picked : kinds[0]
  const [date, setDate] = useState(addDays(today, 1))
  const [typeId, setTypeId] = useState(me.absenceTypes[0]?.id ?? '')
  const [until, setUntil] = useState('15:00')
  const [shiftId, setShiftId] = useState('')
  const [offset, setOffset] = useState<number | null>(null)
  const [notes, setNotes] = useState('')

  const { data: list = [] } = useQuery({ queryKey: ['portal', 'requests'], queryFn: () => portalFetch<PortalOccurrence[]>('/occurrences') })
  const { data: changes = [] } = useQuery({
    queryKey: ['portal', 'change-requests'],
    queryFn:  () => portalFetch<PortalChangeRequest[]>('/change-requests'),
    enabled:  p.requestShiftChange || p.requestRestGroupChange,
  })
  const pending = kind && isChange(kind) ? changes.find(c => c.kind === kind && (c.status === 'REQUESTED' || c.status === 'QUEUED')) : undefined
  const { data: quotas = [] } = useQuery({ queryKey: ['portal', 'quotas', today], queryFn: () => portalFetch<PortalQuotaBalance[]>(`/quotas?date=${today}`) })
  // the quotas of the period holding the day asked
  const { data: dayQuotas } = useQuery({
    queryKey: ['portal', 'quotas', date],
    queryFn:  () => portalFetch<PortalQuotaBalance[]>(`/quotas?date=${date}`),
    enabled:  open && !!kind && !isChange(kind) && /^\d{4}-\d{2}-\d{2}$/.test(date),
  })
  const quota = dayQuotas?.find(q => q.kind === kind && (kind === 'TIME_WINDOW' || q.absenceTypeId === typeId))
  const local = kind === 'SHIFT' ? (pending ? 'Você já tem um pedido de troca de turno em aberto' : !shiftId ? 'Escolha o turno' : null)
    : kind === 'REST_GROUP' ? (pending ? 'Você já tem um pedido de troca de grupo em aberto' : offset == null ? 'Escolha o grupo' : null)
    : date < today ? 'O pedido não pode ser para um dia que já passou'
    : quota && quota.used >= quota.max ? `Cota esgotada: ${quota.label} — ${quota.used} de ${quota.max}` : null

  const send = useMutation({
    mutationFn: (): Promise<unknown> => (kind === 'SHIFT' || kind === 'REST_GROUP'
      ? portalFetch<PortalChangeRequest>('/change-requests', {
        method: 'POST',
        body:   { ...(kind === 'SHIFT' ? { kind, shiftId } : { kind, restOffset: offset }), notes: notes.trim() || undefined },
      })
      : portalFetch<PortalOccurrence>('/occurrences', {
        method: 'POST',
        body:   kind === 'ABSENCE' ? { kind, date, absenceTypeId: typeId } : { kind, date, startNotBefore: null, endNotAfter: toMinutes(until) },
      })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portal', 'requests'] })
      void qc.invalidateQueries({ queryKey: ['portal', 'change-requests'] })
      void qc.invalidateQueries({ queryKey: ['portal', 'quotas'] })
      setOpen(false)
      setNotes('')
      onSent()
    },
  })
  // the request asked to cancel — confirmed before it goes
  const [cancelling, setCancelling] = useState<string | null>(null)
  const cancel = useMutation({
    mutationFn: (id: string) => portalFetch<PortalChangeRequest>(`/change-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess:  () => { setCancelling(null); void qc.invalidateQueries({ queryKey: ['portal', 'change-requests'] }) },
  })
  const error = local ?? send.error?.message ?? null
  if (!kind) return <p className="p-4 text-sm text-muted-foreground">Nenhum pedido disponível no seu perfil.</p>

  return (
    <div className="space-y-4 p-4">
      {quotas.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {quotas.map(q => (
            <div key={q.label} className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{q.label}</p>
              <p className="text-lg font-semibold tabular-nums">{q.used} <span className="text-sm font-normal text-muted-foreground">de {q.max}</span></p>
              <p className="text-[11px] text-muted-foreground">{periodLabel(q.period)}</p>
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <button type="button" onClick={() => { send.reset(); setOpen(true) }} className={cn(primary, 'flex items-center justify-center gap-2')}><Icons.Plus className="h-5 w-5" />Novo pedido</button>
      ) : (
        <form onSubmit={e => { e.preventDefault(); if (!local) send.mutate() }} className="space-y-3 rounded-xl border border-border bg-card p-4">
          {kinds.length > 1 && (
            <div className="grid rounded-lg border border-border p-0.5 text-sm" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}>
              {kinds.map(k => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={cn('rounded-md py-2 font-medium cursor-pointer', kind === k ? 'bg-primary text-white' : 'text-muted-foreground')}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          {!isChange(kind) && (
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Dia</span>
              <input type="date" required min={today} value={date} onChange={e => setDate(e.target.value)} className={field} />
            </label>
          )}
          {kind === 'SHIFT' && options ? (
            <>
              <p className="text-sm text-muted-foreground">Seu turno: <span className="font-medium text-foreground">{options.shifts.find(s => s.current)?.name ?? 'nenhum'}</span></p>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Quero passar para</span>
                <PortalSelect required value={shiftId} onChange={e => setShiftId(e.target.value)}>
                  <option value="">Escolha o turno</option>
                  {options.shifts.filter(s => !s.current).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </PortalSelect>
              </label>
            </>
          ) : kind === 'REST_GROUP' && options?.restGroups ? (
            <RestGroupPicker groups={options.restGroups} value={offset} onChange={setOffset} />
          ) : kind === 'ABSENCE' ? (
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Motivo</span>
              <PortalSelect required value={typeId} onChange={e => setTypeId(e.target.value)}>
                {me.absenceTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </PortalSelect>
            </label>
          ) : (
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Preciso parar até</span>
              <input type="time" required value={until} onChange={e => setUntil(e.target.value)} className={field} />
            </label>
          )}
          {isChange(kind) && (
            <>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Motivo (opcional)</span>
                <input type="text" maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} className={field} />
              </label>
              <p className="text-xs text-muted-foreground">Sem data: o pedido fica para análise e é atendido quando houver vaga.</p>
            </>
          )}
          {quota && <p className="text-xs text-muted-foreground">Cota: {quota.used} de {quota.max} {periodLabel(quota.period)}.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-11 flex-1 rounded-lg border border-border font-medium cursor-pointer">Cancelar</button>
            <button type="submit" disabled={send.isPending || !!local} className="h-11 flex-1 rounded-lg bg-primary font-medium text-white disabled:opacity-50 cursor-pointer">
              {send.isPending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </form>
      )}

      {changes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Trocas de turno e folga</p>
          {changes.map(c => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <p className="me-auto text-sm font-medium">{c.kind === 'SHIFT' ? 'Turno' : 'Folga'} · {c.change}</p>
                <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', CHANGE_STATUS[c.status].tone)}>{CHANGE_STATUS[c.status].label}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Pedido em {ddmm(c.createdAt.slice(0, 10))}{c.position != null && ` · ${c.position}º na fila`}
              </p>
              {c.reviewNotes && <p className="mt-1 text-xs text-muted-foreground">“{c.reviewNotes}”</p>}
              {(c.status === 'REQUESTED' || c.status === 'QUEUED') && (cancelling === c.id ? (
                <div className="mt-2 space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5">
                  <p className="text-xs">
                    Cancelar este pedido?{c.status === 'QUEUED' && ' Você sai da fila — se pedir de novo, volta para o fim.'}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setCancelling(null)} className="h-9 flex-1 rounded-lg border border-border text-sm font-medium cursor-pointer">Não</button>
                    <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(c.id)} className="h-9 flex-1 rounded-lg bg-destructive text-sm font-medium text-white disabled:opacity-50 cursor-pointer">
                      {cancel.isPending ? 'Cancelando…' : 'Sim, cancelar'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => { cancel.reset(); setCancelling(c.id) }} className="mt-2 text-xs font-medium text-destructive cursor-pointer">
                  Cancelar pedido
                </button>
              ))}
            </div>
          ))}
          {cancel.error && <p className="text-sm text-destructive">{cancel.error.message}</p>}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Meus pedidos</p>
        {!list.length && <p className="text-sm text-muted-foreground">Nenhum pedido ainda.</p>}
        {list.map(r => (
          <div key={r.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <p className="me-auto text-sm font-medium">
                {WEEKDAY[weekday(r.startDate)]} {ddmm(r.startDate)}{r.endDate !== r.startDate && ` a ${ddmm(r.endDate)}`} · {r.kind === 'ABSENCE' ? r.reason ?? 'Ausência' : [
                  r.startNotBefore != null && `começar a partir de ${clock(r.startNotBefore)}`,
                  r.endNotAfter != null && `parar até ${clock(r.endNotAfter)}`,
                ].filter(Boolean).join(', ')}
              </p>
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', STATUS[r.status].tone)}>{STATUS[r.status].label}</span>
            </div>
            {r.reviewNotes && <p className="mt-1 text-xs text-muted-foreground">“{r.reviewNotes}”</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

// each group of his pattern as its days off in the preview weeks — the letter alone says nothing
function RestGroupPicker({ groups, value, onChange }: { groups: NonNullable<PortalChangeOptions['restGroups']>; value: number | null; onChange: (o: number) => void }) {
  const weeks = Array.from({ length: Math.round((Date.parse(groups.to) - Date.parse(groups.from)) / 86_400_000 + 1) / 7 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(groups.from, w * 7 + d)))
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Suas folgas de {ddmm(groups.from)} a {ddmm(groups.to)} em cada grupo ({groups.patternName}). Vale a partir da próxima escala gerada — os dias já publicados não mudam.
      </p>
      {groups.options.map(g => {
        const off = new Set(g.off)
        return (
          <button key={g.offset} type="button" disabled={g.current} onClick={() => onChange(g.offset)}
            className={cn('w-full space-y-2 rounded-xl border p-3 text-left cursor-pointer disabled:cursor-default',
              value === g.offset ? 'border-primary ring-1 ring-primary' : 'border-border', g.current && 'bg-muted/40')}>
            <p className="text-sm font-semibold">{g.label}{g.current && <span className="ms-2 text-xs font-normal text-muted-foreground">seu grupo</span>}</p>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
              {[1, 2, 3, 4, 5, 6, 0].map(d => <span key={d} className="text-muted-foreground">{WEEKDAY[d]}</span>)}
              {weeks.flat().map(day => (
                <span key={day} className={cn('rounded py-1 tabular-nums', off.has(day) ? 'bg-emerald-500/20 font-semibold text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>
                  {day.slice(8, 10)}
                </span>
              ))}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── preferred lines ─────────────────────────────────────────────────────────

// first: the portal's lock (REQUIRED mode) — he picks his lines before anything else
export function Lines({ first, onSaved }: { first?: boolean; onSaved: () => void }) {
  const { data } = useQuery({ queryKey: ['portal', 'lines'], queryFn: () => portalFetch<PortalLines>('/preferred-lines') })
  if (!data) return <div className="flex justify-center py-8"><Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  // remounts on a fresh answer, so the list starts from what was saved
  return <LinesForm key={JSON.stringify(data)} all={data} first={first} onSaved={onSaved} />
}

function LinesForm({ all, first, onSaved }: { all: PortalLines; first?: boolean; onSaved: () => void }) {
  const qc = useQueryClient()
  const saved = all.lines.filter(l => l.rank != null).sort((a, b) => a.rank! - b.rank!).map(l => l.id)
  const [preferred, setPreferred] = useState(saved)
  const byId = new Map(all.lines.map(l => [l.id, l]))
  const priority = all.lines.filter(l => l.priority)
  const available = all.lines.filter(l => !preferred.includes(l.id))
  const dirty = preferred.join() !== saved.join()
  const missing = Math.max(0, all.required - preferred.length)
  const move = (i: number, d: -1 | 1) => setPreferred(p => { const n = [...p]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n })
  const save = useMutation({
    mutationFn: () => portalFetch<PortalLines>('/preferred-lines', { method: 'PUT', body: { preferred } }),
    onSuccess:  fresh => { qc.setQueryData(['portal', 'lines'], fresh); onSaved() },
  })
  return (
    <div className="space-y-5 p-4">
      {first && (
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary"><Icons.Route className="h-6 w-6" /></div>
          <p className="text-lg font-semibold">Escolha suas linhas preferidas</p>
          <p className="text-sm text-muted-foreground">Escolha {all.required} {all.required === 1 ? 'linha' : 'linhas'}, na ordem de preferência, para continuar.</p>
        </div>
      )}
      {priority.length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-medium">Definidas pela empresa</p>
          {priority.map(l => (
            <div key={l.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
              <span className="text-primary">◆</span>
              <div className="min-w-0"><p className="text-sm font-semibold">{l.code}</p><p className="truncate text-xs text-muted-foreground">{l.name}</p></div>
            </div>
          ))}
        </section>
      )}
      <section className="space-y-2">
        <p className="text-sm font-medium">
          Suas preferidas {all.editable && <span className="font-normal text-muted-foreground">— {all.required ? `escolha ${all.required}` : `até ${all.maxPreferredLines}`}, na ordem</span>}
        </p>
        {!preferred.length && <p className="text-sm text-muted-foreground">Nenhuma linha preferida.</p>}
        {preferred.map((id, i) => {
          const l = byId.get(id)
          if (!l) return null
          return (
            <div key={id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{i + 1}</span>
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{l.code}</p><p className="truncate text-xs text-muted-foreground">{l.name}</p></div>
              {all.editable && (
                <>
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 disabled:opacity-25 cursor-pointer"><Icons.ChevronUp className="h-5 w-5" /></button>
                  <button type="button" disabled={i === preferred.length - 1} onClick={() => move(i, 1)} className="p-1.5 disabled:opacity-25 cursor-pointer"><Icons.ChevronDown className="h-5 w-5" /></button>
                  <button type="button" onClick={() => setPreferred(p => p.filter(x => x !== id))} className="p-1.5 text-muted-foreground cursor-pointer"><Icons.X className="h-5 w-5" /></button>
                </>
              )}
            </div>
          )
        })}
        {all.editable && preferred.length < all.maxPreferredLines && available.length > 0 && (
          <PortalSelect value="" onChange={e => e.target.value && setPreferred(p => [...p, e.target.value])} className="text-muted-foreground">
            <option value="">+ Adicionar linha</option>
            {available.map(l => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
          </PortalSelect>
        )}
      </section>
      {all.editable && missing > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Falta{missing === 1 ? '' : 'm'} {missing} {missing === 1 ? 'linha' : 'linhas'}.</p>}
      {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      {all.editable && (
        <button type="button" disabled={(!dirty && !first) || missing > 0 || save.isPending} onClick={() => save.mutate()} className={primary}>{save.isPending ? 'Salvando…' : 'Salvar'}</button>
      )}
    </div>
  )
}

// ── notices ─────────────────────────────────────────────────────────────────

export function Notices({ list }: { list: PortalNotification[] }) {
  return (
    <div className="space-y-2 p-4">
      {!list.length && <p className="text-sm text-muted-foreground">Nenhum aviso.</p>}
      {list.map(n => (
        <div key={n.id} className={cn('rounded-xl border bg-card p-3 text-sm', n.readAt ? 'border-border' : 'border-amber-500/50')}>
          <p className="text-xs text-muted-foreground">{WEEKDAY[weekday(n.date)]} {ddmm(n.date)}{!n.readAt && <span className="ms-2 font-medium text-amber-600 dark:text-amber-400">novo</span>}</p>
          <p className="mt-0.5">{n.message}</p>
        </div>
      ))}
    </div>
  )
}
