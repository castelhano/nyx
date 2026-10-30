'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CREW_ROLES, CREW_ROLE_LABEL, type CrewRole, type RosterShortage } from '@nyx/schemas'
import { Icons }            from '@/lib/icons'
import { Breadcrumb }       from '@/components/ui/breadcrumb'
import { Select }           from '@/components/ui/select'
import { usePageGuard }     from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { Button } from '@/components/ui/button'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { useConfirm }       from '@/lib/confirm-context'
import { cn, extractError } from '@/lib/utils'
import { localToday }       from '@/lib/plan-vigence'
import {
  ISSUE_LABEL, WEEKDAY, call, cellSummary, dutyName, fmtDay, freeCells, indexBoard, periodOf, requestImpact, shiftPeriod, weekday,
  withAssign, withDayOff, withLock, withSwap,
  type Mode, type RosterBoard, type RosterBoardDuty, type View,
} from './workspace/board'
import { OperatorsGrid, type GridPos, type Overlay } from './workspace/OperatorsGrid'
import { GeneratePanel, type Proposal } from './workspace/GeneratePanel'
import { RemakePeriodModal } from './workspace/RemakePeriodModal'
import { QualityTable } from './workspace/QualityTable'
import { PeriodPicker } from './workspace/PeriodPicker'
import { KeyHint } from '@/core/FieldRenderer'
import { GenerationList } from './workspace/GenerationList'
import { ShortageList } from './workspace/ShortageList'
import { RepairModal, type RepairRequest } from './workspace/RepairModal'
import { DutiesView } from './workspace/DutiesView'
import { ContextPanel, RequestRow } from './workspace/ContextPanel'

const ORIGIN = 'apps/web/src/app/transit/daily-operation/page'
const LAST_KEY = 'nyx.roster.context'

// the Tudo / Tabelas / Plantões / Sobra filter
type Kind = 'tudo' | 'tabelas' | 'plantoes' | 'sobra' | 'compensacao'
// sobra / compensação filter crew members (the Operadores view), not duties
const isKind = (d: RosterBoardDuty, kind: Kind) => kind === 'tudo' || kind === 'sobra' || kind === 'compensacao' || (kind === 'plantoes') === (d.kind === 'STANDBY')

// a duty's pendências: code → cars hit (1 for the duty's own); DUTY_UNASSIGNED (RESERVE_SHORT for
// a plantão) when it has no holder
function dutyIssues(d: RosterBoardDuty): Map<string, number> {
  const count = new Map<string, number>()
  const unassigned = d.kind === 'STANDBY' ? 'RESERVE_SHORT' : 'DUTY_UNASSIGNED'
  if (!d.crewMemberId) count.set(unassigned, 1)
  // advisories (info) aren't pendências
  for (const i of d.issues) if (i.code !== unassigned && i.severity !== 'info') count.set(i.code, 1)
  for (const b of d.blocks) for (const code of new Set(b.issues.map(i => i.code))) count.set(code, (count.get(code) ?? 0) + 1)
  return count
}

// "Escala" — the real roster of one empresa/role, managed in one screen: a period (day, week or
// month), two views (Operadores: people × days; Escalas: duties), a context panel (the selected
// crew member / duty / day), the period's pendências and pending requests, and "Gerar".
// The context lives in the URL (?empresa=&funcao=&data=&modo=&visao=); the last one is
// remembered. See docs/architecture/transit/rostering.md (the Escala screen).

export default function RosterPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const queryClient  = useQueryClient()
  const { toast }    = useToast()
  const confirm      = useConfirm()
  const { guardNode, canUpdate } = usePageGuard('transit', 'daily-operation')

  // ── context (URL; without one, the last one used) ──
  const branchId = searchParams.get('empresa') ?? ''
  const role     = (searchParams.get('funcao') ?? 'DRIVER') as CrewRole
  const date     = searchParams.get('data') ?? localToday()
  const mode     = (searchParams.get('modo') ?? 'semana') as Mode
  const view     = (searchParams.get('visao') ?? 'operadores') as View
  // tabelas / plantões only (both views); sobra: the crew left over (Operadores)
  const kind     = (searchParams.get('tipo') ?? 'tudo') as Kind
  const setCtx = (patch: Record<string, string>) => {
    const { tipo, ...base } = { empresa: branchId, funcao: role, data: date, modo: mode, visao: view, tipo: kind as string, ...patch }
    const next: Record<string, string> = tipo === 'tudo' ? base : { ...base, tipo }
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ empresa: next.empresa, funcao: next.funcao, modo: next.modo, visao: next.visao })) } catch { /* private mode */ }
    router.replace(`/transit/daily-operation?${new URLSearchParams(next)}`)
  }
  const { from, to } = periodOf(mode, date)

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      if (!res.ok) throw new Error()
      const json = await res.json()
      return json.data ?? json
    },
  })
  // no empresa in the URL: the last context used, else the first empresa
  useEffect(() => {
    if (branchId || !branches.length) return
    let last: Record<string, string> = {}
    try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') } catch { /* private mode */ }
    setCtx({
      empresa: branches.some(b => b.id === last.empresa) ? last.empresa : branches[0].id,
      ...(last.funcao ? { funcao: last.funcao } : {}), ...(last.modo ? { modo: last.modo } : {}), ...(last.visao ? { visao: last.visao } : {}),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, branches])

  const boardKey = ['transit', 'roster-board', branchId, role, from, to]
  const { data: board, isFetching, error } = useQuery<RosterBoard>({
    queryKey: boardKey,
    queryFn:  async () => {
      const res = await apiFetch(`/transit/roster-board?branchId=${branchId}&role=${role}&from=${from}&to=${to}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
    enabled: !!branchId,
    placeholderData: (prev) => prev,
  })
  const idx = useMemo(() => (board ? indexBoard(board) : null), [board])
  const dates = useMemo(() => board?.days.map(d => d.date) ?? [], [board])

  // ── selection ──
  const [cursor, setCursor] = useState<GridPos | null>(null)
  const [anchor, setAnchor] = useState<GridPos | null>(null)
  const [dutyId, setDutyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [drawer, setDrawer] = useState<'issues' | 'requests' | 'quality' | null>(null)
  const [repair, setRepair] = useState<RepairRequest | null>(null)
  const clearSelection = () => { setCursor(null); setAnchor(null); setDutyId(null) }

  const q = search.trim().toLowerCase()
  // (memoized by the React Compiler)
  // the crew left over on the created days (`${memberId}|${date}`)
  const free = board && idx ? freeCells(board, idx) : new Set<string>()
  // the folgas compensadas of the period (`${memberId}|${date}`)
  const comps = new Set((board?.cells ?? []).filter(c => c.entries.some(e => e.kind === 'COMP_OFF')).map(c => `${c.crewMemberId}|${c.date}`))
  // the crew members holding a duty of the kind in the period — or left over / compensating some day
  const holders = kind === 'sobra' || kind === 'compensacao'
    ? new Set([...(kind === 'sobra' ? free : comps)].map(k => k.slice(0, k.indexOf('|'))))
    : new Set((board?.duties ?? []).filter(d => isKind(d, kind)).flatMap(d => d.crewMemberId ?? []))
  const members = (board?.members ?? []).filter(m =>
    (kind === 'tudo' || holders.has(m.id)) && (!q || m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)))
  const duties = (board?.duties ?? []).filter(d => {
    if (!isKind(d, kind)) return false
    if (!q) return true
    const holder = d.crewMemberId ? idx?.memberById.get(d.crewMemberId) : null
    return `${dutyName(d, !!board?.multiScope)} ${d.lines.join(' ')} ${holder?.code ?? ''} ${holder?.name ?? ''}`.toLowerCase().includes(q)
  })
  // the period's plantões: held / all
  const standby = (board?.duties ?? []).filter(d => d.kind === 'STANDBY')

  // a duty's pendências in one line — the same one on several cars counted once ("Sem veículo (2 carros)")
  const issueText = (d: RosterBoardDuty) => [...dutyIssues(d)]
    .map(([code, n]) => (code === 'DUTY_UNASSIGNED' ? 'sem operador' : `${ISSUE_LABEL[code] ?? code}${n > 1 ? ` (${n} carros)` : ''}`))
    .join(' · ')
  // why the duties without anyone have none — read while Pendências is open
  const hasUnassigned = (board?.duties ?? []).some(d => !d.crewMemberId)
  const { data: shortage } = useQuery<RosterShortage[]>({
    queryKey: ['transit', 'roster-board', branchId, role, 'shortage', from, to],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/roster-board/shortage?branchId=${branchId}&role=${role}&from=${from}&to=${to}`)
      return res.ok ? (await res.json()).shortage : []
    },
    enabled: drawer === 'issues' && hasUnassigned,
  })
  const issueDuties = useMemo(() => (board?.duties ?? []).filter(d => dutyIssues(d).size > 0), [board])
  // the reasons, by the number of duties they hit — a chip filters the list
  const issueReasons = useMemo(() => {
    const count = new Map<string, number>()
    for (const d of issueDuties) for (const code of dutyIssues(d).keys()) count.set(code, (count.get(code) ?? 0) + 1)
    return [...count].sort((a, b) => b[1] - a[1])
  }, [issueDuties])
  const [issueFilter, setIssueFilter] = useState<string | null>(null)
  const filter = issueReasons.some(([code]) => code === issueFilter) ? issueFilter : null
  const shownIssues = filter ? issueDuties.filter(d => dutyIssues(d).has(filter)) : issueDuties
  const pendingRequests = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; kind: string; status: string; startNotBefore: number | null; endNotAfter: number | null; memberId: string; dates: string[] }>()
    for (const c of board?.cells ?? []) for (const r of c.requests) {
      if (r.status !== 'REQUESTED') continue
      const x = seen.get(r.id) ?? { ...r, memberId: c.crewMemberId, dates: [] }
      x.dates.push(c.date)
      seen.set(r.id, x)
    }
    return [...seen.values()]
  }, [board])

  // ── edits: the board changes at once (instant update), then the server's answer replaces it ──
  const [busy, setBusy] = useState(0)
  async function run(fn: () => Promise<unknown>, patch?: (b: RosterBoard) => RosterBoard, ok?: string) {
    setBusy(n => n + 1)
    if (patch) queryClient.setQueryData<RosterBoard>(boardKey, b => (b ? patch(b) : b))
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['transit', 'roster-board', branchId, role] })
      setBusy(n => n - 1)
    }
  }
  const op = (d: RosterBoardDuty) => `/transit/daily-operation/${d.operationId}`
  const assignMany = (items: { duty: RosterBoardDuty; memberId: string | null }[]) => items.length && run(
    () => call('/transit/roster-board/assign', 'POST', { items: items.map(i => ({ dutyId: i.duty.id, crewMemberId: i.memberId })) }),
    b => items.reduce((x, i) => withAssign(x, i.duty.id, i.memberId), b),
  )
  const offMany = (cells: GridPos[], kind: 'DAY_OFF' | 'COMP_OFF' | null, absenceTypeId: string | null = null) => cells.length && run(
    () => call('/transit/roster-board/day-off', 'PUT', { items: cells.map(c => ({ date: c.date, crewMemberId: c.memberId })), kind, absenceTypeId }),
    b => withDayOff(b, cells, kind, absenceTypeId),
  )
  const assign  = (d: RosterBoardDuty, memberId: string | null) => assignMany([{ duty: d, memberId }])
  const lock    = (d: RosterBoardDuty, locked: boolean) => run(() => call(`${op(d)}/duty/${d.id}/lock`, 'PUT', { locked }), b => withLock(b, [d.id], locked))
  const vehicle = (d: RosterBoardDuty, blockId: string, vehicleId: string | null) => run(() => call(`${op(d)}/block/${blockId}/vehicle`, 'PUT', { vehicleId }))
  const dayOff  = (memberId: string, day: string, kind: 'DAY_OFF' | 'COMP_OFF' | null, absenceTypeId?: string | null) => offMany([{ memberId, date: day }], kind, absenceTypeId ?? null)
  const review  = (id: string, status: 'APPROVED' | 'REJECTED', answer?: string) =>
    run(() => call(`/transit/crew-occurrence/${id}`, 'PATCH', { status, ...(answer ? { reviewNotes: answer } : {}) }), undefined, status === 'APPROVED' ? 'Pedido aprovado' : 'Pedido recusado')
  const dutiesAt = (p: GridPos) => (idx?.cellOf.get(`${p.memberId}|${p.date}`)?.entries ?? []).flatMap(e => (e.dailyDutyId ? idx?.dutyById.get(e.dailyDutyId) ?? [] : []))

  const gridActions = {
    assign,
    // a day off only where there's no duty
    dayOff: (cells: GridPos[], kind: 'DAY_OFF' | 'COMP_OFF' | null, absenceTypeId?: string | null) => offMany(cells.filter(c => !dutiesAt(c).length), kind, absenceTypeId ?? null),
    clear: (cells: GridPos[]) => {
      void assignMany(cells.flatMap(c => dutiesAt(c).filter(d => !d.locked).map(duty => ({ duty, memberId: null }))))
      void offMany(cells.filter(c => !dutiesAt(c).length), null)
    },
    lock: (cells: GridPos[]) => {
      const ds = cells.flatMap(dutiesAt).filter(d => d.crewMemberId)
      const to = ds.some(d => !d.locked)
      const change = ds.filter(d => d.locked !== to)
      if (change.length) void run(async () => { for (const d of change) await call(`${op(d)}/duty/${d.id}/lock`, 'PUT', { locked: to }) }, b => withLock(b, change.map(d => d.id), to))
    },
    swap: (day: string, a: string, b: string) => run(() => call('/transit/roster-board/swap', 'POST', { date: day, a, b }), x => withSwap(x, day, a, b)),
    paste: (items: { duty: RosterBoardDuty; memberId: string }[], off: GridPos[]) => {
      void assignMany(items)
      void offMany(off.filter(c => !dutiesAt(c).length), 'DAY_OFF')
    },
    notice: (text: string) => toast.success(text),
  }
  const panelActions = {
    assign, lock, vehicle, dayOff, review,
    status: async (operationId: string, to: 'PUBLISHED' | 'CLOSED') => {
      if (to === 'CLOSED' && !(await confirm({
        title: 'Encerrar o dia',
        description: 'Encerrar é para depois que o dia aconteceu: ele fica somente leitura, como registro do realizado, e a geração não o refaz mais. Só um administrador consegue reabri-lo.',
        confirmLabel: 'Encerrar',
      }))) return
      // publishing with crew left over on the day asks first
      const date = board?.days.find(d => d.operations.some(o => o.id === operationId))?.date
      const left = date ? [...free].filter(k => k.endsWith(`|${date}`)).length : 0
      if (to === 'PUBLISHED' && left > 0 && !(await confirm({
        title: 'Operadores não escalados',
        description: `${left} operador(es) sem tabela, folga ou ausência em ${fmtDay(date!)}. Publicar mesmo assim?`,
        confirmLabel: 'Publicar',
      }))) return
      void run(() => call(`/transit/daily-operation/${operationId}/${to === 'PUBLISHED' ? 'publish' : 'close'}`, 'POST', {}), undefined, to === 'PUBLISHED' ? 'Dia publicado' : 'Dia encerrado')
    },
    remake: async (operationId: string) => {
      if (!(await confirm({
        title: 'Refazer o dia',
        description: 'O dia é descartado e copiado de novo dos planejamentos em vigor — operadores e veículos alocados são perdidos (folgas lançadas ficam).',
        confirmLabel: 'Refazer', variant: 'destructive',
      }))) return
      void run(() => call(`/transit/daily-operation/${operationId}/rematerialize`, 'POST', {}), undefined, 'Dia refeito')
    },
    revert: (operationId: string, reason: string) =>
      run(() => call(`/transit/daily-operation/${operationId}/revert`, 'POST', { reason }), undefined, 'Status do dia revertido'),
    repair: (r: RepairRequest) => setRepair(r),
  }

  const panelDate = cursor?.date ?? (dutyId ? idx?.dutyById.get(dutyId)?.date : null) ?? (dates.includes(localToday()) ? localToday() : dates[0] ?? null)
  const recalcDay = () => {
    const ops = board?.days.find(d => d.date === panelDate)?.operations ?? []
    if (ops.length) void run(async () => { for (const o of ops) await call(`/transit/daily-operation/${o.id}/recalculate`, 'POST', {}) }, undefined, 'Dia recalculado')
  }

  // every PLANNED day of the period
  const toPublish = (board?.days ?? []).flatMap(d => d.operations.filter(o => o.status === 'PLANNED'))
  async function publishPeriod() {
    const ok = await confirm({
      title: 'Publicar o período',
      description: `${toPublish.length} dia(s) planejado(s) de ${fmtDay(from)} a ${fmtDay(to)} passam a publicados — dali em diante cada mudança fica registrada no histórico do dia.`,
      confirmLabel: 'Publicar',
    })
    if (ok) void run(async () => { for (const o of toPublish) await call(`/transit/daily-operation/${o.id}/publish`, 'POST', {}) }, undefined, 'Período publicado')
  }

  // ── generation: its proposal drawn over the board ──
  const [genOpen, setGenOpen] = useState(false)
  const [remakeOpen, setRemakeOpen] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const overlay = useMemo((): Overlay | null => {
    if (!proposal || !board || !idx) return null
    // the days the run may change: PLANNED (or not created yet), and PUBLISHED when it includes them
    const editable = (st: string) => st === 'PLANNED' || (proposal.includePublished && st === 'PUBLISHED')
    const plannedDates = new Set(board.days.filter(d => !d.operations.length || d.operations.some(o => editable(o.status))).map(d => d.date))
    const labels = new Map<string, string[]>()
    for (const [dutyId, memberId] of proposal.assignments) {
      const d = idx.dutyById.get(dutyId)
      if (d) labels.set(`${memberId}|${d.date}`, [...(labels.get(`${memberId}|${d.date}`) ?? []), dutyName(d, board.multiScope)])
    }
    const offs = new Set(proposal.dayOffs.map(([date, memberId]) => `${memberId}|${date}`))
    const comps = new Set((proposal.compOffs ?? []).map(([date, memberId]) => `${memberId}|${date}`))
    const out: Overlay = new Map()
    for (const m of board.members) for (const date of dates) {
      if (!plannedDates.has(date)) continue
      const key = `${m.id}|${date}`
      const s = cellSummary(idx.cellOf.get(key), idx, board.multiScope)
      const current = s.label || s.offLabel
      // kept as it is: locked duties, days off already launched
      const proposed = labels.get(key)?.join('+') || (offs.has(key) ? 'F' : comps.has(key) ? 'FC' : s.locked ? s.label : s.off ? current : '')
      if (proposed !== current) out.set(key, { label: proposed, changed: true })
    }
    return out
  }, [proposal, board, idx, dates])

  useTopbarActions([
    ...(canUpdate ? [{
      label: 'Gerar', icon: Icons.Sparkles, onClick: () => setGenOpen(o => !o), primary: true,
      menu: [{ label: 'Refazer período', icon: Icons.RotateCcw, onClick: () => setRemakeOpen(true) }],
    }] : []),
    { label: 'Recalcular dia', icon: Icons.RefreshCw, onClick: recalcDay, variant: 'ghost' as const, keybind: 'ALT+G', disabled: busy > 0 },
  ], [canUpdate, panelDate, busy, board])
  useShortcut('alt+g', recalcDay, { desc: 'Recalcular o dia selecionado', icon: Icons.RefreshCw, origin: ORIGIN })
  useShortcut('ctrl+shift+f', () => { searchRef.current?.focus(); searchRef.current?.select() }, { desc: 'Buscar', icon: Icons.Search, origin: ORIGIN })
  useShortcut('alt+v', () => router.push('/transit'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN })
  useShortcut('alt+l', () => void queryClient.invalidateQueries({ queryKey: boardKey }), { display: false, origin: ORIGIN })
  useShortcut('esc', clearSelection, { display: false, origin: ORIGIN, enabled: !repair && (!!cursor || !!dutyId) })

  if (guardNode) return guardNode

  const periodLabel = mode === 'dia' ? `${WEEKDAY[weekday(from)]} ${fmtDay(from)}` : `${fmtDay(from)} – ${fmtDay(to)}`
  const ctl = 'h-8 px-2.5 text-sm rounded-sm cursor-pointer'

  return (
    <div className="p-6 space-y-3">
      <Breadcrumb segments={[{ label: 'Operação', href: '/transit' }, { label: 'Escala Diária' }]} />

      {/* ── context ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={branchId} onChange={e => setCtx({ empresa: e.target.value })} size="sm" wrapperClassName="w-52">
          {!branchId && <option value="">Empresa…</option>}
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select value={role} onChange={e => setCtx({ funcao: e.target.value })} size="sm" wrapperClassName="w-40">
          {CREW_ROLES.map(r => <option key={r} value={r}>{CREW_ROLE_LABEL[r]}</option>)}
        </Select>
        <div className="flex items-center gap-1 ml-2">
          <button type="button" onClick={() => setCtx({ data: shiftPeriod(mode, date, -1) })} className="p-1 rounded hover:bg-muted cursor-pointer"><Icons.ChevronLeft className="w-4 h-4" /></button>
          <PeriodPicker mode={mode} date={date} label={periodLabel} onPick={d => setCtx({ data: d })} />
          <button type="button" onClick={() => setCtx({ data: shiftPeriod(mode, date, 1) })} className="p-1 rounded hover:bg-muted cursor-pointer"><Icons.ChevronRight className="w-4 h-4" /></button>
          <button type="button" onClick={() => setCtx({ data: localToday() })} className="hover:bg-accent hover:text-accent-foreground h-8 px-3 text-sm rounded cursor-pointer">Hoje</button>
        </div>
        <div className="flex rounded-sm border border-border overflow-hidden">
          {(['dia', 'semana', 'mes'] as const).map(m => (
            <button key={m} type="button" onClick={() => setCtx({ modo: m })} className={cn(ctl, 'rounded-none', mode === m ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
              {m === 'dia' ? 'Dia' : m === 'semana' ? 'Sem' : 'Mês'}
            </button>
          ))}
        </div>
        {(isFetching || busy > 0) && <Icons.Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {/* ── days strip ── */}
      {board && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {board.days.map(d => {
            const status = !d.operations.length ? 'none' : d.operations.every(o => o.status === 'CLOSED') ? 'closed' : d.operations.every(o => o.status !== 'PLANNED') ? 'published' : 'planned'
            return (
              <button
                key={d.date} type="button"
                onClick={() => (mode === 'dia' ? setCtx({ data: d.date }) : setCursor(c => (c ? { ...c, date: d.date } : members[0] ? { memberId: members[0].id, date: d.date } : null)))}
                className={cn('shrink-0 rounded-sm border px-2 py-1 text-left text-xs cursor-pointer hover:bg-muted', panelDate === d.date ? 'border-primary' : 'border-border')}
              >
                <span className={cn(weekday(d.date) % 6 === 0 && 'font-medium')}>{WEEKDAY[weekday(d.date)]} {fmtDay(d.date)}</span>
                <span className="block text-[10px]">
                  {d.operations.some(o => o.outdated) && <span className="text-amber-600 dark:text-amber-400" title={d.operations.find(o => o.outdated)!.outdated!}>⚠ </span>}
                  {status === 'none' ? <span className="text-muted-foreground">— não criado</span>
                    : d.issues ? <span className="text-red-600 dark:text-red-400">● {d.issues} pend.</span>
                    : status === 'published' ? <span className="text-emerald-600 dark:text-emerald-400">✓ publicada</span>
                    : status === 'closed' ? <span className="text-muted-foreground">encerrada</span>
                    : <span className="text-muted-foreground">○ planejada</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── view bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-sm border border-border overflow-hidden">
          {(['escalas', 'operadores'] as const).map(v => (
            <button key={v} type="button" onClick={() => setCtx({ visao: v })} className={cn(ctl, 'rounded-none', view === v ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
              {v === 'escalas' ? 'Escalas' : 'Operadores'}
            </button>
          ))}
        </div>
        {board && (
          // what to show — the crew left over / compensating shows on the Operadores view
          <Select
            value={kind} size="sm" wrapperClassName="w-52"
            onChange={e => { const k = e.target.value as Kind; setCtx(k === 'sobra' || k === 'compensacao' ? { tipo: k, visao: 'operadores' } : { tipo: k }) }}
            title={kind === 'sobra' ? (mode === 'dia' ? 'Operadores sem tabela, folga ou ausência no dia' : 'Dias de operador sem tabela, folga ou ausência no período') : kind === 'compensacao' ? 'Operadores com folga compensada no período' : undefined}
            className={cn(kind !== 'tudo' && 'text-primary font-medium')}
          >
            <option value="tudo">Mostrar: tudo</option>
            <option value="tabelas">Tabelas</option>
            {(standby.length > 0 || kind === 'plantoes') && <option value="plantoes">Plantões ({standby.filter(d => d.crewMemberId).length}/{standby.length})</option>}
            <option value="sobra">Sobra ({free.size})</option>
            {(comps.size > 0 || kind === 'compensacao') && <option value="compensacao">Compensação ({comps.size})</option>}
          </Select>
        )}
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder={view === 'escalas' ? 'Tabela, linha ou operador…' : 'Matrícula ou nome…'}
            className="h-8 w-60 pl-8 pr-2 md:pr-10 border border-input rounded-sm text-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring" />
          <KeyHint k="f" className="right-2" />
        </div>
        <button type="button" onClick={() => setDrawer(d => (d === 'issues' ? null : 'issues'))} className={cn(ctl, 'border border-border ml-auto', drawer === 'issues' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
          <Icons.AlertTriangle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />Pendências {issueDuties.length > 0 && <span className="text-red-600 dark:text-red-400">{issueDuties.length}</span>}
        </button>
        <button type="button" onClick={() => setDrawer(d => (d === 'requests' ? null : 'requests'))} className={cn(ctl, 'border border-border', drawer === 'requests' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
          <Icons.Mail className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />Pedidos {pendingRequests.length > 0 && <span className="text-amber-600 dark:text-amber-400">{pendingRequests.length}</span>}
        </button>
        <button type="button" onClick={() => setDrawer(d => (d === 'quality' ? null : 'quality'))} className={cn(ctl, 'border border-border', drawer === 'quality' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
          <Icons.Gauge className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />Qualidade
        </button>
        {canUpdate && toPublish.length > 0 && (
          <button type="button" onClick={() => void publishPeriod()} className={cn(ctl, 'border border-border hover:bg-muted')}>
            <Icons.Send className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />Publicar período <span className="text-muted-foreground">{toPublish.length}</span>
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error instanceof Error ? error.message : 'Erro'}</p>}

      {board && idx && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] items-start">
          <div className="min-w-0">
            {view === 'operadores' ? (
              <OperatorsGrid
                board={board} idx={idx} dates={dates} members={members} cursor={cursor} anchor={anchor}
                canEdit={canUpdate} busy={busy > 0} overlay={overlay} free={kind === 'sobra' ? free : undefined}
                onCursor={(pos, extend) => { setAnchor(extend ? anchor ?? cursor : null); setCursor(pos); setDutyId(null) }}
                actions={gridActions}
              />
            ) : (
              <DutiesView board={board} idx={idx} dates={dates} duties={duties} selectedId={dutyId} onSelect={(id) => { setDutyId(id); setCursor(null); setAnchor(null) }} />
            )}
          </div>

          <div className="xl:sticky xl:top-4 space-y-4">
            {genOpen && canUpdate && (
              <GeneratePanel
                branchId={branchId} role={role} from={from} to={to}
                onProposal={setProposal}
                onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['transit', 'roster-board', branchId, role] })}
                onClose={() => setGenOpen(false)}
                onSelectDuty={(id) => { setCtx({ visao: 'escalas' }); setDutyId(id); setCursor(null) }}
              />
            )}
            {drawer === 'issues' && (
              <section className="rounded-lg border border-border p-3 space-y-1 max-h-80 overflow-y-auto">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium me-auto">Pendências do período</p>
                  {canUpdate && issueDuties.length > 0 && to >= localToday() && (
                    <>
                      <Button size="sm" variant="outline" className="h-6 text-xs" title="Reparar as tabelas do período — o mínimo de mudanças" onClick={() => setRepair({ kind: 'crew', from, to })}>
                        <Icons.Wrench className="w-3 h-3" />Tabelas
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs" title="Reparar os carros do período — o mínimo de mudanças" onClick={() => setRepair({ kind: 'vehicles', from, to })}>
                        <Icons.Wrench className="w-3 h-3" />Veículos
                      </Button>
                    </>
                  )}
                </div>
                {!issueDuties.length && <p className="text-xs text-muted-foreground">Nenhuma.</p>}
                {shortage && shortage.length > 0 && (
                  <div className="border-b border-border pb-1.5 mb-1.5">
                    <ShortageList groups={shortage} onSelectDuty={(id) => { setCtx({ visao: 'escalas' }); setDutyId(id); setCursor(null) }} />
                  </div>
                )}
                {issueReasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 pb-1.5">
                    {issueReasons.map(([code, n]) => {
                      const label = code === 'DUTY_UNASSIGNED' ? 'Sem operador' : ISSUE_LABEL[code] ?? code
                      return (
                        <button key={code} type="button" title={label} onClick={() => setIssueFilter(filter === code ? null : code)}
                          className={cn('max-w-full truncate rounded-sm border px-1.5 py-0.5 text-[11px] cursor-pointer', filter === code ? 'border-primary bg-accent text-accent-foreground' : 'border-border hover:bg-muted')}>
                          {label} <span className="tabular-nums text-muted-foreground">{n}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {shownIssues.map(d => (
                  <button key={d.id} type="button" onClick={() => { setCtx({ visao: 'escalas' }); setDutyId(d.id); setCursor(null) }}
                    className="w-full text-left text-xs rounded-sm px-1.5 py-1 hover:bg-muted cursor-pointer">
                    <span className="tabular-nums text-muted-foreground">{fmtDay(d.date)}</span> <span className="font-medium">{dutyName(d, board.multiScope)}</span>{' '}
                    <span className="text-muted-foreground">
                      {issueText(d)}
                    </span>
                  </button>
                ))}
              </section>
            )}
            {drawer === 'quality' && board && (
              <section className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-sm font-medium">Qualidade da escala · {fmtDay(from)}–{fmtDay(to)}</p>
                {board.quality
                  ? <QualityTable columns={[{ label: 'Atual', q: board.quality }]} />
                  : <p className="text-xs text-muted-foreground">Nenhuma tabela no período.</p>}
                <GenerationList list={board.generations} />
              </section>
            )}
            {drawer === 'requests' && (
              <section className="rounded-lg border border-border p-3 space-y-2 max-h-96 overflow-y-auto">
                <p className="text-sm font-medium">Pedidos pendentes do período</p>
                {!pendingRequests.length && <p className="text-xs text-muted-foreground">Nenhum.</p>}
                {pendingRequests.map(r => {
                  const m = idx.memberById.get(r.memberId)
                  return (
                    <div key={r.id} className="space-y-0.5">
                      <button type="button" onClick={() => { setCtx({ visao: 'operadores' }); setCursor({ memberId: r.memberId, date: r.dates[0] }); setAnchor(null) }}
                        className="text-xs text-left hover:underline cursor-pointer">
                        <span className="tabular-nums text-muted-foreground">{m?.code}</span> {m?.name} · {fmtDay(r.dates[0])}{r.dates.length > 1 ? `–${fmtDay(r.dates[r.dates.length - 1])}` : ''}
                      </button>
                      <RequestRow r={r} canEdit={canUpdate} onReview={review} impact={requestImpact(r, r.memberId, r.dates, idx, board.multiScope)} />
                    </div>
                  )
                })}
              </section>
            )}
            <ContextPanel
              board={board} idx={idx} date={panelDate}
              memberId={view === 'operadores' ? cursor?.memberId ?? null : null}
              dutyId={view === 'escalas' ? dutyId : null}
              canEdit={canUpdate} actions={panelActions} onClose={clearSelection}
            />
          </div>
        </div>
      )}

      {repair && (
        <RepairModal
          {...repair} branchId={branchId} role={role} canApply={canUpdate}
          onClose={() => setRepair(null)}
          onApplied={n => {
            setRepair(null)
            toast.success(`Reparo aplicado — ${n} mudança(s)`)
            void queryClient.invalidateQueries({ queryKey: ['transit', 'roster-board', branchId, role] })
          }}
        />
      )}
      {remakeOpen && (
        <RemakePeriodModal
          branchId={branchId} from={from} to={to}
          onClose={() => setRemakeOpen(false)}
          onDone={r => {
            setRemakeOpen(false)
            setProposal(null)
            toast.success(`${r.days} dia(s) refeito(s) — gere a escala de novo`)
            void queryClient.invalidateQueries({ queryKey: ['transit', 'roster-board', branchId, role] })
          }}
        />
      )}
    </div>
  )
}
