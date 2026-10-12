'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { VacationCheck, VacationRelease, VacationRow } from '@nyx/schemas'
import { Icons }            from '@/lib/icons'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { usePageGuard }     from '@/core/usePageGuard'
import { Select }           from '@/components/ui/select'
import { TagInput }         from '@/components/ui/tag-input'
import { Combobox }         from '@/components/ui/combobox'
import { KeyHint }          from '@/core/FieldRenderer'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { cn, extractError } from '@/lib/utils'
import { localToday }       from '@/lib/plan-vigence'
import { downloadCsvRows }  from '@/lib/csv'

const ORIGIN  = 'apps/web/src/app/transit/vacation/page'
const FORM_ID = 'vacation-form'
const LAST_KEY = 'nyx.vacation.branch'

// Férias: the empresa's launched férias over a period (with / without ferista), and the launch —
// matrículas as tags (several at once share the period and get no ferista), the period and, for a
// single crew member, his ferista. Alerts (ferista of another shift, absent) don't stop the
// launch; the server refuses what it can't take (an absence already there, a ferista covering
// someone else). Each one opens on the crew member's occurrences screen.

type Member = { id: string; code: string; displayName: string }

const addMonths = (day: string, n: number) => {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}
const fmtDay = (d: string) => d.split('-').reverse().join('/')
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// the usual férias: 30 days of gozo — the end follows the start
const GOZO_DAYS = 30
const endOf = (start: string) => addDays(start, GOZO_DAYS - 1)
const daysOf = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1
// matrícula as typed / pasted — 030087 and 30087 are the same
const bare = (code: string) => code.trim().replace(/^0+(?=\d)/, '')

export default function VacationPage() {
  const router    = useRouter()
  const { toast } = useToast()
  const { guardNode, canCreate } = usePageGuard('transit', 'vacation')

  // ── filters ──
  const [pickedBranch, setPickedBranch] = useState(() => { try { return localStorage.getItem(LAST_KEY) ?? '' } catch { return '' } })
  const [from, setFrom]   = useState(() => `${localToday().slice(0, 7)}-01`)
  const [to, setTo]       = useState(() => addMonths(localToday(), 3))
  const [cover, setCover] = useState<'' | 'with' | 'without'>('')
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const branchRef = useRef<HTMLSelectElement>(null)

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      const json = await res.json().catch(() => ({}))
      return json.data ?? []
    },
  })
  // the empresa picked (or the last one used), else the first
  const branchId = branches.some(b => b.id === pickedBranch) ? pickedBranch : branches[0]?.id ?? ''
  const pickBranch = (id: string) => {
    setPickedBranch(id)
    try { localStorage.setItem(LAST_KEY, id) } catch { /* private mode */ }
  }

  const { data: rows = [], refetch, isFetching } = useQuery<VacationRow[]>({
    queryKey: ['transit', 'vacation', branchId, from, to, cover, search],
    queryFn:  async () => {
      const params = new URLSearchParams({ branchId, from, to, ...(cover ? { cover } : {}), ...(search.trim() ? { search: search.trim() } : {}) })
      const res = await apiFetch(`/transit/vacation?${params}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
    enabled: !!branchId,
    placeholderData: (prev) => prev,
  })

  // the empresa's crew members — the tags resolve against them
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['transit', 'crew-member', 'all', branchId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/crew-member?pageSize=5000&f_branchId=${branchId}`)
      const json = await res.json().catch(() => ({}))
      return json.data ?? []
    },
    enabled: !!branchId,
  })
  const byCode = useMemo(() => new Map(members.map(m => [bare(m.code), m])), [members])

  // ── launch ──
  const blank = () => ({ codes: [] as string[], startDate: localToday(), endDate: endOf(localToday()), coverId: null as string | null, coverLabel: '', notes: '' })
  const [form, setForm] = useState(blank)
  const [coverSearch, setCoverSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const picked = form.codes.map(c => byCode.get(bare(c))).filter((m): m is Member => !!m)
  const single = form.codes.length === 1
  const valid  = picked.length === form.codes.length && picked.length > 0 && form.endDate >= form.startDate
  const body = {
    crewMemberIds: picked.map(m => m.id), startDate: form.startDate, endDate: form.endDate,
    coverCrewMemberId: single ? form.coverId : null, notes: form.notes || undefined,
  }

  const { data: check } = useQuery<VacationCheck>({
    queryKey: ['transit', 'vacation', 'check', body.crewMemberIds, body.startDate, body.endDate, body.coverCrewMemberId],
    queryFn:  async () => {
      const res = await apiFetch('/transit/vacation/check', { method: 'POST', body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
    enabled: valid,
  })

  const coverOptions = useMemo(() => {
    const q = coverSearch.trim().toLowerCase()
    if (!q) return []
    return members
      .filter(m => !picked.some(p => p.id === m.id) && (bare(m.code).startsWith(bare(q)) || m.displayName.toLowerCase().includes(q)))
      .slice(0, 20)
      .map(m => ({ id: m.id, label: m.displayName }))
  }, [coverSearch, members, picked])

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    if (!canCreate || saving || !valid || check?.blocked.length) return
    setSaving(true)
    try {
      const res  = await apiFetch('/transit/vacation', { method: 'POST', body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      const r = json as { created: number } & VacationRelease
      const released = r.released ? ` · ${r.released} escala(s) liberada(s)${r.covered ? `, ${r.covered} para o ferista` : ''}` : ''
      toast.success(`${r.created === 1 ? 'Férias lançadas' : `${r.created} férias lançadas`}${released}`)
      setForm(blank())
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao lançar')
    } finally {
      setSaving(false)
    }
  }

  function exportCsv() {
    downloadCsvRows(
      ['Matrícula', 'Operador', 'De', 'Até', 'Dias', 'Ferista', 'Situação', 'Observações'],
      rows.map(r => [r.crewMember.code, r.crewMember.name, fmtDay(r.startDate), fmtDay(r.endDate), daysOf(r.startDate, r.endDate),
        r.cover ? `${r.cover.code} ${r.cover.name}` : '', r.status === 'APPROVED' ? 'Aprovada' : 'Solicitada', r.notes ?? '']),
      `ferias-${from}-${to}.csv`,
    )
  }

  const back = () => router.push('/transit')
  useTopbarActions([
    { label: 'CSV', icon: Icons.Download, onClick: exportCsv, disabled: !rows.length, variant: 'ghost' as const },
    ...(canCreate ? [{ label: saving ? 'Lançando…' : 'Lançar', icon: Icons.Save, type: 'submit' as const, form: FORM_ID, primary: true, disabled: saving || !valid || !!check?.blocked.length, keybind: 'ALT+G' }] : []),
  ], [canCreate, saving, valid, check, rows])
  useShortcut('alt+g', () => void handleSave(), { desc: 'Lançar férias', icon: Icons.Save, origin: ORIGIN, context: 'all' })
  useShortcut('ctrl+shift+c', () => { searchRef.current?.focus(); searchRef.current?.select() }, { desc: 'Filtrar férias', icon: Icons.Search, origin: ORIGIN })
  useShortcut('ctrl+shift+g', () => branchRef.current?.focus(), { desc: 'Empresa', icon: Icons.Building2, origin: ORIGIN })
  useShortcut('alt+v', back, { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN, context: 'all' })
  useShortcut('alt+l', () => setForm(blank()), { display: false, origin: ORIGIN })

  if (guardNode) return guardNode
  const input = 'h-8 border border-input rounded-sm text-sm bg-input-bg px-2'

  return (
    <div className="p-6 space-y-5">
      <AutoBreadcrumb domain="transit" resource="vacation" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] items-start">
        {/* ── list ── */}
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Select ref={branchRef} value={branchId} onChange={e => pickBranch(e.target.value)} size="sm" wrapperClassName="w-60" keybind="g">
              {!branchId && <option value="">Empresa…</option>}
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={input} title="De" />
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className={input} title="Até" />
            <Select value={cover} onChange={e => setCover(e.target.value as typeof cover)} size="sm" wrapperClassName="w-40">
              <option value="">Com e sem ferista</option>
              <option value="with">Com ferista</option>
              <option value="without">Sem ferista</option>
            </Select>
            <div className="relative">
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Matrícula ou nome…" className={cn(input, 'w-48 md:pr-10')} />
              <KeyHint k="c" className="right-2" />
            </div>
            {isFetching && <Icons.Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <span className="ml-auto text-xs text-muted-foreground">{rows.length} férias</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Operador</th>
                  <th className="px-3 py-2 text-left font-medium">Período</th>
                  <th className="px-3 py-2 text-right font-medium">Dias</th>
                  <th className="px-3 py-2 text-left font-medium">Ferista</th>
                  <th className="px-3 py-2 text-left font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Nenhuma férias no período.</td></tr>
                )}
                {rows.map(r => {
                  const now = r.startDate <= localToday() && r.endDate >= localToday()
                  return (
                    <tr key={r.id} onClick={() => router.push(`/transit/crew-occurrence?crewMemberId=${r.crewMember.id}`)}
                      className="border-t border-border/60 hover:bg-muted/50 cursor-pointer">
                      <td className="px-3 py-1.5">
                        <span className="tabular-nums text-muted-foreground mr-2">{r.crewMember.code}</span>{r.crewMember.name}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">
                        {fmtDay(r.startDate)} a {fmtDay(r.endDate)}
                        {now && <span className="ml-2 text-[11px] text-teal-600 dark:text-teal-400">em curso</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{daysOf(r.startDate, r.endDate)}</td>
                      <td className="px-3 py-1.5">
                        {r.cover ? <><span className="tabular-nums text-muted-foreground mr-2">{r.cover.code}</span>{r.cover.name}</> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={cn('px-3 py-1.5 text-xs', r.status === 'APPROVED' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                        {r.status === 'APPROVED' ? 'Aprovada' : 'Solicitada'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── launch ── */}
        {canCreate && (
          <form id={FORM_ID} onSubmit={handleSave} className="rounded-lg border border-border p-4 space-y-3">
            <h2 className="text-sm font-medium">Lançar férias</h2>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Operadores (matrículas)</span>
              <TagInput
                value={form.codes} size="sm" allowDuplicates={false} placeholder="Matrícula + Enter (ou cole várias)"
                onChange={codes => setForm(f => ({ ...f, codes, ...(codes.length !== 1 ? { coverId: null, coverLabel: '' } : {}) }))}
                normalize={bare}
                parse={code => byCode.get(bare(code)) ?? { error: 'Matrícula não encontrada na empresa' }}
              />
              {picked.length > 0 && (
                <p className="text-[11px] text-muted-foreground truncate" title={picked.map(m => m.displayName).join('\n')}>
                  {picked.map(m => m.displayName.split(' — ')[1] ?? m.code).join(', ')}
                </p>
              )}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">De</span>
                <input type="date" value={form.startDate} className={cn(input, 'w-full')}
                  onChange={e => { const v = e.target.value; if (v) setForm(f => ({ ...f, startDate: v, endDate: endOf(v) })) }} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Até</span>
                <input type="date" value={form.endDate} min={form.startDate} className={cn(input, 'w-full')}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </label>
            </div>
            {valid && <p className="text-[11px] text-muted-foreground">{daysOf(form.startDate, form.endDate)} dias</p>}
            {single && (
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Ferista (opcional)</span>
                <div className="flex items-center gap-1">
                  <Combobox
                    value={form.coverId} displayValue={form.coverLabel} search={coverSearch} onSearchChange={setCoverSearch}
                    options={coverOptions} containerClassName="flex-1" className="h-8 text-sm"
                    onSelect={o => { setCoverSearch(''); setForm(f => ({ ...f, coverId: o?.id ?? null, coverLabel: o?.label ?? '' })) }}
                    placeholder="Matrícula ou nome…" emptyMessage={coverSearch.trim() ? 'Nenhum operador' : 'Digite para buscar'}
                  />
                  {form.coverId && (
                    <button type="button" onClick={() => setForm(f => ({ ...f, coverId: null, coverLabel: '' }))} className="text-muted-foreground hover:text-foreground" title="Sem ferista">
                      <Icons.X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <span className="block text-[11px] text-muted-foreground">No período ele assume a prioridade, a tabela e as folgas do titular.</span>
              </label>
            )}
            {form.codes.length > 1 && <p className="text-[11px] text-muted-foreground">Vários operadores: mesmo período, sem ferista.</p>}
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Observações</span>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full border border-input rounded-sm text-sm bg-input-bg px-2 py-1" />
            </label>
            {valid && check && (check.blocked.length > 0 || check.warnings.length > 0) && (
              <ul className="space-y-1 text-xs">
                {check.blocked.map(b => (
                  <li key={b} className="flex gap-1.5 text-red-600 dark:text-red-400"><Icons.Ban className="w-3.5 h-3.5 shrink-0 mt-px" />{b}</li>
                ))}
                {check.warnings.map(w => (
                  <li key={w} className="flex gap-1.5 text-amber-600 dark:text-amber-400"><Icons.AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />{w}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">As escalas já geradas do titular no período são liberadas — para o ferista quando ele estiver livre.</p>
          </form>
        )}
      </div>
    </div>
  )
}
