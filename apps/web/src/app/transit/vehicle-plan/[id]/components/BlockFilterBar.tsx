'use client'

import { useState } from 'react'
import { Icons } from '@/lib/icons'
import { minutesToLabel, labelToMinutes } from '../line-generator-logic'
import type { BlockFilter } from '../hooks/useGanttEditor'

interface Props {
  filter:     BlockFilter | null
  onChange:   (next: BlockFilter | null) => void
  matchCount: number
  // "X" — closes the bar entirely; a deliberate full reset (criteria + pins),
  // handled by the caller alongside unmounting this component.
  onClose:    () => void
}

export function BlockFilterBar({ filter, onChange, matchCount, onClose }: Props) {
  const [field,     setField]     = useState<BlockFilter['field']>(filter?.field ?? 'start')
  const [relation,  setRelation]  = useState<BlockFilter['relation']>(filter?.relation ?? 'after')
  const [timeLabel, setTimeLabel] = useState(filter ? minutesToLabel(filter.minutes) : '')

  // The filter only kicks in once all three fields have a value — field/relation
  // always do (defaults above), so the time input is the actual gate.
  function commit(nextField: BlockFilter['field'], nextRelation: BlockFilter['relation'], nextTimeLabel: string) {
    setField(nextField); setRelation(nextRelation); setTimeLabel(nextTimeLabel)
    onChange(nextTimeLabel ? { field: nextField, relation: nextRelation, minutes: labelToMinutes(nextTimeLabel) } : null)
  }

  // "Limpar" — resets the criteria only. Bar stays open (unlike "X"), pins
  // untouched, so refining a search never loses what was already marked to
  // keep. The local field/relation/time selections need an explicit reset
  // back to defaults since the component doesn't unmount here.
  function handleClear() {
    setField('start'); setRelation('after'); setTimeLabel('')
    onChange(null)
  }

  return (
    <div
      style={{ animation: 'var(--animate-action-bar-in)' }}
      // Kept compact enough (h-8 row) to sit fully inside the 40px ruler strip
      // above the Gantt rows (GanttBoard's RULER_HEIGHT) — anything taller
      // would spill onto the first row of trips and get in the way of
      // selection/editing there.
      className="absolute top-1 inset-x-0 mx-auto w-fit z-20 flex items-center gap-2 px-2.5 py-1 bg-background border border-border rounded-lg shadow-lg text-xs"
    >
      <select
        value={field}
        onChange={e => commit(e.target.value as BlockFilter['field'], relation, timeLabel)}
        className="h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="start">Início</option>
        <option value="end">Término</option>
      </select>

      <select
        value={relation}
        onChange={e => commit(field, e.target.value as BlockFilter['relation'], timeLabel)}
        className="h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="after">depois de</option>
        <option value="before">antes de</option>
      </select>

      <input
        type="time"
        value={timeLabel}
        onChange={e => commit(field, relation, e.target.value)}
        className="h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />

      <div className="w-px h-4 bg-border shrink-0" />

      <span className="font-medium text-foreground whitespace-nowrap select-none">
        {filter ? `${matchCount} ${matchCount === 1 ? 'bloco' : 'blocos'}` : 'Selecione um horário'}
      </span>

      <button
        onClick={handleClear}
        className="flex items-center h-6 rounded px-2 font-medium transition-colors bg-muted hover:bg-muted/70 text-foreground"
      >
        Limpar
      </button>

      <button
        onClick={onClose}
        title="Fechar (limpa filtro e blocos fixados)"
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
      >
        <Icons.X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
