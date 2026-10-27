'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CREW_OCCURRENCE_ORIGIN_LABEL, CREW_OCCURRENCE_STATUS_LABEL, PORTAL_QUOTA_PERIOD_LABEL, type PortalQuotaBalance } from '@nyx/schemas'
import { Icons }            from '@/lib/icons'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { usePageGuard }     from '@/core/usePageGuard'
import { Button }           from '@/components/ui/button'
import { Select }           from '@/components/ui/select'
import { DurationInput }    from '@/components/ui/duration-input'
import { Combobox }         from '@/components/ui/combobox'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { cn, extractError } from '@/lib/utils'
import { localToday }       from '@/lib/plan-vigence'
import { WEEK, MONTHS, addDays, monthGrid } from '@/lib/calendar'

const ORIGIN  = 'apps/web/src/app/transit/crew-occurrence/page'
const FORM_ID = 'crew-occurrence-form'

// The operator's requests ("Pedidos" — CrewOccurrence) on a month calendar with what else shapes
// his days (rest pattern days off, launched days off, holidays, duties). Select days by dragging
// or with the arrows (shift extends), Enter launches; pending requests come first with approve /
// refuse; the history below opens any of them for editing.

type Kind = 'ABSENCE' | 'TIME_WINDOW'
type Status = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

interface Occurrence {
  id: string; kind: Kind; absenceTypeId: string | null; absenceType: { name: string } | null
  startDate: string; endDate: string; startNotBefore: number | null; endNotAfter: number | null
  status: Status; origin: string; requested: Record<string, unknown> | null
  notes: string | null; reviewNotes: string | null
  // férias: the ferista
  coverCrewMemberId: string | null; cover: CrewRef | null
}
type CrewRef = { id: string; code: string; name: string }
interface Calendar {
  days: { date: string; patternOff: boolean; holiday: string | null; entry: 'DUTY' | 'STANDBY' | 'DAY_OFF' | 'COMP_OFF' | null }[]
  occurrences: Occurrence[]
  covering: { id: string; startDate: string; endDate: string; crewMember: CrewRef }[]
  absenceTypes: { id: string; name: string; systemKey: string | null }[]
}
interface Form {
  id: string | null; kind: Kind; absenceTypeId: string; startDate: string; endDate: string
  startNotBefore: number | null; endNotAfter: number | null; origin: string; notes: string
  cover: CrewRef | null
}

const dayStr = (v: string) => v.slice(0, 10)
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const fmtSpan = (o: { startDate: string; endDate: string }) =>
  dayStr(o.startDate) === dayStr(o.endDate) ? fmtDay(dayStr(o.startDate)) : `${fmtDay(dayStr(o.startDate))}–${fmtDay(dayStr(o.endDate))}`
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
const windowText = (a: number | null, b: number | null) =>
  [a != null && `após ${hm(a)}`, b != null && `até ${hm(b)}`].filter(Boolean).join(', ')

// what an occurrence says, in one line
function describe(o: Pick<Occurrence, 'kind' | 'absenceType' | 'startNotBefore' | 'endNotAfter' | 'cover'>) {
  if (o.kind !== 'ABSENCE') return `Restrição: ${windowText(o.startNotBefore, o.endNotAfter)}`
  return `${o.absenceType?.name ?? 'Ausência'}${o.cover ? ` · ferista ${o.cover.code}` : ''}`
}

const STATUS_CLS: Record<Status, string> = {
  REQUESTED: 'text-amber-600 dark:text-amber-400',
  APPROVED:  'text-emerald-600 dark:text-emerald-400',
  REJECTED:  'text-red-600 dark:text-red-400',
  CANCELLED: 'text-muted-foreground',
}

export default function CrewOccurrencesPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { toast }    = useToast()
  const crewMemberId = searchParams.get('crewMemberId') ?? ''
  const { guardNode, canCreate, canUpdate } = usePageGuard('transit', 'crew-occurrence')

  const [month, setMonth] = useState(() => localToday().slice(0, 7))
  const grid = useMemo(() => monthGrid(month), [month])
  const shiftMonth = (n: number) => {
    const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n)
    setMonth(d.toISOString().slice(0, 7))
  }

  const { data: cal, refetch } = useQuery<Calendar>({
    queryKey: ['transit', 'crew-occurrence', 'calendar', crewMemberId, grid[0], grid[grid.length - 1]],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/crew-occurrence/calendar/${crewMemberId}?from=${grid[0]}&to=${grid[grid.length - 1]}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
    enabled: !!crewMemberId,
    placeholderData: (prev) => prev,
  })
  const dayInfo = useMemo(() => new Map((cal?.days ?? []).map(d => [d.date, d])), [cal])
  const live    = (cal?.occurrences ?? []).filter(o => o.status === 'APPROVED' || o.status === 'REQUESTED')
  const onDay   = (d: string) => live.filter(o => dayStr(o.startDate) <= d && dayStr(o.endDate) >= d)
  const pending = (cal?.occurrences ?? []).filter(o => o.status === 'REQUESTED')
  const history = (cal?.occurrences ?? []).filter(o => o.status !== 'REQUESTED')

  // ── selection: `from` is the anchor, `to` follows the mouse / the arrows ──
  const [sel, setSel]           = useState<{ from: string; to: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [cursor, setCursor]     = useState(localToday())
  const span = (r: { from: string; to: string }) => (r.from < r.to ? [r.from, r.to] : [r.to, r.from]) as [string, string]
  const inSel = (d: string) => !!sel && d >= span(sel)[0] && d <= span(sel)[1]

  // ── form ──
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => (f ? { ...f, [k]: v } : f))
  const blank = (from: string, to: string): Form => ({
    id: null, kind: 'ABSENCE', absenceTypeId: '', startDate: from, endDate: to,
    startNotBefore: null, endNotAfter: null, origin: 'STAFF', notes: '', cover: null,
  })
  const open = (o: Occurrence) => setForm({
    id: o.id, kind: o.kind, absenceTypeId: o.absenceTypeId ?? '', startDate: dayStr(o.startDate), endDate: dayStr(o.endDate),
    startNotBefore: o.startNotBefore, endNotAfter: o.endNotAfter, origin: o.origin, notes: o.notes ?? '', cover: o.cover,
  })
  const editing = form?.id ? cal?.occurrences.find(o => o.id === form.id) ?? null : null
  // férias name a ferista
  const isVacation = !!form && form.kind === 'ABSENCE' && cal?.absenceTypes.find(t => t.id === form.absenceTypeId)?.systemKey === 'VACATION'
  const [coverSearch, setCoverSearch] = useState('')
  const { data: coverFound = [], isFetching: coverLoading } = useQuery({
    queryKey: ['transit', 'crew-member', 'cover-search', coverSearch.trim()],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/crew-member?${new URLSearchParams({ search: coverSearch.trim(), pageSize: '20' })}`)
      const json = await res.json().catch(() => ({}))
      return (json.data ?? []) as { id: string; code: string; displayName: string }[]
    },
    enabled: isVacation && coverSearch.trim().length > 0,
  })
  const readonly = form?.id ? !canUpdate : !canCreate

  // a request launched on his behalf counts on his portal quota — over it is allowed, with a warning
  const onBehalf = !!form && !form.id && form.origin === 'STAFF_ON_BEHALF'
  const { data: quotas } = useQuery<PortalQuotaBalance[]>({
    queryKey: ['transit', 'crew-member', 'portal-quotas', crewMemberId, form?.startDate],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/crew-member/${crewMemberId}/portal-quotas?date=${form!.startDate}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
    enabled: onBehalf && /^\d{4}-\d{2}-\d{2}$/.test(form?.startDate ?? ''),
  })
  const quota = onBehalf ? quotas?.find(q => q.kind === form!.kind && (form!.kind === 'TIME_WINDOW' || q.absenceTypeId === form!.absenceTypeId)) : undefined

  // the launch panel over the selected days (or the cursor's)
  function launch(r = sel ?? { from: cursor, to: cursor }) {
    if (!canCreate) return
    const [a, b] = span(r)
    setForm(blank(a, b))
  }
  // a selection change moves an open launch along
  function select(r: { from: string; to: string }) {
    setSel(r)
    if (form && !form.id) { const [a, b] = span(r); setForm({ ...form, startDate: a, endDate: b }) }
  }
  function endDrag() {
    if (!dragging) return
    setDragging(false)
    if (sel) launch(sel)
  }
  // back to the saved request, or drop the launch — and the selection
  function reset() {
    setSel(null)
    if (editing) open(editing)
    else setForm(null)
  }

  // arrows move the cursor (shift extends the selection), Enter launches, Esc resets — not while
  // a control has the focus
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (e.altKey || e.ctrlKey || e.metaKey || t.closest('input, select, textarea, [contenteditable="true"]')) return
      const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key]
      if (delta) {
        e.preventDefault()
        const next = addDays(cursor, delta)
        setCursor(next)
        if (!next.startsWith(month)) setMonth(next.slice(0, 7))
        select(e.shiftKey ? { from: sel?.from ?? cursor, to: next } : { from: next, to: next })
      } else if (e.key === 'Enter' && !t.closest('button, a')) {
        e.preventDefault()
        launch()
      } else if (e.key === 'Escape') {
        reset()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  async function send(path: string, method: 'POST' | 'PATCH', body: unknown, ok: string) {
    setSaving(true)
    try {
      const res  = await apiFetch(path, { method, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      toast.success(ok)
      await refetch()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gravar')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    if (!form || saving || readonly) return
    const body = {
      kind: form.kind, startDate: form.startDate, endDate: form.endDate, notes: form.notes,
      absenceTypeId: form.kind === 'ABSENCE' ? form.absenceTypeId || null : null,
      coverCrewMemberId: isVacation ? form.cover?.id ?? null : null,
      startNotBefore: form.kind === 'TIME_WINDOW' ? form.startNotBefore : null,
      endNotAfter:    form.kind === 'TIME_WINDOW' ? form.endNotAfter : null,
    }
    const done = form.id
      ? await send(`/transit/crew-occurrence/${form.id}`, 'PATCH', body, 'Pedido gravado')
      : await send('/transit/crew-occurrence', 'POST', {
          ...body, crewMemberId, origin: form.origin, status: form.origin === 'STAFF_ON_BEHALF' ? 'REQUESTED' : 'APPROVED',
        }, 'Pedido lançado')
    if (done) { setForm(null); setSel(null) }
  }

  const review = (o: Occurrence, status: Status, reviewNotes?: string) =>
    send(`/transit/crew-occurrence/${o.id}`, 'PATCH', { status, ...(reviewNotes !== undefined ? { reviewNotes } : {}) },
      status === 'APPROVED' ? 'Pedido aprovado' : status === 'REJECTED' ? 'Pedido recusado' : 'Pedido cancelado')

  const back = () => router.push(`/transit/crew-member/${crewMemberId}`)
  useTopbarActions([
    ...(canCreate ? [{ label: 'Lançar', icon: Icons.Plus, onClick: () => launch(), primary: !form, keybind: 'ALT+N' }] : []),
    ...(form && !readonly ? [{ label: saving ? 'Gravar…' : 'Gravar', icon: Icons.Save, type: 'submit' as const, form: FORM_ID, primary: true, disabled: saving, keybind: 'ALT+G' }] : []),
  ], [canCreate, form, readonly, saving, sel, cursor])
  useShortcut('alt+n', () => launch(), { desc: 'Lançar pedido', icon: Icons.Plus, origin: ORIGIN, context: 'all' })
  useShortcut('alt+g', () => void handleSave(), { desc: 'Gravar pedido', icon: Icons.Save, origin: ORIGIN, context: 'all' })
  useShortcut('alt+v', back, { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN, context: 'all' })
  useShortcut('alt+l', reset, { display: false, origin: ORIGIN })

  if (guardNode) return guardNode
  const [y, m] = month.split('-').map(Number)

  return (
    <div className="p-6 space-y-5" onMouseUp={endDrag} onMouseLeave={() => setDragging(false)}>
      <AutoBreadcrumb domain="transit" resource="crew-occurrence" contextParams={{ crewMemberId }} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] items-start">
        {/* ── calendar ── */}
        <div className="space-y-2 select-none">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => shiftMonth(-1)} className="p-1 rounded hover:bg-muted"><Icons.ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium w-36 text-center">{MONTHS[m - 1]} {y}</span>
            <button type="button" onClick={() => shiftMonth(1)} className="p-1 rounded hover:bg-muted"><Icons.ChevronRight className="w-4 h-4" /></button>
            <button type="button" onClick={() => setMonth(localToday().slice(0, 7))} className="text-xs text-muted-foreground hover:text-foreground ml-1">hoje</button>
            <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-500/40" />folga</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-violet-500/50" />ausência</span>
              <span className="flex items-center gap-1"><Icons.Clock className="w-3 h-3" />restrição</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-dashed border-amber-500" />solicitada</span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEK.map(w => <span key={w} className="text-xs text-muted-foreground text-center">{w}</span>)}
            {grid.map(d => {
              const info = dayInfo.get(d)
              const occ = onDay(d)
              const off = info?.patternOff || info?.entry === 'DAY_OFF' || info?.entry === 'COMP_OFF'
              const outside = !d.startsWith(month)
              return (
                <div
                  key={d}
                  onMouseDown={() => { if (!canCreate) return; setDragging(true); setCursor(d); select({ from: d, to: d }) }}
                  onMouseEnter={() => { if (dragging && sel) { setCursor(d); select({ from: sel.from, to: d }) } }}
                  className={cn(
                    'min-h-20 rounded-sm border p-1 space-y-0.5 text-xs cursor-pointer',
                    outside ? 'border-transparent opacity-40' : 'border-border',
                    off && 'bg-amber-500/15',
                    inSel(d) && 'ring-2 ring-ring bg-accent/30',
                    d === localToday() && 'border-primary',
                    d === cursor && !inSel(d) && 'ring-1 ring-ring/60',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn('tabular-nums', d === localToday() && 'font-semibold text-primary')}>{Number(d.slice(8))}</span>
                    {off && <span className="text-[10px] text-amber-700 dark:text-amber-300">{info?.entry === 'COMP_OFF' ? 'FC' : 'F'}</span>}
                    {info?.entry === 'DUTY' && <span className="text-[10px] text-muted-foreground">escalado</span>}
                  </div>
                  {info?.holiday && <p className="truncate text-[10px] text-sky-600 dark:text-sky-400" title={info.holiday}>{info.holiday}</p>}
                  {occ.map(o => (
                    <button
                      key={o.id} type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => open(o)}
                      title={`${describe(o)} · ${CREW_OCCURRENCE_STATUS_LABEL[o.status]}`}
                      className={cn(
                        'w-full truncate rounded-sm px-1 text-left text-[11px]',
                        o.kind === 'ABSENCE' ? 'bg-violet-500/30' : 'bg-muted',
                        o.status === 'REQUESTED' && 'border border-dashed border-amber-500 bg-transparent',
                        form?.id === o.id && 'ring-1 ring-primary',
                      )}
                    >
                      {o.kind === 'TIME_WINDOW' && <Icons.Clock className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                      {o.kind === 'ABSENCE' ? o.absenceType?.name : windowText(o.startNotBefore, o.endNotAfter)}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
          {canCreate && <p className="text-xs text-muted-foreground">Arraste sobre os dias ou use as setas (shift seleciona vários) e Enter para lançar · Esc limpa.</p>}
        </div>

        {/* ── side: form, pending, history ── */}
        <div className="space-y-5">
          {form && cal && (
            // remounts per request, so the start date takes the focus each time one opens
            <form key={form.id ?? 'new'} id={FORM_ID} onSubmit={handleSave} className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{form.id ? 'Pedido' : 'Lançar'}</h2>
                <button type="button" onClick={() => { setForm(null); setSel(null) }} className="text-muted-foreground hover:text-foreground"><Icons.X className="w-4 h-4" /></button>
              </div>
              <div className="flex rounded-sm border border-border overflow-hidden text-sm">
                {(['ABSENCE', 'TIME_WINDOW'] as const).map(k => (
                  <button
                    key={k} type="button" disabled={readonly} onClick={() => set('kind', k)}
                    className={cn('flex-1 h-8 cursor-pointer', form.kind === k ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}
                  >
                    {k === 'ABSENCE' ? 'Ausência' : 'Restrição de horário'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">De</span>
                  <input type="date" value={form.startDate} disabled={readonly} autoFocus
                    onChange={e => { set('startDate', e.target.value); if (e.target.value > form.endDate) set('endDate', e.target.value) }}
                    className="h-8 w-full border border-input rounded-sm text-sm bg-input-bg px-2" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Até</span>
                  <input type="date" value={form.endDate} min={form.startDate} disabled={readonly} onChange={e => set('endDate', e.target.value)}
                    className="h-8 w-full border border-input rounded-sm text-sm bg-input-bg px-2" />
                </label>
              </div>
              {form.kind === 'ABSENCE' ? (
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Motivo</span>
                  <Select value={form.absenceTypeId} onChange={e => set('absenceTypeId', e.target.value)} size="sm" disabled={readonly}>
                    <option value="">Selecione…</option>
                    {cal.absenceTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </label>
              ) : null}
              {isVacation && (
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Ferista (opcional)</span>
                  <div className="flex items-center gap-1">
                    <Combobox
                      value={form.cover?.id ?? null} displayValue={form.cover ? `${form.cover.code} — ${form.cover.name}` : ''}
                      search={coverSearch} onSearchChange={setCoverSearch} isLoading={coverLoading} disabled={readonly}
                      options={coverFound.filter(m => m.id !== crewMemberId).map(m => ({ id: m.id, label: m.displayName, raw: m }))}
                      onSelect={o => {
                        setCoverSearch('')
                        const m = o?.raw as { id: string; code: string; displayName: string } | undefined
                        set('cover', m ? { id: m.id, code: m.code, name: m.displayName.split(' — ')[1] ?? m.code } : null)
                      }}
                      containerClassName="flex-1" className="h-8 text-sm" placeholder="Matrícula ou nome…"
                      emptyMessage={coverSearch.trim() ? 'Nenhum operador' : 'Digite para buscar'}
                    />
                    {form.cover && !readonly && (
                      <button type="button" onClick={() => set('cover', null)} className="text-muted-foreground hover:text-foreground" title="Sem ferista"><Icons.X className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </label>
              )}
              {form.kind === 'TIME_WINDOW' && (
                <div className="grid grid-cols-2 gap-2">
                  {([['startNotBefore', 'Não inicia antes de'], ['endNotAfter', 'Não termina depois de']] as const).map(([k, label]) => (
                    <label key={k} className="space-y-1">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <div className="flex items-center gap-1">
                        <DurationInput value={form[k]} onChange={v => set(k, v)} max={2880} readOnly={readonly} placeholder="H:MM"
                          className="h-8 w-full border border-input rounded-sm text-sm bg-input-bg px-2" />
                        {form[k] != null && !readonly && (
                          <button type="button" onClick={() => set(k, null)} className="text-muted-foreground hover:text-foreground"><Icons.X className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {!form.id && (
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Status</span>
                  {/* Aprovado = launched by the company; Solicitado = the operator's request, launched for him */}
                  <Select value={form.origin} onChange={e => set('origin', e.target.value)} size="sm">
                    <option value="STAFF">Aprovado</option>
                    <option value="STAFF_ON_BEHALF">Solicitado</option>
                  </Select>
                </label>
              )}
              {quota && (
                <p className={cn('text-xs', quota.used >= quota.max ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                  {quota.used >= quota.max && <Icons.AlertTriangle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}
                  Cota do portal — {quota.label}: {quota.used} de {quota.max} na {PORTAL_QUOTA_PERIOD_LABEL[quota.period].toLowerCase()} ({fmtDay(quota.from)}–{fmtDay(quota.to)})
                  {quota.used >= quota.max && '. Este pedido passa da cota.'}
                </p>
              )}
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Observações</span>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} readOnly={readonly}
                  className="w-full border border-input rounded-sm text-sm bg-input-bg px-2 py-1" />
              </label>
              {editing && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={STATUS_CLS[editing.status]}>{CREW_OCCURRENCE_STATUS_LABEL[editing.status]}</span>
                  <span className="text-muted-foreground">· {CREW_OCCURRENCE_ORIGIN_LABEL[editing.origin]}</span>
                  {canUpdate && editing.status !== 'CANCELLED' && (
                    <button type="button" onClick={() => void review(editing, 'CANCELLED').then(ok => ok && setForm(null))} className="ml-auto text-red-600 dark:text-red-400 hover:underline">
                      Cancelar pedido
                    </button>
                  )}
                </div>
              )}
            </form>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Pendentes {pending.length > 0 && <span className="text-amber-600 dark:text-amber-400">({pending.length})</span>}</h2>
            {pending.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma solicitação pendente.</p>}
            {pending.map(o => <PendingRow key={o.id} o={o} canUpdate={canUpdate} onOpen={() => open(o)} onReview={review} />)}
          </section>

          {(cal?.covering ?? []).length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-medium">Ferista de</h2>
              {cal!.covering.map(c => (
                <button key={c.id} type="button" onClick={() => router.push(`/transit/crew-occurrence?crewMemberId=${c.crewMember.id}`)}
                  className="w-full flex items-baseline gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted">
                  <span className="tabular-nums text-muted-foreground w-24 shrink-0">{fmtSpan(c)}</span>
                  <span className="truncate">Férias de {c.crewMember.code} {c.crewMember.name}</span>
                </button>
              ))}
            </section>
          )}

          <section className="space-y-1">
            <h2 className="text-sm font-medium">Histórico</h2>
            {history.length === 0 && <p className="text-xs text-muted-foreground">Nenhum pedido.</p>}
            {history.map(o => (
              <button key={o.id} type="button" onClick={() => open(o)}
                className={cn('w-full flex items-baseline gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted', form?.id === o.id && 'bg-muted')}>
                <span className="tabular-nums text-muted-foreground w-24 shrink-0">{fmtSpan(o)}</span>
                <span className={cn('truncate', o.status === 'CANCELLED' && 'line-through text-muted-foreground')}>{describe(o)}</span>
                <span className={cn('ml-auto text-xs shrink-0', STATUS_CLS[o.status])}>{CREW_OCCURRENCE_STATUS_LABEL[o.status]}</span>
              </button>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}

// a request waiting for review: what was asked (when it was adjusted), approve / refuse with an answer
function PendingRow({ o, canUpdate, onOpen, onReview }: {
  o: Occurrence; canUpdate: boolean; onOpen: () => void; onReview: (o: Occurrence, status: Status, reviewNotes?: string) => Promise<boolean>
}) {
  const [refusing, setRefusing] = useState(false)
  const [answer, setAnswer] = useState('')
  const asked = o.requested
  const askedText = asked && o.kind === 'TIME_WINDOW' ? windowText((asked.startNotBefore as number | null) ?? null, (asked.endNotAfter as number | null) ?? null) : null
  const adjusted = askedText != null && askedText !== windowText(o.startNotBefore, o.endNotAfter)
  return (
    <div className="rounded-lg border border-amber-500/40 p-2 space-y-1.5 text-sm">
      <button type="button" onClick={onOpen} className="w-full flex items-baseline gap-2 text-left">
        <span className="tabular-nums text-muted-foreground">{fmtSpan(o)}</span>
        <span className="truncate">{describe(o)}</span>
        <span className="ml-auto text-xs text-muted-foreground shrink-0">{o.origin === 'PORTAL' ? 'Portal' : 'Lançado'}</span>
      </button>
      {adjusted && <p className="text-xs text-muted-foreground">pedido: {askedText} → {windowText(o.startNotBefore, o.endNotAfter)}</p>}
      {o.notes && <p className="text-xs text-muted-foreground">{o.notes}</p>}
      {canUpdate && (refusing ? (
        <div className="flex gap-1.5">
          <input
            value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Resposta ao operador" autoFocus
            onKeyDown={e => {
              // Enter refuses, Esc goes back — kept away from the page's keys
              if (e.key === 'Enter') { e.preventDefault(); if (answer.trim()) void onReview(o, 'REJECTED', answer) }
              if (e.key === 'Escape') { e.stopPropagation(); setRefusing(false) }
            }}
            className="h-8 flex-1 border border-input rounded-sm text-xs bg-input-bg px-2"
          />
          <Button type="button" size="sm" variant="destructive" onClick={() => void onReview(o, 'REJECTED', answer)} disabled={!answer.trim()}>Recusar</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRefusing(false)}>Voltar</Button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="safeConfirm" onClick={() => void onReview(o, 'APPROVED')}>Aprovar</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setRefusing(true)}>Recusar</Button>
        </div>
      ))}
    </div>
  )
}
