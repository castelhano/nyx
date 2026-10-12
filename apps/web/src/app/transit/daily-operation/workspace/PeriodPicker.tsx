'use client'

import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { localToday } from '@/lib/plan-vigence'
import { addDays, periodOf, weekday, type Mode } from './board'

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const WEEK_HEAD = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']

const monthStart = (d: string) => `${d.slice(0, 7)}-01`
function addMonths(d: string, n: number): string {
  const x = new Date(`${monthStart(d)}T00:00:00Z`)
  x.setUTCMonth(x.getUTCMonth() + n)
  return x.toISOString().slice(0, 10)
}

// The period label that opens a calendar: on "dia" a click picks the day, on "semana" the week
// (the row, Monday to Sunday), on "mês" the month (a year of months) — `onPick` gets a date
// inside it.
export function PeriodPicker({ mode, date, label, onPick }: { mode: Mode; date: string; label: string; onPick: (date: string) => void }) {
  const [open, setOpen] = useState(false)
  // the month (or, on "mês", the year) shown
  const [view, setView] = useState(monthStart(date))
  const [hover, setHover] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const toggle = () => { if (!open) setView(monthStart(date)); setOpen(o => !o) }
  const pick = (d: string) => { onPick(d); setOpen(false) }
  const today = localToday()
  const selected = periodOf(mode, date)
  const hovered = hover ? periodOf(mode, hover) : null
  const inside = (d: string, p: { from: string; to: string } | null) => !!p && d >= p.from && d <= p.to

  // the month's weeks, Monday first
  const first = addDays(view, -((weekday(view) + 6) % 7))
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(first, w * 7 + i)))
    .filter(w => w[0].slice(0, 7) === view.slice(0, 7) || w[6].slice(0, 7) === view.slice(0, 7))
  const year = view.slice(0, 4)

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} className="h-8 px-2 text-sm font-medium tabular-nums w-32 text-center rounded hover:bg-muted cursor-pointer" title="Escolher no calendário">
        {label}
      </button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-9 z-30 w-64 rounded-lg border border-border bg-card p-2 shadow-xl" onMouseLeave={() => setHover(null)}>
          <div className="flex items-center mb-1">
            <button type="button" onClick={() => setView(addMonths(view, mode === 'mes' ? -12 : -1))} className="p-1 rounded hover:bg-muted cursor-pointer"><Icons.ChevronLeft className="w-4 h-4" /></button>
            <span className="flex-1 text-center text-sm font-medium">{mode === 'mes' ? year : `${MONTH_NAMES[Number(view.slice(5, 7)) - 1]} ${year}`}</span>
            <button type="button" onClick={() => setView(addMonths(view, mode === 'mes' ? 12 : 1))} className="p-1 rounded hover:bg-muted cursor-pointer"><Icons.ChevronRight className="w-4 h-4" /></button>
          </div>
          {mode === 'mes' ? (
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((m, i) => {
                const d = `${year}-${String(i + 1).padStart(2, '0')}-01`
                return (
                  <button key={m} type="button" onClick={() => pick(d)}
                    className={cn('h-9 rounded text-sm cursor-pointer', d === monthStart(date) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted', d === monthStart(today) && d !== monthStart(date) && 'ring-1 ring-primary/60')}>
                    {m}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="text-xs">
              <div className="grid grid-cols-7 text-center text-muted-foreground mb-0.5">{WEEK_HEAD.map((w, i) => <span key={i}>{w}</span>)}</div>
              {weeks.map(w => (
                <div key={w[0]} className="grid grid-cols-7">
                  {w.map(d => {
                    const sel = inside(d, selected), hov = inside(d, hovered)
                    return (
                      <button key={d} type="button" onClick={() => pick(d)} onMouseEnter={() => setHover(d)}
                        className={cn(
                          'h-8 tabular-nums cursor-pointer',
                          mode === 'dia' ? 'rounded' : 'first:rounded-l last:rounded-r',
                          sel ? 'bg-primary text-primary-foreground' : hov ? 'bg-muted' : '',
                          d.slice(0, 7) !== view.slice(0, 7) && !sel && 'text-muted-foreground/50',
                          d === today && !sel && 'font-semibold text-primary',
                        )}>
                        {Number(d.slice(8, 10))}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => pick(today)} className="mt-1 w-full h-7 rounded text-xs text-muted-foreground hover:bg-muted cursor-pointer">Hoje</button>
        </div>
      )}
    </div>
  )
}
