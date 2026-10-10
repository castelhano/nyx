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
import { dutyWalks } from '../filters'

interface Props {
  data:           CrewBoardData
  // duties left after the filter bar's criteria
  duties:         BoardDuty[]
  // filter matches (no pins) — the summary is recomputed over them; null = that side unfiltered
  matchedDuties:   BoardDuty[] | null
  matchedBlockIds: Set<string> | null
  issuesActive:   boolean
  staleActive:    boolean
  onToggleIssues: () => void
  onToggleStale:  () => void
  walkActive:     boolean
  onToggleWalk:   () => void
  canEdit:        boolean
  onSelect:       (duty: BoardDuty) => void
  onCreate:       (role: CrewRole) => void
}

// Shown when no duty is selected — plan-level summary and the full duty list.
export function PlanPanel({ data, duties, matchedDuties, matchedBlockIds, issuesActive, staleActive, onToggleIssues, onToggleStale, walkActive, onToggleWalk, canEdit, onSelect, onCreate }: Props) {
  const [role, setRole] = useState<CrewRole>('DRIVER')
  const [dutySearch, setDutySearch] = useState('')
  const s = data.plan.summary
  const f = filteredSummary(data, matchedDuties, matchedBlockIds)

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
            <Stat label="Jornadas"   value={String(f.dutyCount)} filtered={!!matchedDuties} />
            <Stat label="Score"      value={String(s.score)} />
            <Stat label="Sem motorista" value={fmtDuration(f.uncoveredMinutes ?? s.uncoveredMinutes)} tone={(f.uncoveredMinutes ?? s.uncoveredMinutes) > 0 ? 'red' : undefined} filtered={!!matchedBlockIds} />
            {(['STRAIGHT', 'SPLIT', 'TRIPPER'] as const).map(k => {
              const n = f.byKind[k] ?? 0
              return <Stat key={k} label={KIND_LABEL[k]} value={String(n)} suffix={`${f.dutyCount ? Math.round((n / f.dutyCount) * 100) : 0}%`} filtered={!!matchedDuties} />
            })}
            <Stat label="Trabalhado" value={fmtDuration(f.workMinutes)} filtered={!!matchedDuties} />
            <Stat label="Pago"       value={fmtDuration(f.paidMinutes)} filtered={!!matchedDuties} />
            <Stat label="Extra"      value={fmtDuration(f.overtimeMinutes)} filtered={!!matchedDuties} />
            <Stat label="Desatualizadas" value={String(f.staleCount)} tone={f.staleCount > 0 ? 'red' : undefined} active={staleActive} onClick={onToggleStale} filtered={!!matchedDuties} />
            <Stat label="Com pendências" value={String(f.issueCount)} tone={f.issueCount > 0 ? 'amber' : undefined} active={issuesActive} onClick={onToggleIssues} filtered={!!matchedDuties} />
            <Stat label="Noturno"    value={fmtDuration(f.nightMinutes)} filtered={!!matchedDuties} />
            <Stat label="A pé" value={String(f.walkCount)} suffix={`${f.walkMeters.toLocaleString('pt-BR')} m`} active={walkActive} onClick={onToggleWalk} filtered={!!matchedDuties} />
            <Stat label="Condutores/carro" value={f.driversPerVehicle != null ? f.driversPerVehicle.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'} filtered={!!matchedDuties} />
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

// The summary cards over the filtered duties / vehicles. Unfiltered it sums the same per-duty
// summaries the server does, so the numbers match plan.summary; uncoveredMinutes is null when
// the vehicle side is unfiltered (the card falls back to the plan's).
function filteredSummary(data: CrewBoardData, matchedDuties: BoardDuty[] | null, matchedBlockIds: Set<string> | null) {
  const duties = matchedDuties ?? data.duties
  const byKind: Partial<Record<BoardDuty['kind'], number>> = {}
  let workMinutes = 0, paidMinutes = 0, overtimeMinutes = 0, nightMinutes = 0
  let staleCount = 0, issueCount = 0, walkCount = 0, walkMeters = 0
  // distinct DRIVER duties per vehicle (live pieces only), as the server's driversPerVehicle
  const driversByBlock = new Map<string, Set<string>>()
  for (const d of duties) {
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1
    workMinutes     += d.summary?.workMinutes ?? 0
    paidMinutes     += d.summary?.paidMinutes ?? 0
    overtimeMinutes += d.summary?.overtimeMinutes ?? 0
    nightMinutes    += d.summary?.nightMinutes ?? 0
    if (d.isStale)   staleCount++
    if (d.hasIssues) issueCount++
    if (dutyWalks(d)) { walkCount++; walkMeters += d.summary?.walkMeters ?? 0 }
    if (d.role !== 'DRIVER') continue
    for (const p of d.pieces) {
      if (!p.vehicleBlockId || p.isStale) continue
      const set = driversByBlock.get(p.vehicleBlockId) ?? new Set<string>()
      set.add(d.id)
      driversByBlock.set(p.vehicleBlockId, set)
    }
  }
  let slots = 0
  for (const set of driversByBlock.values()) slots += set.size
  const uncoveredMinutes = matchedBlockIds
    ? (data.plan.summary?.uncovered ?? []).filter(u => matchedBlockIds.has(u.vehicleBlockId)).reduce((sum, u) => sum + u.endMinutes - u.startMinutes, 0)
    : null
  return {
    dutyCount: duties.length, byKind, workMinutes, paidMinutes, overtimeMinutes, nightMinutes,
    staleCount, issueCount, walkCount, walkMeters, uncoveredMinutes,
    driversPerVehicle: driversByBlock.size ? slots / driversByBlock.size : null,
  }
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

// filtered: the value follows the filter bar — tinted so it reads apart from plan-wide values
function Stat({ label, value, suffix, tone, active, onClick, filtered }: {
  label: string; value: string; suffix?: string; tone?: 'red' | 'amber'; active?: boolean; onClick?: () => void; filtered?: boolean
}) {
  const content = (
    <>
      <p className="text-muted-foreground">{label}</p>
      <p className={tone === 'red' ? 'font-medium text-red-600 dark:text-red-400' : tone === 'amber' ? 'font-medium text-amber-600 dark:text-amber-400' : 'font-medium text-foreground'}>
        {value}{suffix && <span className="ms-1.5 font-normal text-muted-foreground">{suffix}</span>}
      </p>
    </>
  )
  const bg = filtered ? 'bg-primary/10' : 'bg-muted/40'
  if (!onClick) return <div className={cn('rounded px-2 py-1', bg)}>{content}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('rounded px-2 py-1 text-left ring-1 ring-inset', active ? 'bg-muted ring-ring' : cn(bg, 'ring-transparent hover:bg-muted'))}
    >
      {content}
    </button>
  )
}
