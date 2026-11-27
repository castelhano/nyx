'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { dayTypeOfDay, type DayTypeOption } from './cycle-utils'

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const WEEK_HEAD   = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']

interface DayTypeWithColor extends DayTypeOption {
  name:   string
  color?: string | null
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// 0 = Monday .. 6 = Sunday
const weekCol = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7

// The CSV's days as month calendars: a click toggles a day, a weekday header toggles that
// weekday across the period. Days without trips in the CSV are shown but can't be picked.
export function DayFilter({ days, selected, dayTypes, onChange }: {
  days:     string[]
  selected: Set<string>
  dayTypes: DayTypeWithColor[]
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (days.length === 0) return null

  const available = new Set(days)
  const months    = Array.from(new Set(days.map(d => d.slice(0, 7))))

  const toggleDay = (d: string) => {
    const next = new Set(selected)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    onChange(next)
  }

  const toggleWeekday = (col: number) => {
    const ofCol  = days.filter(d => weekCol(d) === col)
    const allOn  = ofCol.every(d => selected.has(d))
    const next   = new Set(selected)
    for (const d of ofCol) {
      if (allOn) next.delete(d)
      else next.add(d)
    }
    onChange(next)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Dias considerados na análise"
        className={cn(
          'h-8 px-2 text-sm tabular-nums rounded-sm border border-input bg-input-bg hover:bg-muted cursor-pointer',
          selected.size === 0 && 'text-destructive',
        )}
      >
        {selected.size} de {days.length} dias
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-30 w-64 rounded-lg border border-border bg-card p-2 shadow-xl space-y-3 max-h-[70vh] overflow-y-auto">
          {months.map(month => {
            const start = `${month}-01`
            const first = addDays(start, -weekCol(start))
            const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(first, w * 7 + i)))
              .filter(w => w.some(d => d.slice(0, 7) === month))

            return (
              <div key={month} className="text-xs">
                <div className="text-center text-sm font-medium mb-1">
                  {MONTH_NAMES[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
                </div>
                <div className="grid grid-cols-7 text-center text-muted-foreground mb-0.5">
                  {WEEK_HEAD.map((w, i) => (
                    <button key={i} type="button" onClick={() => toggleWeekday(i)} className="h-6 rounded hover:bg-muted cursor-pointer" title="Marcar/desmarcar este dia da semana">
                      {w}
                    </button>
                  ))}
                </div>
                {weeks.map(w => (
                  <div key={w[0]} className="grid grid-cols-7 gap-px">
                    {w.map(d => {
                      if (d.slice(0, 7) !== month) return <span key={d} />
                      const has = available.has(d)
                      const on  = selected.has(d)
                      const dt  = has ? dayTypeOfDay(d, dayTypes) : null
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={!has}
                          onClick={() => toggleDay(d)}
                          title={dt ? dt.name : undefined}
                          className={cn(
                            'h-8 rounded tabular-nums border-b-2',
                            !has && 'text-muted-foreground/40 border-transparent cursor-default',
                            has && 'cursor-pointer',
                            has && (on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'),
                          )}
                          style={has ? { borderBottomColor: dt?.color ?? 'transparent' } : undefined}
                        >
                          {Number(d.slice(8, 10))}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}

          <div className="flex gap-1">
            <button type="button" onClick={() => onChange(new Set(days))} className="flex-1 h-7 rounded text-xs text-muted-foreground hover:bg-muted cursor-pointer">Todos</button>
            <button type="button" onClick={() => onChange(new Set())} className="flex-1 h-7 rounded text-xs text-muted-foreground hover:bg-muted cursor-pointer">Nenhum</button>
          </div>
        </div>
      )}
    </div>
  )
}
