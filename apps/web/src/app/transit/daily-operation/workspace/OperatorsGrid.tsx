'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/lib/confirm-context'
import { WEEKDAY, cellSummary, clock, dutyName, fmtDay, hm, weekday, type BoardIndex, type RosterBoard, type RosterBoardDuty, type RosterBoardMember } from './board'

// "Operadores" — the roster board: crew members × days. Keyboard first: arrows (shift extends),
// Enter opens the day's duties, F launches a day off, Del clears, L locks, Ctrl+C / Ctrl+V copy a
// block (the same duty numbers on the target days); drag a cell onto another crew member's to
// swap the day. Clearing, a paste over filled days and a swap ask for confirmation (Enter).
// With a generation's proposal, the cells it changes show what it proposes.

export interface GridPos { memberId: string; date: string }

export interface GridActions {
  assign:   (duty: RosterBoardDuty, memberId: string | null) => void
  // absenceTypeId: the day off's type (none: the system one of the kind)
  dayOff:   (cells: GridPos[], kind: 'DAY_OFF' | 'COMP_OFF' | null, absenceTypeId?: string | null) => void
  clear:    (cells: GridPos[]) => void
  lock:     (cells: GridPos[]) => void
  swap:     (date: string, a: string, b: string) => void
  paste:    (assign: { duty: RosterBoardDuty; memberId: string }[], off: GridPos[]) => void
  notice:   (text: string) => void
}

// a generation's proposal per cell (`${memberId}|${date}`)
export type Overlay = Map<string, { label: string; changed: boolean }>

interface Props {
  board:     RosterBoard
  idx:       BoardIndex
  dates:     string[]
  members:   RosterBoardMember[]
  cursor:    GridPos | null
  anchor:    GridPos | null
  canEdit:   boolean
  busy:      boolean
  onCursor:  (pos: GridPos, extend: boolean) => void
  actions:   GridActions
  overlay?:  Overlay | null
}

type Copied = { dr: number; dc: number; value: { type: 'duty'; scope: string; number: number } | { type: 'off' } }[]

export function OperatorsGrid({ board, idx, dates, members, cursor, anchor, canEdit, busy, onCursor, actions, overlay }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const copied = useRef<Copied>([])
  const [picker, setPicker] = useState<{ pos: GridPos; rect: DOMRect } | null>(null)
  const [drag, setDrag] = useState<GridPos | null>(null)
  const confirm = useConfirm()
  const single = dates.length === 1

  // rows grouped by the crew member's shift; other empresas / roles last
  const groups = useMemo(() => {
    const byKey = new Map<string, { label: string; rows: RosterBoardMember[] }>()
    for (const m of members) {
      const key = m.foreign ? '~' : m.shiftId ?? '-'
      const label = m.foreign ? 'De outra empresa / função' : m.shiftId ? `Turno ${idx.shiftCode.get(m.shiftId) ?? '?'}` : 'Sem turno'
      const g = byKey.get(key) ?? { label, rows: [] }
      g.rows.push(m)
      byKey.set(key, g)
    }
    return [...byKey.entries()].sort((a, b) => (a[0] === '~' ? 1 : b[0] === '~' ? -1 : a[1].label.localeCompare(b[1].label))).map(([, g]) => g)
  }, [members, idx])
  const order = useMemo(() => groups.flatMap(g => g.rows.map(r => r.id)), [groups])

  // the selected rectangle
  const inSel = (memberId: string, date: string) => {
    if (!cursor || !anchor) return false
    const r = [order.indexOf(cursor.memberId), order.indexOf(anchor.memberId)].sort((a, b) => a - b)
    const d = [cursor.date, anchor.date].sort()
    const i = order.indexOf(memberId)
    return i >= r[0] && i <= r[1] && date >= d[0] && date <= d[1]
  }
  const selected = (): GridPos[] => {
    if (!cursor) return []
    if (!anchor) return [cursor]
    const out: GridPos[] = []
    for (const id of order) for (const date of dates) if (inSel(id, date)) out.push({ memberId: id, date })
    return out
  }

  // keep the cursor's cell in view
  useEffect(() => {
    if (!cursor) return
    wrapRef.current?.querySelector(`[data-cell="${cursor.memberId}|${cursor.date}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [cursor])

  // the destructive edits: one more Enter, then the focus back on the grid
  const summaryAt = (p: GridPos) => cellSummary(idx.cellOf.get(`${p.memberId}|${p.date}`), idx, board.multiScope)
  const who = (memberId: string) => { const m = idx.memberById.get(memberId); return m ? `${m.code} ${m.name}` : '?' }
  async function confirmed(title: string, description: string, confirmLabel: string, variant: 'destructive' | 'default' = 'default') {
    const ok = await confirm({ title, description, confirmLabel, variant })
    wrapRef.current?.focus()
    return ok
  }
  async function clear(cells: GridPos[]) {
    const hit = cells.filter(c => { const s = summaryAt(c); return (s.duties.length > 0 && !s.locked) || !!s.off })
    if (!hit.length) return
    const s = summaryAt(hit[0])
    const ok = await confirmed('Limpar', hit.length === 1
      ? `${who(hit[0].memberId)} · ${fmtDay(hit[0].date)}: ${s.label || s.offName} sai da escala.`
      : `${hit.length} dias com tabela ou folga serão limpos.`, 'Limpar', 'destructive')
    if (ok) actions.clear(hit)
  }
  async function paste(assign: { duty: RosterBoardDuty; memberId: string }[], off: GridPos[]) {
    const filled = [...assign.map(a => ({ memberId: a.memberId, date: a.duty.date })), ...off].filter(c => { const s = summaryAt(c); return s.duties.length > 0 || !!s.off }).length
    const taken = assign.filter(a => a.duty.crewMemberId && a.duty.crewMemberId !== a.memberId).length
    if (filled || taken) {
      const lines = [filled && `${filled} dia(s) já preenchido(s) serão substituídos.`, taken && `${taken} tabela(s) saem de outro operador.`].filter(Boolean).join('\n')
      if (!(await confirmed('Colar', lines, 'Colar'))) return
    }
    actions.paste(assign, off)
  }
  async function swap(date: string, a: string, b: string) {
    if (await confirmed('Trocar o dia', `${fmtDay(date)}: ${who(a)} ⇄ ${who(b)}`, 'Trocar')) actions.swap(date, a, b)
  }

  function openPicker(pos: GridPos) {
    const el = wrapRef.current?.querySelector(`[data-cell="${pos.memberId}|${pos.date}"]`)
    if (el && canEdit) setPicker({ pos, rect: el.getBoundingClientRect() })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (picker || !order.length) return
    const cur = cursor ?? { memberId: order[0], date: dates[0] }
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      const r = Math.max(0, Math.min(order.length - 1, order.indexOf(cur.memberId) + dr))
      const c = Math.max(0, Math.min(dates.length - 1, dates.indexOf(cur.date) + dc))
      onCursor({ memberId: order[r], date: dates[c] }, e.shiftKey)
    }
    switch (e.key) {
      case 'ArrowUp':    return move(-1, 0)
      case 'ArrowDown':  return move(1, 0)
      case 'ArrowLeft':  return move(0, -1)
      case 'ArrowRight': return move(0, 1)
      case 'Enter':      e.preventDefault(); return openPicker(cur)
    }
    const key = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && key === 'c') {
      e.preventDefault()
      const cells = selected()
      const r0 = Math.min(...cells.map(c => order.indexOf(c.memberId))), c0 = Math.min(...cells.map(c => dates.indexOf(c.date)))
      copied.current = cells.flatMap(c => {
        const s = cellSummary(idx.cellOf.get(`${c.memberId}|${c.date}`), idx, board.multiScope)
        const d = s.duties[0]
        const value = d ? { type: 'duty' as const, scope: d.scope, number: d.number } : s.off === 'DAY_OFF' ? { type: 'off' as const } : null
        return value ? [{ dr: order.indexOf(c.memberId) - r0, dc: dates.indexOf(c.date) - c0, value }] : []
      })
      return actions.notice(`${copied.current.length} célula(s) copiada(s)`)
    }
    if ((e.ctrlKey || e.metaKey) && key === 'v' && canEdit && copied.current.length) {
      e.preventDefault()
      const r0 = order.indexOf(cur.memberId), c0 = dates.indexOf(cur.date)
      const assign: { duty: RosterBoardDuty; memberId: string }[] = [], off: GridPos[] = []
      for (const c of copied.current) {
        const memberId = order[r0 + c.dr], date = dates[c0 + c.dc]
        if (!memberId || !date) continue
        if (c.value.type === 'off') { off.push({ memberId, date }); continue }
        const { scope, number } = c.value
        const duty = board.duties.find(d => d.date === date && d.scope === scope && d.number === number)
        if (duty && !duty.locked) assign.push({ duty, memberId })
      }
      return void paste(assign, off)
    }
    if (!canEdit || e.altKey || e.ctrlKey || e.metaKey) return
    if (key === 'f') { e.preventDefault(); actions.dayOff(selected(), 'DAY_OFF') }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); void clear(selected()) }
    else if (key === 'l') { e.preventDefault(); actions.lock(selected()) }
  }

  const today = new Date().toISOString().slice(0, 10)
  const colW = single ? 'min-w-64' : dates.length > 10 ? 'min-w-[3.25rem]' : 'min-w-20'

  return (
    <div
      ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}
      className={cn('relative overflow-auto rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-ring max-h-[calc(100vh-15rem)]', busy && 'opacity-80')}
    >
      <table className="text-xs border-separate border-spacing-0">
        <thead className="sticky top-0 z-20 bg-background">
          <tr>
            <th className="sticky left-0 z-30 bg-background border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground min-w-56">Operador</th>
            {dates.map(d => {
              const holiday = board.cells.some(c => c.date === d && c.holiday)
              return (
                <th key={d} className={cn('border-b border-border px-1 py-1 font-medium', colW, weekday(d) % 6 === 0 ? 'text-foreground' : 'text-muted-foreground', d === today && 'text-primary', holiday && 'text-sky-600 dark:text-sky-400')}>
                  <div>{WEEKDAY[weekday(d)]}</div>
                  <div className="tabular-nums">{fmtDay(d)}</div>
                </th>
              )
            })}
            <th className="border-b border-border px-2 py-1.5 font-medium text-muted-foreground text-right whitespace-nowrap">Horas / Carga</th>
            <th className="border-b border-border px-2 py-1.5 font-medium text-muted-foreground">Trocas</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <GroupRows key={g.label} label={g.label} cols={dates.length + 3}>
              {g.rows.map(m => (
                <tr key={m.id} className="group">
                  <td className="sticky left-0 z-10 bg-background group-hover:bg-muted/40 border-b border-border/60 px-2 py-1 whitespace-nowrap">
                    <span className="tabular-nums text-muted-foreground mr-1.5">{m.code}</span>
                    <span>{m.name}</span>
                    {m.rest && <span className="ml-1.5 text-[10px] text-muted-foreground/70">{m.rest}</span>}
                    {!m.rosterable && <span className="ml-1.5 text-[10px] text-muted-foreground/70" title="Fora da geração de escala">manual</span>}
                  </td>
                  {dates.map(date => {
                    const s = cellSummary(idx.cellOf.get(`${m.id}|${date}`), idx, board.multiScope)
                    const isCursor = cursor?.memberId === m.id && cursor.date === date
                    const pos = { memberId: m.id, date }
                    const hasContent = s.duties.length > 0 || !!s.off
                    const proposed = overlay?.get(`${m.id}|${date}`)
                    return (
                      <td
                        key={date}
                        data-cell={`${m.id}|${date}`}
                        draggable={canEdit && hasContent && !s.locked}
                        onDragStart={() => setDrag(pos)}
                        onDragEnd={() => setDrag(null)}
                        onDragOver={(e) => { if (drag && drag.date === date && drag.memberId !== m.id) e.preventDefault() }}
                        onDrop={(e) => { e.preventDefault(); if (drag && drag.date === date && drag.memberId !== m.id) void swap(date, drag.memberId, m.id); setDrag(null) }}
                        onMouseDown={(e) => { wrapRef.current?.focus(); onCursor(pos, e.shiftKey) }}
                        onDoubleClick={() => openPicker(pos)}
                        className={cn(
                          'relative border-b border-l border-border/60 px-1 py-1 text-center cursor-pointer select-none',
                          s.issues && 'bg-red-500/10 text-red-700 dark:text-red-300',
                          s.off && 'bg-amber-500/20 text-amber-800 dark:text-amber-200',
                          s.absence && 'bg-violet-500/25',
                          !hasContent && !s.absence && s.patternOff && 'text-amber-700/70 dark:text-amber-300/70',
                          inSel(m.id, date) && 'bg-accent/40',
                          isCursor && 'ring-2 ring-inset ring-primary',
                          drag?.memberId === m.id && drag.date === date && 'opacity-40',
                          proposed?.changed && 'outline outline-2 -outline-offset-2 outline-dashed outline-amber-500',
                        )}
                        title={proposed?.changed ? `Proposta: ${proposed.label || 'livre'}` : undefined}
                      >
                        {proposed?.changed
                          ? <span className="font-medium italic text-amber-700 dark:text-amber-300">{proposed.label || '·'}</span>
                          : <CellContent s={s} single={single} />}
                      </td>
                    )
                  })}
                  <td className={cn('border-b border-l border-border/60 px-2 py-1 text-right tabular-nums whitespace-nowrap', m.stats && m.stats.workedMinutes < m.stats.targetMinutes * 0.97 && 'text-amber-600 dark:text-amber-400')}>
                    {m.stats ? `${hm(m.stats.workedMinutes)} / ${hm(m.stats.targetMinutes)}` : '—'}
                  </td>
                  <td className="border-b border-l border-border/60 px-2 py-1 text-center tabular-nums">{m.stats?.changes ?? '—'}</td>
                </tr>
              ))}
            </GroupRows>
          ))}
        </tbody>
      </table>

      {picker && (
        <DutyPicker
          board={board} idx={idx} pos={picker.pos} rect={picker.rect}
          onClose={() => { setPicker(null); wrapRef.current?.focus() }}
          onPick={(choice) => {
            setPicker(null)
            wrapRef.current?.focus()
            if (choice.type === 'duty') actions.assign(choice.duty, picker.pos.memberId)
            else if (choice.type === 'clear') actions.clear([picker.pos])
            else actions.dayOff([picker.pos], choice.kind, choice.absenceTypeId)
          }}
        />
      )}
    </div>
  )
}

function GroupRows({ label, cols, children }: { label: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={cols} className="sticky left-0 bg-muted/30 border-b border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">{label}</td>
      </tr>
      {children}
    </>
  )
}

function CellContent({ s, single }: { s: ReturnType<typeof cellSummary>; single: boolean }) {
  const d = s.duties[0]
  return (
    <>
      {s.label ? (
        <span className="font-medium tabular-nums">
          {s.label}
          {single && d?.start != null && d.end != null && <span className="ml-1.5 font-normal text-muted-foreground">{clock(d.start)}–{clock(d.end)} · {d.lines.join(', ')}</span>}
        </span>
      ) : s.off ? (
        <span className="font-medium" title={s.offName}>{s.offLabel}</span>
      ) : s.absence ? (
        <span className="truncate block max-w-16 mx-auto" title={s.absence.label}>{s.absence.label.slice(0, single ? 30 : 5)}</span>
      ) : s.elsewhere ? (
        <span className="text-muted-foreground" title="Escalado em outra empresa ou função">⋯</span>
      ) : s.patternOff ? (
        <span title="Folga do regime (ainda não lançada)">f</span>
      ) : null}
      {s.locked && <Icons.Lock className="absolute left-0.5 top-0.5 w-2.5 h-2.5 text-muted-foreground" />}
      {s.window && <Icons.Clock className="absolute right-0.5 bottom-0.5 w-2.5 h-2.5 text-muted-foreground" />}
      {s.pending.length > 0 && <span className="absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" title="Pedido pendente" />}
      {s.changed && <span className="absolute left-0.5 bottom-0.5 w-1.5 h-1.5 rounded-full bg-sky-500" title="Alterado após a publicação" />}
    </>
  )
}

type Choice = { type: 'duty'; duty: RosterBoardDuty } | { type: 'off'; kind: 'DAY_OFF' | 'COMP_OFF'; absenceTypeId: string | null } | { type: 'clear' }

// the day's duties for a crew member (free ones first), plus day off / clear
function DutyPicker({ board, idx, pos, rect, onClose, onPick }: {
  board: RosterBoard; idx: BoardIndex; pos: GridPos; rect: DOMRect; onClose: () => void; onPick: (c: Choice) => void
}) {
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(0)
  const options = useMemo(() => {
    const duties = board.duties
      .filter(d => d.date === pos.date)
      .sort((a, b) => Number(!!a.crewMemberId) - Number(!!b.crewMemberId) || (a.start ?? 0) - (b.start ?? 0))
    const all: { key: string; label: string; detail: string; choice: Choice; taken?: string }[] = [
      // the day off types (system ones first)
      ...board.offTypes.map(t => ({ key: t.id, label: t.system ? (t.effect === 'COMP_OFF' ? 'FC' : 'F') : t.code, detail: t.name, choice: { type: 'off' as const, kind: t.effect, absenceTypeId: t.id } })),
      { key: '-', label: 'Limpar o dia', detail: '', choice: { type: 'clear' } },
      ...duties.map(d => ({
        key: d.id, label: dutyName(d, board.multiScope),
        detail: [d.start != null && d.end != null ? `${clock(d.start)}–${clock(d.end)}` : '', d.lines.join(', '), d.shiftId ? idx.shiftCode.get(d.shiftId) : ''].filter(Boolean).join(' · '),
        choice: { type: 'duty' as const, duty: d },
        taken: d.crewMemberId ? idx.memberById.get(d.crewMemberId)?.code ?? '?' : undefined,
      })),
    ]
    const s = q.trim().toLowerCase()
    return s ? all.filter(o => `${o.label} ${o.detail}`.toLowerCase().includes(s)) : all
  }, [board, idx, pos, q])

  const top = Math.min(rect.bottom + 4, window.innerHeight - 330)
  const left = Math.min(rect.left, window.innerWidth - 340)
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div className="fixed z-50 w-80 rounded-lg border border-border bg-popover shadow-lg" style={{ top, left }}>
        <input
          autoFocus value={q} placeholder="Tabela, horário ou linha…"
          onChange={e => { setQ(e.target.value); setCur(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCur(c => Math.min(options.length - 1, c + 1)) }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setCur(c => Math.max(0, c - 1)) }
            if (e.key === 'Enter' && options[cur]) { e.preventDefault(); onPick(options[cur].choice) }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
          }}
          className="w-full h-9 px-3 text-sm bg-transparent border-b border-border focus:outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1 text-sm">
          {options.map((o, i) => (
            <li
              key={o.key}
              onMouseEnter={() => setCur(i)}
              onMouseDown={(e) => { e.preventDefault(); onPick(o.choice) }}
              className={cn('flex items-baseline gap-2 px-3 py-1 cursor-pointer', i === cur && 'bg-accent text-accent-foreground')}
            >
              <span className="font-medium tabular-nums">{o.label}</span>
              <span className="text-xs text-muted-foreground truncate">{o.detail}</span>
              {o.taken && <span className="ml-auto text-[10px] text-muted-foreground">com {o.taken}</span>}
            </li>
          ))}
          {!options.length && <li className="px-3 py-2 text-xs text-muted-foreground">Nada encontrado</li>}
        </ul>
      </div>
    </>
  )
}
