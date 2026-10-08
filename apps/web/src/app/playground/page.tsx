'use client'

// Prototype — crew plan filter bar with a condition builder (field + relation + value, then
// "+"). Each condition becomes a removable chip and they combine with AND, so the bar's
// width doesn't grow with the number of criteria. Synthetic data, no fetch; the real bar is
// app/transit/crew-plan/[id]/components/CrewFilterBar.tsx.

import { useMemo, useState } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'

// ── conditions ───────────────────────────────────────────────────────────────

type View  = 'vehicles' | 'duties'
type Field = 'start' | 'end' | 'duration'
type Op    = 'gt' | 'lt'

interface Condition { field: Field; op: Op; minutes: number }

const FIELD_LABEL: Record<Field, string> = { start: 'Início', end: 'Término', duration: 'Duração' }
// time fields read as "after/before", the duration as "longer/shorter than"
const OP_LABEL: Record<Field, Record<Op, string>> = {
  start:    { gt: 'depois de',  lt: 'antes de' },
  end:      { gt: 'depois de',  lt: 'antes de' },
  duration: { gt: 'maior que',  lt: 'menor que' },
}

const fmtTime     = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fmtDuration = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`
const parseTime   = (s: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  return match && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null
}

function chipText(c: Condition): string {
  const value = c.field === 'duration' ? fmtDuration(c.minutes) : fmtTime(c.minutes)
  return `${FIELD_LABEL[c.field]} ${c.op === 'gt' ? '>' : '<'} ${value}`
}

// same field + same relation replaces; the opposite relation is kept (a range: > 6h and < 8h)
function addCondition(list: Condition[], c: Condition): Condition[] {
  return [...list.filter(x => !(x.field === c.field && x.op === c.op)), c]
}

// ── synthetic rows ───────────────────────────────────────────────────────────

interface Row {
  id:       string
  label:    string
  start:    number
  end:      number
  // duties: summary.workMinutes; vehicles: the block window's length
  duration: number
  branch:   string
  lines:    string[]
  issues:   boolean
  stale:    boolean
}

const LINES    = ['032', '101', '301', 'A01', 'B12']
const BRANCHES = ['VCG', 'TRP']

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
}

function makeRows(view: View): Row[] {
  const rand = rng(view === 'duties' ? 7 : 13)
  return Array.from({ length: view === 'duties' ? 60 : 40 }, (_, i) => {
    const start  = 240 + Math.floor(rand() * 900)
    const spread = (view === 'duties' ? 300 : 360) + Math.floor(rand() * 480)
    const work   = view === 'duties' ? Math.min(spread, 360 + Math.floor(rand() * 240)) : spread
    const lines  = LINES.filter(() => rand() < 0.3)
    return {
      id:       `${view}-${i}`,
      label:    view === 'duties' ? `M${String(i + 1).padStart(3, '0')}` : `Carro ${i + 1}`,
      start, end: start + spread, duration: work,
      branch:   BRANCHES[Math.floor(rand() * BRANCHES.length)],
      lines:    lines.length ? lines : [LINES[i % LINES.length]],
      issues:   rand() < 0.2,
      stale:    rand() < 0.1,
    }
  })
}

// ── page ─────────────────────────────────────────────────────────────────────

const DUTY_FLAGS = [
  { key: 'issues', label: 'Com pendências' },
  { key: 'stale',  label: 'Desatualizadas' },
  { key: 'multi',  label: 'Mais de uma linha' },
] as const
type FlagKey = typeof DUTY_FLAGS[number]['key']

const selectCls = 'h-6 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

export default function PlaygroundPage() {
  const [view, setView]             = useState<View>('duties')
  const [conditions, setConditions] = useState<Condition[]>([])
  const [branch, setBranch]         = useState('')
  const [line, setLine]             = useState('')
  const [flags, setFlags]           = useState<Record<FlagKey, boolean>>({ issues: false, stale: false, multi: false })

  const rows = useMemo(() => makeRows(view), [view])

  const visible = rows.filter(r =>
    conditions.every(c => (c.op === 'gt' ? r[c.field] > c.minutes : r[c.field] < c.minutes))
    && (!branch || r.branch === branch)
    && (!line || r.lines.includes(line))
    && (view === 'vehicles' || ((!flags.issues || r.issues) && (!flags.stale || r.stale) && (!flags.multi || r.lines.length > 1))))

  const flagsOn = view === 'duties' ? DUTY_FLAGS.filter(f => flags[f.key]).length : 0
  const active  = conditions.length > 0 || !!branch || !!line || flagsOn > 0
  const noun    = view === 'vehicles' ? (visible.length === 1 ? 'carro' : 'carros') : (visible.length === 1 ? 'jornada' : 'jornadas')

  function clear() {
    setConditions([]); setBranch(''); setLine('')
    setFlags({ issues: false, stale: false, multi: false })
  }

  return (
    <div className="p-6 space-y-4 h-full overflow-auto">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Protótipo — filtro da escala</h1>
        <div className="flex rounded border border-border text-xs overflow-hidden">
          {(['vehicles', 'duties'] as const).map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={cn('px-3 py-1', view === v ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
              {v === 'vehicles' ? 'Carros' : 'Jornadas'}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{ animation: 'var(--animate-action-bar-in)' }}
        className="mx-auto w-fit max-w-full flex flex-wrap items-center gap-2 px-2.5 py-1 bg-background border border-border rounded-lg shadow-lg text-xs"
      >
        <ConditionBuilder onAdd={c => setConditions(list => addCondition(list, c))} />

        {conditions.map(c => (
          <span key={`${c.field}:${c.op}`} className="flex items-center gap-1 h-6 rounded bg-accent text-accent-foreground ps-2 pe-1 font-medium whitespace-nowrap">
            {chipText(c)}
            <button
              type="button"
              title="Remover condição"
              onClick={() => setConditions(list => list.filter(x => x !== c))}
              className="rounded p-0.5 hover:bg-background/40"
            >
              <Icons.X className="w-3 h-3" />
            </button>
          </span>
        ))}

        <div className="w-px h-4 bg-border shrink-0" />

        <select value={branch} onChange={e => setBranch(e.target.value)} className={selectCls}>
          <option value="">Operador</option>
          {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={line} onChange={e => setLine(e.target.value)} className={selectCls}>
          <option value="">Linha</option>
          {LINES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {view === 'duties' && (
          <Dropdown
            align="start"
            trigger={
              <button type="button" className={cn(
                'flex items-center gap-1 h-6 rounded px-2 font-medium transition-colors border',
                flagsOn ? 'bg-accent text-accent-foreground border-accent-foreground/40' : 'border-input text-muted-foreground hover:bg-muted',
              )}>
                Situação{flagsOn > 0 && ` (${flagsOn})`}
                <Icons.ChevronDown className="w-3 h-3" />
              </button>
            }
          >
            {DUTY_FLAGS.map(f => (
              <DropdownItem key={f.key} keepOpen onClick={() => setFlags(s => ({ ...s, [f.key]: !s[f.key] }))} className="text-xs">
                <Icons.Check className={cn('w-3.5 h-3.5', !flags[f.key] && 'invisible')} />
                {f.label}
              </DropdownItem>
            ))}
          </Dropdown>
        )}

        <div className="w-px h-4 bg-border shrink-0" />

        {active && <span className="font-medium text-foreground whitespace-nowrap select-none">{visible.length} {noun}</span>}

        <button
          type="button"
          onClick={clear}
          title="Limpar critérios (mantém os itens fixados)"
          className="flex items-center justify-center w-6 h-6 rounded bg-muted hover:bg-muted/70 text-foreground"
        >
          <Icons.FilterX className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Fechar (limpa filtro e itens fixados)"
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <Icons.X className="w-3.5 h-3.5" />
        </button>
      </div>

      <table className="mx-auto text-xs">
        <thead className="text-muted-foreground">
          <tr className="[&>th]:px-3 [&>th]:py-1 [&>th]:text-left">
            <th>{view === 'duties' ? 'Jornada' : 'Carro'}</th><th>Início</th><th>Término</th>
            <th>Duração</th><th>Operador</th><th>Linhas</th>
            {view === 'duties' && <th>Situação</th>}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {visible.map(r => (
            <tr key={r.id} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-0.5">
              <td className="font-sans font-medium">{r.label}</td>
              <td>{fmtTime(r.start)}</td><td>{fmtTime(r.end)}</td><td>{fmtDuration(r.duration)}</td>
              <td>{r.branch}</td><td>{r.lines.join(', ')}</td>
              {view === 'duties' && (
                <td className="font-sans">{[r.issues && 'pendências', r.stale && 'desatualizada'].filter(Boolean).join(', ')}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// field + relation + value; "+" or Enter adds it and clears the value (field/relation stay,
// so a range is two quick entries)
function ConditionBuilder({ onAdd }: { onAdd: (c: Condition) => void }) {
  const [field, setField] = useState<Field>('start')
  const [op, setOp]       = useState<Op>('gt')
  const [value, setValue] = useState('')
  const minutes = parseTime(value)

  function add() {
    if (minutes == null) return
    onAdd({ field, op, minutes })
    setValue('')
  }

  return (
    <span className="flex items-center gap-1">
      <select value={field} onChange={e => setField(e.target.value as Field)} className={selectCls}>
        {(Object.keys(FIELD_LABEL) as Field[]).map(f => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
      </select>
      <select value={op} onChange={e => setOp(e.target.value as Op)} className={selectCls}>
        <option value="gt">{OP_LABEL[field].gt}</option>
        <option value="lt">{OP_LABEL[field].lt}</option>
      </select>
      <input
        type="time"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        title={field === 'duration' ? 'Horas:minutos' : undefined}
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
