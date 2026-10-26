'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { HourBankMovement, HourBankOverview, HourBankStatement, TimesheetImportSummary } from '@nyx/schemas'
import { Icons }            from '@/lib/icons'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { KeyHint }          from '@/core/FieldRenderer'
import { usePageGuard }     from '@/core/usePageGuard'
import { Select }           from '@/components/ui/select'
import { DurationInput }    from '@/components/ui/duration-input'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { Button }           from '@/components/ui/button'
import { apiFetch, uploadFile } from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { useConfirm }       from '@/lib/confirm-context'
import { cn, extractError } from '@/lib/utils'
import { localToday }       from '@/lib/plan-vigence'
import { downloadCsvRows }  from '@/lib/csv'

const ORIGIN  = 'apps/web/src/app/transit/hour-bank/page'
const FORM_ID = 'hour-bank-entry-form'
const LAST_KEY = 'nyx.hour-bank.branch'

// Banco de horas of an empresa, month by month: each crew member's position (credit / debit of
// the month, the previous month's credit expiring, the negative carried, the balance), what is
// paid (the expired credit, the extras' paid half, worked holidays) with an informative value,
// and the month's closing. The days come from the imported frequency where it has them, else
// from the roster (forecast). A row opens the crew member's statement, where the opening balance
// and adjustments are launched.

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const fmtMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7)
}
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
// minutes as ±H:MM
const hm = (m: number, signed = true) => {
  const a = Math.abs(m)
  const s = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
  return m < 0 ? `−${s}` : signed && m > 0 ? `+${s}` : s
}
const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
// what the month pays, informative: the expired credit and the extras' half at 1.5×, holidays at 2×
const valueOf = (r: { payout: number; pay: number; holiday: number; hourValue: number }) =>
  (r.payout + r.pay) / 60 * r.hourValue * 1.5 + r.holiday / 60 * r.hourValue * 2

const SOURCE_LABEL: Record<HourBankMovement['source'], string> = { FORECAST: 'previsto', IMPORT: 'frequência', MANUAL: 'manual' }
const OCCURRENCE_LABEL: Record<string, string> = { DUTY: 'Escala', HOLIDAY: 'Feriado (escala)', COMP_OFF: 'Folga compensada' }

export default function HourBankPage() {
  const router    = useRouter()
  const { toast } = useToast()
  const confirm   = useConfirm()
  const { guardNode, canCreate, canUpdate, canDelete } = usePageGuard('transit', 'hour-bank')

  const [picked, setPicked] = useState(() => { try { return localStorage.getItem(LAST_KEY) ?? '' } catch { return '' } })
  const [month, setMonth] = useState(() => shiftMonth(localToday().slice(0, 7), 0))
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<TimesheetImportSummary | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const openingRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const branchRef = useRef<HTMLSelectElement>(null)
  const [openingHelp, setOpeningHelp] = useState(false)

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      const json = await res.json().catch(() => ({}))
      return json.data ?? []
    },
  })
  // the empresa picked (or the last one used), else the first
  const branchId = branches.some(b => b.id === picked) ? picked : branches[0]?.id ?? ''
  const pickBranch = (id: string) => {
    setPicked(id); setSelected(null)
    try { localStorage.setItem(LAST_KEY, id) } catch { /* private mode */ }
  }

  const { data: bank, refetch, isFetching } = useQuery<HourBankOverview>({
    queryKey: ['transit', 'hour-bank', branchId, month],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/hour-bank?branchId=${branchId}&month=${month}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
    enabled: !!branchId,
    placeholderData: (prev) => prev,
  })
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (bank?.rows ?? []).filter(r => !q || r.code.includes(q) || r.name.toLowerCase().includes(q))
  }, [bank, search])
  const totals = useMemo(() => rows.reduce((t, r) => ({
    balance: t.balance + r.balance, payout: t.payout + r.payout, pay: t.pay + r.pay, holiday: t.holiday + r.holiday, value: t.value + valueOf(r),
  }), { balance: 0, payout: 0, pay: 0, holiday: 0, value: 0 }), [rows])

  async function post(path: string, body: unknown, ok: string) {
    setBusy(true)
    try {
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) throw new Error(extractError(await res.json().catch(() => ({}))))
      toast.success(ok)
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function closeMonth() {
    if (!bank) return
    const cover = bank.imported ? `Frequência importada de ${fmtDay(bank.imported.from)} a ${fmtDay(bank.imported.to)}` : 'Sem frequência importada — fecha pelo previsto da escala'
    if (!await confirm({ title: `Fechar ${fmtMonth(month)}?`, description: `${cover}. Os dias ficam congelados, o crédito do mês anterior não usado vai para "a pagar" e, em mês par, o negativo é zerado.`, confirmLabel: 'Fechar mês' })) return
    await post('/transit/hour-bank/close', { branchId, month }, `${fmtMonth(month)} fechado`)
  }
  async function reopenMonth() {
    if (!await confirm({ title: `Reabrir ${fmtMonth(month)}?`, description: 'Os dias voltam a ser lidos da frequência e da escala.', confirmLabel: 'Reabrir' })) return
    await post('/transit/hour-bank/reopen', { branchId, month }, `${fmtMonth(month)} reaberto`)
  }
  async function importFile(file: File) {
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('branchId', branchId)
      const res = await uploadFile('/transit/hour-bank/import', body)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      setImported(json)
      toast.success(`Frequência importada — ${json.changed} dia(s) gravado(s)`)
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // saldos iniciais: matrícula + saldo (H:MM or decimal) of the month before the start
  async function importOpening(file: File) {
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('branchId', branchId)
      const res = await uploadFile('/transit/hour-bank/opening', body)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      const r = json as { month: string; loaded: number; zeroed: number; unknown: string[] }
      toast.success(`Saldo inicial de ${fmtMonth(r.month)}: ${r.loaded} operador(es)${r.zeroed ? ` · ${r.zeroed} negativo(s) zerado(s) (mês par)` : ''}${r.unknown.length ? ` · ${r.unknown.length} matrícula(s) de fora da empresa` : ''}`)
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar')
    } finally {
      setBusy(false)
      if (openingRef.current) openingRef.current.value = ''
    }
  }

  function exportCsv() {
    downloadCsvRows(
      ['Matrícula', 'Operador', 'Jornada', 'Inicial', 'Crédito', 'Débito', 'Vencendo', 'Do mês', 'Negativo', 'Saldo', 'A pagar (vencido)', 'Pago 50%', 'Feriado', 'Valor da hora', 'Valor (R$)'],
      rows.map(r => [r.code, r.name, hm(r.journey, false), hm(r.opening), hm(r.credit), hm(r.debit), hm(r.expiring), hm(r.lot), hm(r.negative), hm(r.balance),
        hm(r.payout, false), hm(r.pay, false), hm(r.holiday, false), r.hourValue.toFixed(2).replace('.', ','), valueOf(r).toFixed(2).replace('.', ',')]),
      `banco-de-horas-${month}.csv`,
    )
  }

  const back = () => router.push('/transit')
  useTopbarActions([
    { label: 'CSV', icon: Icons.Download, onClick: exportCsv, disabled: !rows.length, variant: 'ghost' as const },
    ...(canCreate && bank?.start ? [{ label: 'Saldo inicial', icon: Icons.Upload, onClick: () => setOpeningHelp(true), disabled: busy, overflow: true }] : []),
    ...(canUpdate && bank?.start ? [{ label: 'Importar frequência', icon: Icons.Upload, onClick: () => fileRef.current?.click(), disabled: busy, variant: 'ghost' as const }] : []),
    ...(canUpdate && bank?.start && !bank.closed ? [{ label: 'Fechar mês', icon: Icons.Lock, onClick: () => void closeMonth(), disabled: busy }] : []),
    ...(canUpdate && bank?.closed && bank.lastClosed === month ? [{ label: 'Reabrir mês', icon: Icons.LockOpen, onClick: () => void reopenMonth(), disabled: busy, variant: 'ghost' as const }] : []),
  ], [canCreate, canUpdate, bank, busy, rows, month, branchId])
  useShortcut('ctrl+shift+c', () => { searchRef.current?.focus(); searchRef.current?.select() }, { desc: 'Filtrar operadores', icon: Icons.Search, origin: ORIGIN })
  useShortcut('ctrl+shift+g', () => branchRef.current?.focus(), { desc: 'Empresa', icon: Icons.Building2, origin: ORIGIN })
  useShortcut('alt+v', back, { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN, context: 'all' })
  // the statement's own alt+l also resets its launch form
  useShortcut('alt+l', () => setSearch(''), { display: false, origin: ORIGIN })

  if (guardNode) return guardNode
  const ctl = 'h-8 border border-input rounded-sm text-sm bg-input-bg px-2'

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="transit" resource="hour-bank" />
      <input ref={openingRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importOpening(f) }} />
      <input ref={fileRef} type="file" accept=".txt,.TXT,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f) }} />

      <div className="flex flex-wrap items-center gap-2">
        <Select ref={branchRef} value={branchId} onChange={e => pickBranch(e.target.value)} size="sm" wrapperClassName="w-60" keybind="g">
          {!branchId && <option value="">Empresa…</option>}
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <div className="flex items-center">
          <button type="button" onClick={() => setMonth(m => shiftMonth(m, -1))} className="p-1 rounded hover:bg-muted"><Icons.ChevronLeft className="w-4 h-4" /></button>
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className={cn(ctl, 'w-40')} />
          <button type="button" onClick={() => setMonth(m => shiftMonth(m, 1))} className="p-1 rounded hover:bg-muted"><Icons.ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="relative">
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Matrícula ou nome…" className={cn(ctl, 'w-48 md:pr-10')} />
          <KeyHint k="c" className="right-2" />
        </div>
        {bank?.start && (
          <span className={cn('text-xs rounded px-1.5 py-0.5', bank.closed ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300')}>
            {bank.closed ? 'Fechado' : 'Aberto'}
          </span>
        )}
        {bank?.start && !bank.closed && (
          <span className="text-xs text-muted-foreground">
            {bank.imported ? `Frequência de ${fmtDay(bank.imported.from)} a ${fmtDay(bank.imported.to)}, o resto previsto pela escala` : 'Previsto pela escala (sem frequência importada)'}
          </span>
        )}
        {(isFetching || busy) && <Icons.Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {openingHelp && bank?.start && (
        <OpeningModal
          month={shiftMonth(bank.start, -1)}
          onClose={() => setOpeningHelp(false)}
          onImport={() => { setOpeningHelp(false); openingRef.current?.click() }}
        />
      )}

      {bank && !bank.start && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          A empresa ainda não tem banco de horas. Defina o mês de início (mês de corte) em <a href="/transit/settings" className="underline">Configurações › Escala</a> e lance os saldos iniciais.
        </p>
      )}
      {bank?.start && month < bank.start && <p className="text-sm text-muted-foreground">O banco começa em {fmtMonth(bank.start)}.</p>}

      {imported && (
        <div className="rounded-lg border border-border p-3 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <Icons.FileText className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">Frequência de {fmtDay(imported.from)} a {fmtDay(imported.to)}</span>
            <span className="text-muted-foreground">· {imported.members} operadores · {imported.days} dias · {imported.changed} atualizados</span>
            <button type="button" onClick={() => setImported(null)} className="ml-auto text-muted-foreground hover:text-foreground"><Icons.X className="w-4 h-4" /></button>
          </div>
          {imported.unknown.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400" title={imported.unknown.join('\n')}>
              {imported.unknown.length} matrícula(s) sem operador na empresa: {imported.unknown.slice(0, 6).join(', ')}{imported.unknown.length > 6 ? '…' : ''}
            </p>
          )}
          {imported.divergences.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-5 max-h-40 overflow-y-auto">
              {imported.divergences.map(d => <li key={d}>{d}</li>)}
            </ul>
          )}
        </div>
      )}

      {bank?.start && month >= bank.start && (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_30rem] items-start">
          <div className="overflow-auto max-h-[calc(100vh-13rem)] rounded-lg border border-border">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Operador</th>
                  <th className="px-2 py-2 text-right font-medium" title="Saldo com que o mês começou — o do mês anterior, após o fechamento">Inicial</th>
                  <th className="px-2 py-2 text-right font-medium" title="Créditos do mês (50% das extras)">Crédito</th>
                  <th className="px-2 py-2 text-right font-medium" title="Horas negativas e compensações do mês">Débito</th>
                  <th className="px-2 py-2 text-right font-medium" title="Crédito do mês anterior ainda não usado — vence no fechamento deste mês">Vencendo</th>
                  <th className="px-2 py-2 text-right font-medium" title="Crédito deste mês ainda não usado — vence no fim do mês seguinte">Do mês</th>
                  <th className="px-2 py-2 text-right font-medium" title="Negativo carregado — zerado no fechamento dos meses pares">Negativo</th>
                  <th className="px-2 py-2 text-right font-medium">Saldo</th>
                  <th className="px-2 py-2 text-right font-medium" title="Crédito vencido no fechamento + 50% das extras + feriados trabalhados">A pagar</th>
                  <th className="px-2 py-2 text-right font-medium" title="Informativo: salário ÷ (semanal × 5) × 1,5 (feriado × 2)">Valor</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Nenhum operador.</td></tr>}
                {rows.map(r => (
                  <tr key={r.crewMemberId} onClick={() => setSelected(r.crewMemberId)}
                    className={cn('border-t border-border/60 hover:bg-muted/50 cursor-pointer', selected === r.crewMemberId && 'bg-accent/40')}>
                    <td className="px-2 py-1 font-sans"><span className="text-muted-foreground mr-2">{r.code}</span>{r.name}</td>
                    <td className={cn('px-2 py-1 text-right text-muted-foreground', r.opening < 0 && 'text-red-600 dark:text-red-400')}>{r.opening ? hm(r.opening) : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.credit ? hm(r.credit) : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.debit ? hm(r.debit) : '—'}</td>
                    <td className={cn('px-2 py-1 text-right', r.expiring > 0 && !bank.closed && 'text-amber-600 dark:text-amber-400')}>{r.expiring ? hm(r.expiring, false) : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.lot ? hm(r.lot, false) : '—'}</td>
                    <td className="px-2 py-1 text-right text-red-600 dark:text-red-400">{r.negative ? hm(r.negative) : ''}</td>
                    <td className={cn('px-2 py-1 text-right font-medium', r.balance < 0 && 'text-red-600 dark:text-red-400')}>{hm(r.balance)}</td>
                    <td className="px-2 py-1 text-right" title={`Vencido ${hm(r.payout, false)} · 50% das extras ${hm(r.pay, false)} · feriado ${hm(r.holiday, false)}`}>
                      {r.payout + r.pay + r.holiday ? hm(r.payout + r.pay + r.holiday, false) : '—'}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground">{r.hourValue ? money(valueOf(r)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="sticky bottom-0 bg-card text-xs shadow-[0_-1px_0_hsl(var(--border))]">
                  <tr>
                    <td className="px-2 py-1.5 font-medium" colSpan={7}>{rows.length} operadores</td>
                    <td className="px-2 py-1.5 text-right font-medium">{hm(totals.balance)}</td>
                    <td className="px-2 py-1.5 text-right">{hm(totals.payout + totals.pay + totals.holiday, false)}</td>
                    <td className="px-2 py-1.5 text-right">{money(totals.value)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {selected && (
            <Statement
              key={`${selected}|${month}`} crewMemberId={selected} month={month} closed={!!bank.closed}
              canCreate={canCreate} canDelete={canDelete}
              onClose={() => setSelected(null)} onChanged={() => void refetch()}
            />
          )}
        </div>
      )}
    </div>
  )
}

// A crew member's statement: month by month, the movements of the month shown, and the manual
// launches (saldo inicial, ajuste)
function Statement({ crewMemberId, month, closed, canCreate, canDelete, onClose, onChanged }: {
  crewMemberId: string; month: string; closed: boolean; canCreate: boolean; canDelete: boolean; onClose: () => void; onChanged: () => void
}) {
  const { toast } = useToast()
  const { data, refetch } = useQuery<HourBankStatement>({
    queryKey: ['transit', 'hour-bank', 'statement', crewMemberId, month],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/hour-bank/statement/${crewMemberId}?month=${month}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
  })
  const blank = () => ({ kind: 'ADJUST' as 'OPENING' | 'ADJUST', date: month === localToday().slice(0, 7) ? localToday() : `${month}-01`, minutes: null as number | null, negative: false, notes: '' })
  const [entry, setEntry] = useState(blank)
  const [saving, setSaving] = useState(false)

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
    if (!canCreate || saving || closed || !entry.minutes) return
    setSaving(true)
    try {
      const res = await apiFetch('/transit/hour-bank/entry', {
        method: 'POST',
        body: JSON.stringify({ crewMemberId, kind: entry.kind, date: entry.date, minutes: entry.negative ? -entry.minutes : entry.minutes, notes: entry.notes }),
      })
      if (!res.ok) throw new Error(extractError(await res.json().catch(() => ({}))))
      toast.success(entry.kind === 'OPENING' ? 'Saldo inicial lançado' : 'Ajuste lançado')
      setEntry(blank())
      await refetch(); onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao lançar')
    } finally {
      setSaving(false)
    }
  }
  async function remove(id: string) {
    const res = await apiFetch(`/transit/hour-bank/entry/${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error(extractError(await res.json().catch(() => ({})))); return }
    await refetch(); onChanged()
  }

  useShortcut('alt+g', () => void save(), { desc: 'Lançar no banco', icon: Icons.Save, origin: ORIGIN, context: 'all' })
  useShortcut('alt+l', () => setEntry(blank()), { display: false, origin: ORIGIN })

  const moves = (data?.movements ?? []).filter(m => m.date.startsWith(month))
  const ctl = 'h-8 border border-input rounded-sm text-sm bg-input-bg px-2'
  return (
    <div className="rounded-lg border border-border p-3 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{data ? `${data.member.code} ${data.member.name}` : '…'}</span>
        {data && <span className="text-xs text-muted-foreground">jornada {hm(data.member.journey, false)}</span>}
        <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground"><Icons.X className="w-4 h-4" /></button>
      </div>

      {data && (
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr><th className="text-left font-medium">Mês</th><th className="text-right font-medium">Créd.</th><th className="text-right font-medium" title="Pago à parte: os outros 50% das extras e os feriados">Pago</th><th className="text-right font-medium">Déb.</th><th className="text-right font-medium">Vencido</th><th className="text-right font-medium">Perdoado</th><th className="text-right font-medium">Saldo</th></tr>
          </thead>
          <tbody>
            {data.months.slice(-6).map(m => (
              <tr key={m.month} className={cn('border-t border-border/50', m.month === month && 'font-medium')}>
                <td className="py-0.5">{fmtMonth(m.month)}{m.closed && <Icons.Lock className="inline w-3 h-3 ml-1 text-muted-foreground" />}</td>
                <td className="text-right">{m.credit ? hm(m.credit) : '—'}</td>
                <td className="text-right text-muted-foreground">{m.pay + m.holiday ? hm(m.pay + m.holiday, false) : '—'}</td>
                <td className="text-right">{m.debit ? hm(m.debit) : '—'}</td>
                <td className="text-right">{m.payout ? hm(m.payout, false) : '—'}</td>
                <td className="text-right">{m.forgiven ? hm(m.forgiven, false) : '—'}</td>
                <td className={cn('text-right', m.balance < 0 && 'text-red-600 dark:text-red-400')}>{hm(m.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data?.compare.filter(c => c.month === month).map(c => (
        <p key={c.month} className="text-xs text-muted-foreground" title="Saldo líquido do mês: o que a escala previa × os dias como lidos (frequência onde importada)">
          {fmtMonth(c.month)}: previsto <span className="tabular-nums text-foreground">{hm(c.forecast)}</span> · realizado{' '}
          <span className="tabular-nums text-foreground">{hm(c.actual)}</span>
          {c.forecast !== c.actual && <span className={cn('tabular-nums ml-1', c.actual < c.forecast ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>({hm(c.actual - c.forecast)})</span>}
        </p>
      ))}

      <div className="space-y-0.5 max-h-80 overflow-y-auto pr-2">
        <p className="text-xs font-medium text-muted-foreground">Movimentos de {fmtMonth(month)}</p>
        {!moves.length && <p className="text-xs text-muted-foreground">Nenhum.</p>}
        {moves.map((m, i) => (
          <div key={m.id ?? `${m.date}-${i}`} className="flex items-baseline gap-2 text-xs tabular-nums">
            <span className="w-10 text-muted-foreground">{fmtDay(m.date)}</span>
            <span className="truncate flex-1" title={m.notes ?? undefined}>
              {m.kind === 'OPENING' ? 'Saldo inicial' : m.kind === 'ADJUST' ? `Ajuste${m.notes ? ` — ${m.notes}` : ''}` : OCCURRENCE_LABEL[m.occurrence ?? ''] ?? m.occurrence ?? 'Dia'}
              <span className="ml-1.5 text-[10px] text-muted-foreground">{SOURCE_LABEL[m.source]}</span>
            </span>
            {(m.payMinutes > 0 || m.holidayMinutes > 0) && (
              <span className="text-muted-foreground" title="Pago à parte">{hm(m.payMinutes + m.holidayMinutes, false)} pg</span>
            )}
            <span className={cn('w-14 text-right', m.minutes < 0 && 'text-red-600 dark:text-red-400')}>{m.minutes ? hm(m.minutes) : '—'}</span>
            {m.id && m.kind !== 'DAY' && canDelete && !closed && (
              <button type="button" onClick={() => void remove(m.id!)} className="text-muted-foreground hover:text-foreground" title="Excluir"><Icons.Trash2 className="w-3 h-3" /></button>
            )}
          </div>
        ))}
      </div>

      {canCreate && !closed && (
        <form id={FORM_ID} onSubmit={save} className="border-t border-border pt-3 space-y-2">
          <div className="flex gap-2">
            <Select value={entry.kind} onChange={e => setEntry(x => ({ ...x, kind: e.target.value as 'OPENING' | 'ADJUST' }))} size="sm" wrapperClassName="w-36">
              <option value="ADJUST">Ajuste</option>
              <option value="OPENING">Saldo inicial</option>
            </Select>
            {entry.kind === 'OPENING'
              ? <input type="month" value={entry.date.slice(0, 7)} onChange={e => e.target.value && setEntry(x => ({ ...x, date: `${e.target.value}-01` }))} className={cn(ctl, 'w-36')} title="Mês de origem do saldo (vence no fim do mês seguinte)" />
              : <input type="date" value={entry.date} onChange={e => e.target.value && setEntry(x => ({ ...x, date: e.target.value }))} className={cn(ctl, 'w-36')} />}
            <button type="button" onClick={() => setEntry(x => ({ ...x, negative: !x.negative }))}
              className={cn(ctl, 'w-8 font-medium', entry.negative ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')} title="Crédito / débito">
              {entry.negative ? '−' : '+'}
            </button>
            <DurationInput value={entry.minutes} onChange={v => setEntry(x => ({ ...x, minutes: v }))} placeholder="H:MM" className={cn(ctl, 'w-20')} />
          </div>
          <div className="flex gap-2">
            <input value={entry.notes} onChange={e => setEntry(x => ({ ...x, notes: e.target.value }))} placeholder="Observação" className={cn(ctl, 'flex-1')} />
            <button type="submit" disabled={saving || !entry.minutes} className="h-8 px-3 rounded-sm bg-primary text-primary-foreground text-sm disabled:opacity-50">Lançar</button>
          </div>
          {entry.kind === 'OPENING' && <p className="text-[11px] text-muted-foreground">O saldo inicial entra como crédito do mês de origem e vence no fim do mês seguinte.</p>}
        </form>
      )}
    </div>
  )
}

// How the opening balances file is laid out, a template to download, and the import itself
function OpeningModal({ month, onClose, onImport }: { month: string; onClose: () => void; onImport: () => void }) {
  useShortcutContext('hour_bank_opening_md')
  useShortcut('alt+g', onImport, { desc: 'Importar', icon: Icons.Upload, context: 'hour_bank_opening_md', origin: ORIGIN })
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const template = () => downloadCsvRows(['matricula', 'horas'], [['30087', '12:30'], ['30101', '-03:15']], 'modelo-saldo-inicial.csv')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 space-y-4 text-sm">
        <h2 className="text-base font-semibold">Importar saldo inicial</h2>
        <div className="space-y-1">
          <p className="font-medium">Arquivo CSV, uma linha por operador:</p>
          <pre className="rounded bg-muted px-3 py-2 text-xs">{'matricula;horas\n30087;12:30\n30101;-03:15'}</pre>
          <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
            <li>1ª coluna: matrícula (zeros à esquerda não importam).</li>
            <li>Saldo em horas (<code>12:30</code>, <code>-03:15</code>) ou decimal (<code>12,5</code>); havendo as duas, vale a de horas.</li>
            <li>Separador <code>;</code>, <code>,</code> ou tabulação — com vírgula, o decimal vai entre aspas. O cabeçalho é ignorado.</li>
            <li>{Number(month.slice(5, 7)) % 2 === 0 ? 'Mês par: saldos negativos são zerados no fechamento e não entram.' : 'Saldos negativos entram como negativo carregado.'}</li>
            <li>Reimportar substitui os saldos iniciais da empresa.</li>
          </ul>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={template}><Icons.Download className="w-4 h-4" />Modelo</Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={onImport} title="Alt+G"><Icons.Upload className="w-4 h-4" />Importar</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
