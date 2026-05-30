'use client'

import type { DayTypePattern } from '@nyx/schemas'
import { cn } from '@/lib/utils'

const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
]

type PatternType = 'none' | 'weekdays' | 'month_window'

const TYPE_OPTIONS: { key: PatternType; label: string }[] = [
  { key: 'none',         label: 'Sem padrão'     },
  { key: 'weekdays',     label: 'Dias da semana'  },
  { key: 'month_window', label: 'Janela mensal'   },
]

const segmentBase = cn(
  'px-3 h-8 text-xs font-medium transition-colors',
  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
  'disabled:pointer-events-none disabled:opacity-50',
)

// ─── WeekdayPicker ───────────────────────────────────────────────────────────

interface WeekdayPickerProps {
  value:     number[]
  onChange:  (days: number[]) => void
  disabled?: boolean
}

function WeekdayPicker({ value, onChange, disabled }: WeekdayPickerProps) {
  function toggle(day: number) {
    const next = value.includes(day)
      ? value.filter((d) => d !== day)
      : [...value, day].sort((a, b) => a - b)
    onChange(next)
  }

  return (
    <div className="flex gap-1">
      {WEEKDAYS.map((d) => {
        const active = value.includes(d.value)
        return (
          <button
            key={d.value}
            type="button"
            disabled={disabled}
            onClick={() => toggle(d.value)}
            className={cn(
              'w-10 h-8 rounded-sm text-xs font-medium border transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
              'disabled:pointer-events-none disabled:opacity-50',
              active
                ? 'bg-accent text-accent-foreground border-accent'
                : 'bg-transparent border-input text-muted-foreground hover:bg-accent/20 hover:text-foreground',
            )}
          >
            {d.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── DayPatternInput ─────────────────────────────────────────────────────────

export interface DayPatternInputProps {
  value:     DayTypePattern | null | undefined
  onChange:  (val: DayTypePattern | null) => void
  disabled?: boolean
}

export function DayPatternInput({ value, onChange, disabled }: DayPatternInputProps) {
  const patternType: PatternType =
    value?.type === 'weekdays'     ? 'weekdays'     :
    value?.type === 'month_window' ? 'month_window' :
    'none'

  function selectType(t: PatternType) {
    if (t === 'none') {
      onChange(null)
    } else if (t === 'weekdays') {
      const current = patternType === 'weekdays' && value?.type === 'weekdays' ? value.days : [1, 2, 3, 4, 5]
      onChange({ type: 'weekdays', days: current })
    } else {
      const current = patternType === 'month_window' && value?.type === 'month_window'
        ? value
        : { type: 'month_window' as const, anchor: 'start' as const, days: 15, baseWeekdays: [1, 2, 3, 4, 5] }
      onChange(current)
    }
  }

  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div className="flex rounded-sm border border-input overflow-hidden w-fit">
        {TYPE_OPTIONS.map((opt, i) => (
          <button
            key={opt.key}
            type="button"
            disabled={disabled}
            onClick={() => selectType(opt.key)}
            className={cn(
              segmentBase,
              patternType === opt.key
                ? 'bg-accent text-accent-foreground'
                : 'bg-transparent text-muted-foreground hover:bg-accent/20 hover:text-foreground',
              i > 0 && 'border-l border-input',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Weekdays detail */}
      {patternType === 'weekdays' && value?.type === 'weekdays' && (
        <WeekdayPicker
          value={value.days}
          onChange={(days) => onChange({ type: 'weekdays', days })}
          disabled={disabled}
        />
      )}

      {/* Month window detail */}
      {patternType === 'month_window' && value?.type === 'month_window' && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground w-24">Âncora</span>
            <div className="flex rounded-sm border border-input overflow-hidden">
              {(['start', 'end'] as const).map((a, i) => (
                <button
                  key={a}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, anchor: a })}
                  className={cn(
                    segmentBase,
                    value.anchor === a
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-transparent text-muted-foreground hover:bg-accent/20 hover:text-foreground',
                    i > 0 && 'border-l border-input',
                  )}
                >
                  {a === 'start' ? 'Início' : 'Fim'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground w-24">Dias</span>
            <input
              type="number"
              min={1}
              max={31}
              disabled={disabled}
              value={value.days}
              onChange={(e) => {
                const n = Math.max(1, Math.min(31, Number(e.target.value) || 1))
                onChange({ ...value, days: n })
              }}
              className={cn(
                'w-20 h-8 rounded-sm border border-input bg-input-bg px-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring',
                'disabled:opacity-50',
              )}
            />
          </div>

          <div className="flex items-start gap-4">
            <span className="text-xs text-muted-foreground w-24 pt-1.5">Filtro de dia</span>
            <div className="space-y-1.5">
              <WeekdayPicker
                value={value.baseWeekdays ?? []}
                onChange={(days) => onChange({ ...value, baseWeekdays: days.length ? days : undefined })}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">Vazio = todos os dias da semana</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
