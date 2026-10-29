'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { WEEKDAY, clock, dutyName, fmtDay, noteText, reveal, shortName, weekday, type BoardIndex, type RosterBoard, type RosterBoardDuty } from './board'

// "Escalas" — the duties: one day as a timeline (pieces as bars, operator and car per row),
// several days as a duty × day matrix (who holds each duty each day). A click selects the duty
// for the side panel; arrows move the selection.

interface Props {
  board:      RosterBoard
  idx:        BoardIndex
  dates:      string[]
  duties:     RosterBoardDuty[]
  selectedId: string | null
  onSelect:   (dutyId: string) => void
}

// a stable color per line code
const PALETTE = ['bg-sky-500/70', 'bg-emerald-500/70', 'bg-amber-500/70', 'bg-violet-500/70', 'bg-rose-500/70', 'bg-teal-500/70', 'bg-orange-500/70', 'bg-indigo-500/70']
const lineColor = (code: string | null) => {
  if (!code) return 'bg-muted-foreground/40'
  let h = 0
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function DutiesView(props: Props) {
  return props.dates.length === 1 ? <Timeline {...props} /> : <Matrix {...props} />
}

function useArrowKeys(ref: React.RefObject<HTMLDivElement | null>, selectedId: string | null) {
  useEffect(() => {
    if (selectedId) reveal(ref.current, ref.current?.querySelector(`[data-duty="${selectedId}"]`))
  }, [ref, selectedId])
}

function Timeline({ board, idx, duties, selectedId, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useArrowKeys(ref, selectedId)
  // duties first (without anyone on top), then the plantões
  const rows = useMemo(() => [...duties].sort((a, b) =>
    Number(a.kind === 'STANDBY') - Number(b.kind === 'STANDBY') || Number(!!a.crewMemberId) - Number(!!b.crewMemberId) || (a.start ?? 0) - (b.start ?? 0)), [duties])
  const lo = Math.floor(Math.min(...rows.map(d => d.start ?? 1440), 300) / 60) * 60
  const hi = Math.ceil(Math.max(...rows.map(d => d.end ?? 0), lo + 600) / 60) * 60
  const pct = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`
  const hours = Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => lo + i * 60)

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = rows.findIndex(r => r.id === selectedId)
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) onSelect(next.id)
  }

  return (
    <div ref={ref} tabIndex={0} onKeyDown={onKeyDown} className="overflow-auto rounded-lg border border-border max-h-[calc(100vh-15rem)] focus:outline-none focus:ring-1 focus:ring-ring">
      <div className="min-w-[56rem]">
        <div data-sticky-top className="sticky top-0 z-10 grid grid-cols-[16rem_1fr] bg-background border-b border-border text-[10px] text-muted-foreground">
          <div className="px-2 py-1">Tabela · operador · carro</div>
          <div className="relative h-6">
            {hours.map(h => <span key={h} className="absolute -translate-x-1/2 top-1 tabular-nums" style={{ left: pct(h) }}>{clock(h).slice(0, 2)}</span>)}
          </div>
        </div>
        {rows.map(d => {
          const member = d.crewMemberId ? idx.memberById.get(d.crewMemberId) : null
          return (
            <div
              key={d.id} data-duty={d.id} onClick={() => onSelect(d.id)}
              className={cn('grid grid-cols-[16rem_1fr] border-b border-border/60 cursor-pointer hover:bg-muted/40', d.kind === 'STANDBY' && 'bg-cyan-500/5', selectedId === d.id && 'bg-accent/40')}
            >
              <div className="flex items-center gap-1.5 px-2 py-1 text-xs min-w-0">
                <span className={cn('font-medium tabular-nums shrink-0', board.multiScope ? 'w-14' : 'w-8', d.kind === 'STANDBY' && 'text-cyan-700 dark:text-cyan-300')}>{dutyName(d, board.multiScope)}</span>
                <span className="text-muted-foreground w-7 shrink-0">{d.shiftId ? idx.shiftCode.get(d.shiftId) : '—'}</span>
                {member
                  ? <>
                    <span className="tabular-nums text-muted-foreground shrink-0">{member.code}</span>
                    <span className="truncate" title={member.name}>{shortName(member.name)}</span>
                  </>
                  : <span className="text-red-600 dark:text-red-400">sem operador</span>}
                {d.locked && <Icons.Lock className="w-3 h-3 shrink-0 text-muted-foreground" />}
                {d.preferred.length > 0 && (
                  <span title={`Fixo: ${d.preferred.map((id, i) => `${i + 1}º ${idx.memberById.get(id)?.code ?? '?'}`).join(', ')}`} className={cn('text-[10px] shrink-0', d.crewMemberId === d.preferred[0] ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400')}>★</span>
                )}
                <span className="ml-auto flex gap-1 shrink-0">
                  {d.blocks.map(b => (
                    <span key={b.id} className={cn('rounded-sm px-1 text-[10px] tabular-nums', b.vehicleCode ? 'bg-muted' : 'border border-dashed border-red-500/60 text-red-600 dark:text-red-400')} title={`Carro ${b.number}`}>
                      {b.vehicleCode ?? `c${b.number}`}
                    </span>
                  ))}
                  {(d.issues.some(i => i.severity !== 'info') || d.blocks.some(b => b.issues.length))
                    ? <Icons.AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                    : d.issues.some(i => i.severity === 'info') && (
                      <span title={d.issues.filter(i => i.severity === 'info').map(noteText).join('\n')}><Icons.Info className="w-3.5 h-3.5 text-amber-500/80" /></span>
                    )}
                </span>
              </div>
              <div className="relative h-7">
                {hours.map(h => <span key={h} className="absolute top-0 bottom-0 border-l border-border/40" style={{ left: pct(h) }} />)}
                {d.kind === 'STANDBY' && d.start != null && d.end != null && (
                  <span
                    className="absolute top-1.5 bottom-1.5 rounded-sm px-1 text-[10px] leading-4 truncate border border-dashed border-cyan-600/70 bg-cyan-500/20 text-cyan-800 dark:text-cyan-200"
                    style={{ left: pct(d.start), width: `calc(${pct(d.end)} - ${pct(d.start)})` }}
                    title={`Plantão ${clock(d.start)}–${clock(d.end)}`}
                  >
                    Plantão
                  </span>
                )}
                {d.pieces.map((p, i) => (
                  <span
                    key={i}
                    className={cn('absolute top-1.5 bottom-1.5 rounded-sm px-1 text-[10px] leading-4 text-white truncate', lineColor(p.line))}
                    style={{ left: pct(p.start), width: `calc(${pct(p.end)} - ${pct(p.start)})` }}
                    title={`${clock(p.start)}–${clock(p.end)} · ${p.line ?? ''}`}
                  >
                    {p.line}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
        {!rows.length && <p className="px-3 py-6 text-sm text-muted-foreground">Nenhuma tabela no dia — gere a escala para criar o dia.</p>}
      </div>
    </div>
  )
}

function Matrix({ board, idx, dates, duties, selectedId, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useArrowKeys(ref, selectedId)
  // rows = duty numbers (per Scope); each day's duty of that number in the cells
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; label: string; standby: boolean; byDate: Map<string, RosterBoardDuty> }>()
    for (const d of duties) {
      const key = `${d.scope}|${String(d.number).padStart(4, '0')}`
      const r = map.get(key) ?? { key, label: dutyName(d, board.multiScope), standby: d.kind === 'STANDBY', byDate: new Map() }
      r.byDate.set(d.date, d)
      map.set(key, r)
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [duties, board.multiScope])
  const sel = selectedId ? idx.dutyById.get(selectedId) : null

  function onKeyDown(e: React.KeyboardEvent) {
    const delta = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[e.key]
    if (!delta) return
    e.preventDefault()
    let r = sel ? rows.findIndex(x => x.byDate.get(sel.date)?.id === sel.id) : 0
    let c = sel ? dates.indexOf(sel.date) : 0
    // skip cells without a duty
    for (let k = 0; k < Math.max(rows.length, dates.length); k++) {
      r = Math.max(0, Math.min(rows.length - 1, r + delta[0]))
      c = Math.max(0, Math.min(dates.length - 1, c + delta[1]))
      const d = rows[r]?.byDate.get(dates[c])
      if (d) return onSelect(d.id)
    }
  }

  return (
    <div ref={ref} tabIndex={0} onKeyDown={onKeyDown} className="overflow-auto rounded-lg border border-border max-h-[calc(100vh-15rem)] focus:outline-none focus:ring-1 focus:ring-ring">
      <table className="text-xs border-separate border-spacing-0">
        <thead data-sticky-top className="sticky top-0 z-20 bg-background">
          <tr>
            <th data-sticky-left className="sticky left-0 z-30 bg-background border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground">Tabela</th>
            {dates.map(d => (
              <th key={d} className={cn('border-b border-border px-1 py-1 font-medium min-w-[3.25rem]', weekday(d) % 6 === 0 ? 'text-foreground' : 'text-muted-foreground')}>
                <div>{WEEKDAY[weekday(d)]}</div>
                <div className="tabular-nums">{fmtDay(d)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td className={cn('sticky left-0 z-10 bg-background border-b border-border/60 px-2 py-1 font-medium tabular-nums whitespace-nowrap', r.standby && 'text-cyan-700 dark:text-cyan-300')}>{r.label}</td>
              {dates.map(date => {
                const d = r.byDate.get(date)
                const m = d?.crewMemberId ? idx.memberById.get(d.crewMemberId) : null
                const bad = !!d && (d.issues.some(i => i.severity !== 'info') || d.blocks.some(b => b.issues.length > 0))
                const notes = d ? d.issues.filter(i => i.severity === 'info').map(noteText) : []
                return (
                  <td
                    key={date} data-duty={d?.id} onClick={() => d && onSelect(d.id)}
                    title={d ? [`${d.start != null ? clock(d.start) : ''}–${d.end != null ? clock(d.end) : ''} · ${d.lines.join(', ')}${m ? ` · ${m.name}` : ''}`, ...notes].join('\n') : undefined}
                    className={cn(
                      'relative border-b border-l border-border/60 px-1 py-1 text-center tabular-nums',
                      d ? 'cursor-pointer' : 'bg-muted/20',
                      d?.kind === 'STANDBY' && m && 'bg-cyan-500/10 text-cyan-800 dark:text-cyan-200',
                      bad && 'bg-red-500/10',
                      d && !m && 'text-red-600 dark:text-red-400',
                      selectedId === d?.id && d && 'ring-2 ring-inset ring-primary',
                    )}
                  >
                    {d ? (m ? m.code : '—') : ''}
                    {notes.length > 0 && !bad && <span className="absolute right-0.5 bottom-0.5 w-1.5 h-1.5 rounded-full border border-amber-500" />}
                    {d?.locked && <Icons.Lock className="absolute left-0.5 top-0.5 w-2.5 h-2.5 text-muted-foreground" />}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="px-3 py-6 text-sm text-muted-foreground">Nenhuma tabela no período — gere a escala para criar os dias.</p>}
    </div>
  )
}
