'use client'

import { CREW_ROLES, type CrewRole } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { BoardDuty, CrewBoardData } from '../board.types'
import { fmtTime, parseTime, ROLE_LABEL, KIND_LABEL } from '../board.types'
import { EMPTY_FILTER, isFilterActive, type CrewFilter, type CrewView } from '../filters'

// Same look as the vehicle plan's BlockFilterBar; criteria adapt to the current view.

interface Props {
  view:       CrewView
  filter:     CrewFilter
  onChange:   (next: CrewFilter) => void
  matchCount: number
  operators:  CrewBoardData['operators']
  // lines the plan's trips run, in Scope order
  lineCodes:  string[]
  // "X" — closes the bar entirely (criteria + pins reset by the caller)
  onClose:    () => void
}

const selectCls = 'h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

export function CrewFilterBar({ view, filter, onChange, matchCount, operators, lineCodes, onClose }: Props) {
  const set = (patch: Partial<CrewFilter>) => onChange({ ...filter, ...patch })
  const active = isFilterActive(filter, view)
  const noun   = view === 'vehicles' ? (matchCount === 1 ? 'carro' : 'carros') : (matchCount === 1 ? 'jornada' : 'jornadas')

  return (
    <div
      style={{ animation: 'var(--animate-action-bar-in)' }}
      className="mx-auto w-fit flex flex-wrap items-center gap-2 px-2.5 py-1 bg-background border border-border rounded-lg shadow-lg text-xs"
    >
      <select value={filter.timeField} onChange={e => set({ timeField: e.target.value as CrewFilter['timeField'] })} className={selectCls}>
        <option value="start">Início</option>
        <option value="end">Término</option>
      </select>
      <select value={filter.timeRelation} onChange={e => set({ timeRelation: e.target.value as CrewFilter['timeRelation'] })} className={selectCls}>
        <option value="after">depois de</option>
        <option value="before">antes de</option>
      </select>
      <input
        type="time"
        value={filter.minutes != null ? fmtTime(filter.minutes % 1440) : ''}
        onChange={e => set({ minutes: e.target.value ? parseTime(e.target.value) : null })}
        className={selectCls}
      />

      <div className="w-px h-4 bg-border shrink-0" />

      <select value={filter.branchId ?? ''} onChange={e => set({ branchId: e.target.value || null })} className={selectCls}>
        <option value="">Operador</option>
        {operators.map(o => <option key={o.branchId} value={o.branchId}>{o.abbr}</option>)}
      </select>
      <select value={filter.lineCode ?? ''} onChange={e => set({ lineCode: e.target.value || null })} className={selectCls}>
        <option value="">Linha</option>
        {lineCodes.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      {view === 'vehicles' ? (
        <Chip on={filter.uncoveredOnly} onClick={() => set({ uncoveredOnly: !filter.uncoveredOnly })}>Sem motorista</Chip>
      ) : (
        <>
          <select value={filter.role ?? ''} onChange={e => set({ role: (e.target.value || null) as CrewRole | null })} className={selectCls}>
            <option value="">Papel</option>
            {CREW_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <select value={filter.kind ?? ''} onChange={e => set({ kind: (e.target.value || null) as BoardDuty['kind'] | null })} className={selectCls}>
            <option value="">Tipo</option>
            {(Object.keys(KIND_LABEL) as BoardDuty['kind'][]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <Chip on={filter.withIssues} onClick={() => set({ withIssues: !filter.withIssues })}>Com pendências</Chip>
          <Chip on={filter.staleOnly} onClick={() => set({ staleOnly: !filter.staleOnly })}>Desatualizadas</Chip>
          <Chip on={filter.multiLine} onClick={() => set({ multiLine: !filter.multiLine })}>Mais de uma linha</Chip>
        </>
      )}

      <div className="w-px h-4 bg-border shrink-0" />

      <span className="font-medium text-foreground whitespace-nowrap select-none">
        {active ? `${matchCount} ${noun}` : 'Defina um critério'}
      </span>

      {/* "Limpar" resets the criteria only — the bar stays open and pins are kept */}
      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTER)}
        className="flex items-center h-6 rounded px-2 font-medium transition-colors bg-muted hover:bg-muted/70 text-foreground"
      >
        Limpar
      </button>

      <button
        type="button"
        onClick={onClose}
        title="Fechar (limpa filtro e itens fixados)"
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
      >
        <Icons.X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-6 rounded px-2 font-medium transition-colors border',
        on ? 'bg-accent text-accent-foreground border-accent-foreground/40' : 'border-input text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

// Row pin toggle — same affordance as the vehicle plan's RowList (eye = pinned/visible).
export function PinToggle({ pinned, onToggle, noun }: { pinned: boolean; onToggle: () => void; noun: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      title={pinned ? `Desafixar ${noun} (some ao aplicar o filtro)` : `Fixar ${noun} (sempre visível, mesmo filtrado)`}
      className={cn('p-0.5 rounded', pinned ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
    >
      {pinned ? <Icons.Eye className="w-3.5 h-3.5" /> : <Icons.EyeOff className="w-3.5 h-3.5" />}
    </button>
  )
}
