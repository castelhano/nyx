'use client'

import { useState } from 'react'
import { Icons } from '@/lib/icons'
import { minutesToLabel, labelToMinutes } from '../line-generator-logic'
import type { BlockFilter } from '../hooks/useGanttEditor'

interface Props {
  filter:     BlockFilter | null
  onChange:   (next: BlockFilter | null) => void
  matchCount: number
  // the empresas the plan's blocks belong to
  branches:   { id: string; name: string }[]
  // the depots the plan's blocks belong to
  depots:     { id: string; name: string }[]
  // "X" — closes the bar entirely; a deliberate full reset (criteria + pins),
  // handled by the caller alongside unmounting this component.
  onClose:    () => void
}

export function BlockFilterBar({ filter, onChange, matchCount, branches, depots, onClose }: Props) {
  const [field,     setField]     = useState<BlockFilter['field']>(filter?.field ?? 'start')
  const [relation,  setRelation]  = useState<BlockFilter['relation']>(filter?.relation ?? 'after')
  const [timeLabel, setTimeLabel] = useState(filter?.minutes != null ? minutesToLabel(filter.minutes) : '')
  const [issuesOnly, setIssuesOnly] = useState(filter?.issuesOnly ?? false)
  const [branchId,  setBranchId]  = useState(filter?.branchId ?? '')
  const [depotId,   setDepotId]   = useState(filter?.depotId ?? '')

  // The time criterion only kicks in once all three fields have a value — field/relation
  // always do (defaults above), so the time input is the actual gate. "Com pendências",
  // the empresa and the depot work alone or combined with it. The encaixe window (fit) is set from the Gantt
  // selection ("Filtrar encaixes"), never here — only kept or removed.
  function commit(nextField: BlockFilter['field'], nextRelation: BlockFilter['relation'], nextTimeLabel: string, nextIssuesOnly = issuesOnly, nextBranchId = branchId, nextFit = filter?.fit ?? null, nextDepotId = depotId) {
    setField(nextField); setRelation(nextRelation); setTimeLabel(nextTimeLabel); setIssuesOnly(nextIssuesOnly); setBranchId(nextBranchId); setDepotId(nextDepotId)
    onChange(nextTimeLabel || nextIssuesOnly || nextBranchId || nextDepotId || nextFit
      ? { field: nextField, relation: nextRelation, minutes: nextTimeLabel ? labelToMinutes(nextTimeLabel) : null, issuesOnly: nextIssuesOnly, branchId: nextBranchId || null, depotId: nextDepotId || null, fit: nextFit }
      : null)
  }

  // The bar must never keep the keyboard: arrows on a focused select/time input change its value
  // instead of moving the Gantt focus. Selects let go once picked; the time applies on Enter
  // (which lets go too) or when leaving the field — not on every keystroke.
  const release = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur()

  function commitTime(label: string) {
    if (label !== (filter?.minutes != null ? minutesToLabel(filter.minutes) : '')) commit(field, relation, label)
  }

  // "Limpar" — resets the criteria only. Bar stays open (unlike "X"), pins
  // untouched, so refining a search never loses what was already marked to
  // keep. The local field/relation/time selections need an explicit reset
  // back to defaults since the component doesn't unmount here.
  function handleClear() {
    setField('start'); setRelation('after'); setTimeLabel(''); setIssuesOnly(false); setBranchId(''); setDepotId('')
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
      {branches.length > 1 && (
        <select
          value={branchId}
          onChange={e => { commit(field, relation, timeLabel, issuesOnly, e.target.value); release(e) }}
          className="h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Todas as empresas</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}

      {depots.length > 1 && (
        <select
          value={depotId}
          onChange={e => { commit(field, relation, timeLabel, issuesOnly, branchId, filter?.fit ?? null, e.target.value); release(e) }}
          className="h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Todos os depósitos</option>
          {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}

      <select
        value={field}
        onChange={e => { commit(e.target.value as BlockFilter['field'], relation, timeLabel); release(e) }}
        className="h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="start">Início</option>
        <option value="end">Término</option>
      </select>

      <select
        value={relation}
        onChange={e => { commit(field, e.target.value as BlockFilter['relation'], timeLabel); release(e) }}
        className="h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="after">depois de</option>
        <option value="before">antes de</option>
      </select>

      <input
        type="time"
        value={timeLabel}
        onChange={e => setTimeLabel(e.target.value)}
        onBlur={e => commitTime(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); release(e) } }}
        title="Enter aplica o filtro e volta ao grid"
        className="h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />

      <button
        onClick={() => commit(field, relation, timeLabel, !issuesOnly)}
        title="Carros com erros de lançamento (sem acesso, parado sem intervalo, local diferente...)"
        className={[
          'flex items-center gap-1 h-6 rounded px-2 font-medium transition-colors',
          issuesOnly ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/40' : 'bg-muted hover:bg-muted/70 text-foreground',
        ].join(' ')}
      >
        <Icons.AlertTriangle className="w-3.5 h-3.5" />
        Com pendências
      </button>

      {filter?.fit && (
        <span
          title="Carros sem viagem produtiva neste horário — onde a seleção cabe"
          className="flex items-center gap-1 h-6 rounded pl-2 pr-1 font-medium bg-primary/10 text-primary ring-1 ring-primary/30 whitespace-nowrap"
        >
          Encaixe {minutesToLabel(filter.fit.start)}–{minutesToLabel(filter.fit.end)}
          <button
            onClick={() => commit(field, relation, timeLabel, issuesOnly, branchId, null)}
            title="Remover encaixe"
            className="flex items-center justify-center w-4 h-4 rounded hover:bg-primary/20"
          >
            <Icons.X className="w-3 h-3" />
          </button>
        </span>
      )}

      <div className="w-px h-4 bg-border shrink-0" />

      <span className="font-medium text-foreground whitespace-nowrap select-none">
        {filter ? `${matchCount} ${matchCount === 1 ? 'bloco' : 'blocos'}` : 'Selecione um filtro'}
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
