'use client'

import { useState } from 'react'
import { formatDutyNumber, CREW_ROLES, type CrewRole } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import type { CrewBoardData, BoardDuty } from '../board.types'
import { fmtDuration, dutyColorVars, SWATCH_BG_CLASS, ROLE_LABEL, KIND_LABEL, CRITERION_LABEL } from '../board.types'
import { cn } from '@/lib/utils'
import { Badge } from './DutyPanel'

interface Props {
  data:           CrewBoardData
  // duties left after the filter bar's criteria
  duties:         BoardDuty[]
  issuesActive:   boolean
  staleActive:    boolean
  onToggleIssues: () => void
  onToggleStale:  () => void
  canEdit:        boolean
  onSelect:       (duty: BoardDuty) => void
  onCreate:       (role: CrewRole) => void
}

// Shown when no duty is selected — plan-level summary and the full duty list.
export function PlanPanel({ data, duties, issuesActive, staleActive, onToggleIssues, onToggleStale, canEdit, onSelect, onCreate }: Props) {
  const [role, setRole] = useState<CrewRole>('DRIVER')
  const [dutySearch, setDutySearch] = useState('')
  const s = data.plan.summary

  const filteredDuties = dutySearch.trim()
    ? duties.filter(d => formatDutyNumber(d.role, d.dutyNumber).toLowerCase().includes(dutySearch.trim().toLowerCase()))
    : duties

  return (
    <div className="w-96 shrink-0 border-l border-border flex flex-col min-h-0 bg-background">
      <div className="px-4 py-3 border-b border-border">
        <p className="font-semibold">Escala</p>
        <p className="text-xs text-muted-foreground">
          {data.vehiclePlan.scopeName} · {data.vehiclePlan.dayTypeName}
          {data.plan.isCustomSettings && ' · configuração personalizada'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {s && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="Jornadas"   value={String(s.dutyCount)} />
            <Stat label="Score"      value={String(s.score)} />
            <Stat label="Sem motorista" value={fmtDuration(s.uncoveredMinutes)} tone={s.uncoveredMinutes > 0 ? 'red' : undefined} />
            {(['STRAIGHT', 'SPLIT', 'TRIPPER'] as const).map(k => {
              const n = s.byKind[k] ?? 0
              return <Stat key={k} label={KIND_LABEL[k]} value={String(n)} suffix={`${s.dutyCount ? Math.round((n / s.dutyCount) * 100) : 0}%`} />
            })}
            <Stat label="Trabalhado" value={fmtDuration(s.workMinutes)} />
            <Stat label="Pago"       value={fmtDuration(s.paidMinutes)} />
            <Stat label="Extra"      value={fmtDuration(s.overtimeMinutes)} />
            <Stat label="Desatualizadas" value={String(s.staleDutyCount)} tone={s.staleDutyCount > 0 ? 'red' : undefined} active={staleActive} onClick={onToggleStale} />
            <Stat label="Com pendências" value={String(s.issueDutyCount)} tone={s.issueDutyCount > 0 ? 'amber' : undefined} active={issuesActive} onClick={onToggleIssues} />
            <Stat label="Noturno"    value={fmtDuration(s.nightMinutes)} />
          </div>
        )}

        {s && (s.criteria ?? []).length > 0 && <ScoreLosses criteria={s.criteria} />}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jornadas</p>
          {data.duties.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma jornada. Clique num ponto de troca de um carro para criar a primeira pegada.</p>
          )}
          {data.duties.length > 0 && (
            <div className="relative">
              <Icons.Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={dutySearch}
                onChange={e => setDutySearch(e.target.value)}
                placeholder="Buscar jornada…"
                className="w-full h-8 border border-input rounded-sm text-xs bg-input-bg pl-8 pr-2 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          {data.duties.length > 0 && filteredDuties.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma jornada encontrada.</p>
          )}
          <ul className="space-y-1 max-h-[19.75rem] overflow-y-auto">
            {filteredDuties.map(d => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onSelect(d)}
                  className="w-full flex items-center justify-between gap-2 text-xs rounded px-2 py-1.5 bg-muted/40 hover:bg-muted text-left"
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('w-2.5 h-2.5 rounded-sm', SWATCH_BG_CLASS)} style={dutyColorVars(d)} />
                    <span className="font-medium">{formatDutyNumber(d.role, d.dutyNumber)}</span>
                    <span className="text-muted-foreground">{KIND_LABEL[d.kind]}</span>
                    {d.summary && <span className="text-muted-foreground">{fmtDuration(d.summary.workMinutes)}</span>}
                  </span>
                  <span className="flex gap-1">
                    {d.isStale && <Badge tone="red">Desatualizada</Badge>}
                    {d.hasIssues && <Badge tone="amber">Pendências</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {canEdit && (
          <div className="flex gap-2">
            <Select value={role} onChange={e => setRole(e.target.value as CrewRole)} size="sm" wrapperClassName="flex-1">
              {CREW_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
            <Button type="button" size="sm" variant="outline" onClick={() => onCreate(role)}>
              <Icons.Plus className="w-3.5 h-3.5 me-1" /> Jornada vazia
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// points each criterion took off the score (9999 × weight × (1 − value) ÷ Σ weights), largest
// first — collapsed until asked for
function ScoreLosses({ criteria }: { criteria: { key: string; weight: number; value: number }[] }) {
  const [open, setOpen] = useState(false)
  const total = criteria.reduce((sum, c) => sum + c.weight, 0)
  const rows  = criteria
    .map(c => ({ ...c, loss: Math.round((9999 * c.weight * (1 - c.value)) / total) }))
    .sort((a, b) => b.loss - a.loss)
  const lost  = rows.reduce((sum, c) => sum + c.loss, 0)
  const Chevron = open ? Icons.ChevronDown : Icons.ChevronRight
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1"><Chevron className="w-3.5 h-3.5" /> Penalizações</span>
        <span className="font-mono tabular-nums normal-case font-normal">{lost > 0 ? `−${lost.toLocaleString('pt-BR')}` : '0'}</span>
      </button>
      {open && <ul className="text-xs divide-y divide-border/50">
        {rows.map(c => (
          <li key={c.key} className={cn('flex items-center justify-between gap-2 py-1', c.loss === 0 && 'text-muted-foreground')}>
            <span>{CRITERION_LABEL[c.key] ?? c.key}</span>
            <span className="flex gap-3 font-mono tabular-nums">
              <span className="text-muted-foreground" title="Valor do critério (100% = ideal)">{Math.round(c.value * 100)}%</span>
              <span className="w-12 text-right">{c.loss > 0 ? `−${c.loss.toLocaleString('pt-BR')}` : '0'}</span>
            </span>
          </li>
        ))}
      </ul>}
    </div>
  )
}

function Stat({ label, value, suffix, tone, active, onClick }: {
  label: string; value: string; suffix?: string; tone?: 'red' | 'amber'; active?: boolean; onClick?: () => void
}) {
  const content = (
    <>
      <p className="text-muted-foreground">{label}</p>
      <p className={tone === 'red' ? 'font-medium text-red-600 dark:text-red-400' : tone === 'amber' ? 'font-medium text-amber-600 dark:text-amber-400' : 'font-medium text-foreground'}>
        {value}{suffix && <span className="ms-1.5 font-normal text-muted-foreground">{suffix}</span>}
      </p>
    </>
  )
  if (!onClick) return <div className="rounded bg-muted/40 px-2 py-1">{content}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('rounded px-2 py-1 text-left ring-1 ring-inset', active ? 'bg-muted ring-ring' : 'bg-muted/40 ring-transparent hover:bg-muted')}
    >
      {content}
    </button>
  )
}
