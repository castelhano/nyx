'use client'

import { useState } from 'react'
import { CREW_ROLES, type CrewRole } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
import type { BoardDuty, CrewBoardData } from '../board.types'
import { fmtTime, fmtDuration, parseTime, ROLE_LABEL, KIND_LABEL } from '../board.types'
import { EMPTY_FILTER, isFilterActive, addCondition, type CrewFilter, type CrewView, type ConditionField, type FilterCondition } from '../filters'

// Same look as the vehicle plan's BlockFilterBar; criteria adapt to the current view.

interface Props {
  view:       CrewView
  filter:     CrewFilter
  onChange:   (next: CrewFilter) => void
  matchCount: number
  operators:  CrewBoardData['operators']
  // lines the plan's trips run, sorted by code (numeric-aware)
  lineCodes:  string[]
  // "X" — closes the bar entirely (criteria + pins reset by the caller)
  onClose:    () => void
}

const selectCls = 'h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

const FIELD_LABEL: Record<ConditionField, string> = { start: 'Início', end: 'Término', duration: 'Duração' }
// time fields read as "after/before", the duration as "longer/shorter than"
const OP_LABEL: Record<ConditionField, Record<FilterCondition['op'], string>> = {
  start:    { gt: 'depois de', lt: 'antes de' },
  end:      { gt: 'depois de', lt: 'antes de' },
  duration: { gt: 'maior que', lt: 'menor que' },
}

function conditionText(c: FilterCondition): string {
  const value = c.field === 'duration' ? fmtDuration(c.minutes) : fmtTime(c.minutes % 1440)
  return `${FIELD_LABEL[c.field]} ${c.op === 'gt' ? '>' : '<'} ${value}`
}

// duty view on/off criteria, grouped in one dropdown to save room on the bar
const DUTY_FLAGS = [
  { key: 'withIssues', label: 'Com pendências' },
  { key: 'staleOnly',  label: 'Desatualizadas' },
  { key: 'multiLine',  label: 'Mais de uma linha' },
] as const

export function CrewFilterBar({ view, filter, onChange, matchCount, operators, lineCodes, onClose }: Props) {
  const set = (patch: Partial<CrewFilter>) => onChange({ ...filter, ...patch })
  const active = isFilterActive(filter, view)
  const flagsOn = DUTY_FLAGS.filter(f => filter[f.key]).length
  const noun   = view === 'vehicles' ? (matchCount === 1 ? 'carro' : 'carros') : (matchCount === 1 ? 'jornada' : 'jornadas')
  const removeCondition = (c: FilterCondition) => set({ conditions: filter.conditions.filter(x => x !== c) })

  return (
    <div
      style={{ animation: 'var(--animate-action-bar-in)' }}
      className="mx-auto w-fit flex flex-wrap items-center gap-2 px-2.5 py-1 bg-background border border-border rounded-lg shadow-lg text-xs"
    >
      <ConditionBuilder onAdd={c => set({ conditions: addCondition(filter.conditions, c) })} />

      {filter.conditions.map(c => (
        <span key={`${c.field}:${c.op}`} className="flex items-center gap-1 h-6 rounded bg-accent text-accent-foreground ps-2 pe-1 font-medium whitespace-nowrap">
          {conditionText(c)}
          <button type="button" title="Remover condição" onClick={() => removeCondition(c)} className="rounded p-0.5 hover:bg-background/40">
            <Icons.X className="w-3 h-3" />
          </button>
        </span>
      ))}

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
          <Dropdown
            align="start"
            trigger={
              <Chip on={flagsOn > 0}>
                <span className="flex items-center gap-1">
                  Situação{flagsOn > 0 && ` (${flagsOn})`}
                  <Icons.ChevronDown className="w-3 h-3" />
                </span>
              </Chip>
            }
          >
            {DUTY_FLAGS.map(f => (
              <DropdownItem key={f.key} keepOpen onClick={() => set({ [f.key]: !filter[f.key] })} className="text-xs">
                <Icons.Check className={cn('w-3.5 h-3.5', !filter[f.key] && 'invisible')} />
                {f.label}
              </DropdownItem>
            ))}
          </Dropdown>
        </>
      )}

      <div className="w-px h-4 bg-border shrink-0" />

      {active && (
        <span title={`${matchCount} ${noun}`} className="min-w-6 h-5 px-1.5 rounded-full bg-primary/15 text-primary text-center leading-5 font-semibold tabular-nums select-none">
          {matchCount}
        </span>
      )}

      {/* "Limpar" resets the criteria only — the bar stays open and pins are kept */}
      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTER)}
        title="Limpar critérios (mantém os itens fixados)"
        className="flex items-center justify-center w-6 h-6 rounded bg-muted hover:bg-muted/70 text-foreground"
      >
        <Icons.FilterX className="w-3.5 h-3.5" />
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

// field + relation + value; "+" or Enter adds it and clears the value (field/relation stay,
// so a range is two quick entries)
function ConditionBuilder({ onAdd }: { onAdd: (c: FilterCondition) => void }) {
  const [field, setField] = useState<ConditionField>('start')
  const [op, setOp]       = useState<FilterCondition['op']>('gt')
  const [value, setValue] = useState('')
  const minutes = parseTime(value)

  function add() {
    if (minutes == null) return
    onAdd({ field, op, minutes })
    setValue('')
  }

  return (
    <span className="flex items-center gap-1">
      <select value={field} onChange={e => setField(e.target.value as ConditionField)} className={selectCls}>
        {(Object.keys(FIELD_LABEL) as ConditionField[]).map(f => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
      </select>
      <select value={op} onChange={e => setOp(e.target.value as FilterCondition['op'])} className={selectCls}>
        <option value="gt">{OP_LABEL[field].gt}</option>
        <option value="lt">{OP_LABEL[field].lt}</option>
      </select>
      <input
        type="time"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className={selectCls}
      />
      <button
        type="button"
        onClick={add}
        disabled={minutes == null}
        title="Adicionar condição (Enter)"
        className="flex items-center justify-center w-6 h-6 rounded bg-muted hover:bg-muted/70 text-foreground disabled:opacity-40 disabled:pointer-events-none"
      >
        <Icons.Plus className="w-3.5 h-3.5" />
      </button>
    </span>
  )
}

// no onClick = a dropdown trigger (the Dropdown wrapper handles the click)
function Chip({ on, onClick, children }: { on: boolean; onClick?: () => void; children: React.ReactNode }) {
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
