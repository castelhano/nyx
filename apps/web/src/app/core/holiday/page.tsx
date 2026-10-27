'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icons }            from '@/lib/icons'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { ImportModal }      from '@/core/ImportModal'
import { usePageGuard }     from '@/core/usePageGuard'
import { Button }           from '@/components/ui/button'
import { Select }           from '@/components/ui/select'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { useConfirm }       from '@/lib/confirm-context'
import { cn, extractError } from '@/lib/utils'
import { localToday }       from '@/lib/plan-vigence'
import { downloadCsvRows }  from '@/lib/csv'
import { WEEK, MONTHS, addDays, monthGrid } from '@/lib/calendar'

const ORIGIN  = 'apps/web/src/app/core/holiday/page'
const FORM_ID = 'holiday-form'

// Feriados on a year of month calendars — global ones and each empresa's own (municipal). The
// empresa filter shows what applies to it (global + its own), as the roster and the hour bank
// read them. Click a day or move with the arrows, Enter opens it: its holiday for editing, or a
// new one on that date.

interface Holiday {
  id:       string
  date:     string
  name:     string
  branchId: string | null
  branch:   { name: string } | null
}
interface Form { id: string | null; date: string; name: string; branchId: string }

// the list's fallback while loading — one instance, so the memos below hold
const NONE: Holiday[] = []

const dayStr  = (v: string) => v.slice(0, 10)
const fmtDay  = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const weekday = (d: string) => WEEK[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]

export default function HolidayPage() {
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { toast }   = useToast()
  const confirm     = useConfirm()
  const { guardNode, meta, canCreate, canUpdate, canDelete } = usePageGuard('core', 'holiday')

  const [year, setYear]         = useState(() => Number(localToday().slice(0, 4)))
  const [branchId, setBranchId] = useState('')
  const [cursor, setCursor]     = useState(localToday())
  const [importing, setImporting] = useState(false)

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      const json = await res.json().catch(() => ({}))
      return json.data ?? []
    },
  })

  const { data: all = NONE, isFetching } = useQuery<Holiday[]>({
    queryKey: ['core', 'holiday', 'year', year],
    queryFn:  async () => {
      const params = new URLSearchParams({ f_date_from: `${year}-01-01`, f_date_to: `${year}-12-31`, pageSize: '999', sortField: 'date', sortOrder: 'asc' })
      const res = await apiFetch(`/core/holiday?${params}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json.data ?? []
    },
    placeholderData: (prev) => prev,
  })
  // stable between renders — it's a useTopbarActions dep
  const holidays = useMemo(() => branchId ? all.filter(h => !h.branchId || h.branchId === branchId) : all, [all, branchId])
  const byDay = useMemo(() => {
    const map = new Map<string, Holiday[]>()
    for (const h of holidays) map.set(dayStr(h.date), [...(map.get(dayStr(h.date)) ?? []), h])
    return map
  }, [holidays])

  // ── form ──
  const [form, setForm]     = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const editing  = form?.id ? all.find(h => h.id === form.id) ?? null : null
  const readonly = form?.id ? !canUpdate : !canCreate
  const open = (h: Holiday) => {
    setCursor(dayStr(h.date))
    setForm({ id: h.id, date: dayStr(h.date), name: h.name, branchId: h.branchId ?? '' })
  }
  // the day's holiday (the first, when several), else a new one on it — on the filtered empresa
  function openDay(d: string) {
    setCursor(d)
    const first = byDay.get(d)?.[0]
    if (first) open(first)
    else if (canCreate) setForm({ id: null, date: d, name: '', branchId })
  }
  function moveCursor(d: string) {
    setCursor(d)
    if (Number(d.slice(0, 4)) !== year) setYear(Number(d.slice(0, 4)))
  }
  // back to the saved holiday, or drop the new one
  function reset() {
    if (editing) open(editing)
    else setForm(null)
  }

  // arrows move the cursor, Enter opens its day, Esc resets — not while a control has the focus
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (e.altKey || e.ctrlKey || e.metaKey || t.closest('input, select, textarea, [contenteditable="true"]')) return
      const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key]
      if (delta) {
        e.preventDefault()
        moveCursor(addDays(cursor, delta))
      } else if (e.key === 'Enter' && !t.closest('button, a')) {
        e.preventDefault()
        openDay(cursor)
      } else if (e.key === 'Escape') {
        reset()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, ok: string) {
    setSaving(true)
    try {
      const res  = await apiFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      toast.success(ok)
      await queryClient.invalidateQueries({ queryKey: ['core', 'holiday'] })
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
    if (form.name.trim().length < 2) { toast.error('Informe o nome do feriado'); return }
    const body = { date: form.date, name: form.name.trim(), branchId: form.branchId || null }
    const done = form.id
      ? await send(`/core/holiday/${form.id}`, 'PATCH', body, 'Feriado gravado')
      : await send('/core/holiday', 'POST', body, 'Feriado lançado')
    if (done) setForm(null)
  }

  async function handleDelete() {
    if (!editing) return
    const ok = await confirm({
      title:        'Excluir feriado',
      description:  `${fmtDay(dayStr(editing.date))} — ${editing.name}`,
      confirmLabel: 'Excluir',
      variant:      'destructive',
    })
    if (ok && await send(`/core/holiday/${editing.id}`, 'DELETE', null, 'Feriado excluído')) setForm(null)
  }

  function exportCsv() {
    downloadCsvRows(
      ['Data', 'Nome', 'Empresa'],
      holidays.map(h => [dayStr(h.date).split('-').reverse().join('/'), h.name, h.branch?.name ?? '']),
      `feriados-${year}.csv`,
    )
  }

  const canImport = !!meta?.import && canUpdate
  useTopbarActions([
    ...(canCreate ? [{ label: 'Novo', icon: Icons.Plus, onClick: () => setForm({ id: null, date: cursor, name: '', branchId }), primary: !form, keybind: 'ALT+N' }] : []),
    ...(form && !readonly ? [{ label: saving ? 'Gravar…' : 'Gravar', icon: Icons.Save, type: 'submit' as const, form: FORM_ID, primary: true, disabled: saving, keybind: 'ALT+G' }] : []),
    ...(canImport ? [{ label: 'Importar', icon: Icons.Upload, onClick: () => setImporting(true), variant: 'ghost' as const }] : []),
    ...(meta?.allowCsv ? [{ label: 'CSV', icon: Icons.Download, onClick: exportCsv, disabled: !holidays.length, variant: 'ghost' as const }] : []),
  ], [canCreate, canImport, meta?.allowCsv, form, readonly, saving, cursor, branchId, holidays])
  useShortcut('alt+n', () => { if (canCreate) setForm({ id: null, date: cursor, name: '', branchId }) }, { desc: 'Novo feriado', icon: Icons.Plus, origin: ORIGIN, context: 'all' })
  useShortcut('alt+g', () => void handleSave(), { desc: 'Gravar feriado', icon: Icons.Save, origin: ORIGIN, context: 'all' })
  useShortcut('alt+v', () => router.push('/core'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN, context: 'all' })
  useShortcut('alt+l', reset, { display: false, origin: ORIGIN })
  useShortcut('alt+d', exportCsv, { desc: 'Baixar dados em CSV', icon: Icons.Download, origin: ORIGIN })

  if (guardNode) return guardNode
  const today = localToday()

  return (
    <div className="p-6 space-y-5">
      <AutoBreadcrumb domain="core" resource="holiday" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] items-start">
        {/* ── year ── */}
        <div className="space-y-3 select-none min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setYear(y => y - 1)} className="p-1 rounded hover:bg-muted"><Icons.ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium w-14 text-center tabular-nums">{year}</span>
            <button type="button" onClick={() => setYear(y => y + 1)} className="p-1 rounded hover:bg-muted"><Icons.ChevronRight className="w-4 h-4" /></button>
            <button type="button" onClick={() => { setYear(Number(today.slice(0, 4))); setCursor(today) }} className="text-xs text-muted-foreground hover:text-foreground ml-1">hoje</button>
            <Select value={branchId} onChange={e => setBranchId(e.target.value)} size="sm" wrapperClassName="w-60 ml-2">
              <option value="">Todas as empresas</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            {isFetching && <Icons.Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-sky-500/40" />geral</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-indigo-500/40" />da empresa</span>
            </div>
          </div>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {MONTHS.map((name, mi) => {
              const month = `${year}-${String(mi + 1).padStart(2, '0')}`
              return (
                <div key={month} className="rounded-lg border border-border p-2">
                  <p className="text-xs font-medium mb-1 px-0.5">{name}</p>
                  <div className="grid grid-cols-7 gap-0.5">
                    {WEEK.map(w => <span key={w} className="text-[10px] text-muted-foreground text-center">{w[0]}</span>)}
                    {monthGrid(month).map(d => {
                      if (!d.startsWith(month)) return <span key={d} />
                      const list   = byDay.get(d) ?? []
                      const global = list.some(h => !h.branchId)
                      const own    = list.some(h => h.branchId)
                      return (
                        <button
                          key={d} type="button" tabIndex={-1}
                          onClick={() => openDay(d)}
                          title={list.map(h => h.branch ? `${h.name} (${h.branch.name})` : h.name).join('\n') || undefined}
                          className={cn(
                            'relative h-7 rounded-sm text-[11px] tabular-nums cursor-pointer hover:bg-muted',
                            global ? 'bg-sky-500/40 hover:bg-sky-500/50' : own && 'bg-indigo-500/40 hover:bg-indigo-500/50',
                            weekday(d) === 'Dom' && !list.length && 'text-muted-foreground',
                            d === today && 'font-semibold text-primary',
                            d === cursor && 'ring-1 ring-ring',
                            form?.date === d && 'ring-2 ring-ring',
                          )}
                        >
                          {Number(d.slice(8))}
                          {/* a global holiday with an empresa's on the same day */}
                          {global && own && <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-indigo-500" />}
                          {list.length > 1 && <span className="absolute bottom-0 right-0.5 text-[8px] leading-none">{list.length}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">Clique num dia ou use as setas e Enter para abrir · Esc limpa.</p>
        </div>

        {/* ── side: form, the year's list ── */}
        <div className="space-y-5">
          {form && (
            // remounts per holiday, so the name takes the focus each time one opens
            <form key={form.id ?? `new-${form.date}`} id={FORM_ID} onSubmit={handleSave} className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{form.id ? 'Feriado' : 'Novo feriado'}</h2>
                <button type="button" onClick={() => setForm(null)} className="text-muted-foreground hover:text-foreground"><Icons.X className="w-4 h-4" /></button>
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Data</span>
                <input type="date" value={form.date} disabled={readonly} onChange={e => setForm(f => f && ({ ...f, date: e.target.value }))}
                  className="h-8 w-full border border-input rounded-sm text-sm bg-input-bg px-2" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Nome</span>
                <input value={form.name} readOnly={readonly} autoFocus onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
                  className="h-8 w-full border border-input rounded-sm text-sm bg-input-bg px-2" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Empresa</span>
                <Select value={form.branchId} onChange={e => setForm(f => f && ({ ...f, branchId: e.target.value }))} size="sm" disabled={readonly}>
                  <option value="">Todas (feriado geral)</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </label>
              {editing && canDelete && (
                <div className="flex justify-end">
                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleDelete()} disabled={saving} className="text-red-600 dark:text-red-400">
                    <Icons.Trash2 className="w-3.5 h-3.5" /> Excluir
                  </Button>
                </div>
              )}
            </form>
          )}

          <section className="space-y-1">
            <h2 className="text-sm font-medium">Feriados de {year} <span className="text-muted-foreground font-normal">({holidays.length})</span></h2>
            {holidays.length === 0 && <p className="text-xs text-muted-foreground">Nenhum feriado no ano.</p>}
            {holidays.map(h => (
              <button key={h.id} type="button" onClick={() => open(h)}
                className={cn('w-full flex items-baseline gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted', form?.id === h.id && 'bg-muted')}>
                <span className="tabular-nums text-muted-foreground w-20 shrink-0">{fmtDay(dayStr(h.date))} {weekday(dayStr(h.date)).toLowerCase()}</span>
                <span className="truncate">{h.name}</span>
                <span className={cn('ml-auto text-xs shrink-0 truncate max-w-32', h.branch ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground')}>
                  {h.branch?.name ?? 'Geral'}
                </span>
              </button>
            ))}
          </section>
        </div>
      </div>

      {importing && <ImportModal domain="core" resource="holiday" onClose={() => setImporting(false)} />}
    </div>
  )
}
