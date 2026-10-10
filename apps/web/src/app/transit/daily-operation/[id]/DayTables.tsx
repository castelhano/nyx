'use client'

import { useMemo, useState } from 'react'
import { VEHICLE_TYPE_LABELS, type VehicleTypeValue } from '@nyx/schemas'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { DailyBoardData, DayBlock, DayCrew, DayDuty, DayIssue } from './daily.types'
import { ISSUE_LABEL, crewSituation, dutyLabel, fmtTime } from './daily.types'

const th = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap'
const td = 'px-2 py-1.5 align-top'

// ── issues ────────────────────────────────────────────────────────────────────

export function IssueList({ issues }: { issues: DayIssue[] }) {
  if (!issues.length) return null
  return (
    <ul className="space-y-0.5">
      {issues.map((i, k) => (
        <li key={k} className="flex items-start gap-1 text-xs">
          <Icons.AlertTriangle className={cn('w-3.5 h-3.5 shrink-0 mt-px', i.severity === 'warning' ? 'text-amber-500 dark:text-amber-400' : 'text-red-600 dark:text-red-400')} />
          <span>{ISSUE_LABEL[i.code] ?? i.code}</span>
        </li>
      ))}
    </ul>
  )
}

// a combobox searching a local list (crew members, vehicles)
function LocalPicker({ value, options, onSelect, disabled, placeholder }: {
  value: string | null; options: ComboboxOption[]; onSelect: (id: string | null) => void; disabled?: boolean; placeholder: string
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const filtered = q ? options.filter(o => `${o.label} ${o.secondary ?? ''}`.toLowerCase().includes(q)) : options
  const current = options.find(o => o.id === value)
  return (
    <Combobox
      value={value}
      displayValue={current?.label ?? ''}
      search={search}
      onSearchChange={setSearch}
      options={filtered.slice(0, 50)}
      onSelect={(o) => { setSearch(''); onSelect(o?.id ?? null) }}
      placeholder={placeholder}
      disabled={disabled}
      className="h-7 text-xs"
      containerClassName="w-60"
      emptyMessage="Nada encontrado"
    />
  )
}

// ── duties ────────────────────────────────────────────────────────────────────

export function DutiesTable({ data, duties, canEdit, onAssign, onLock }: {
  data: DailyBoardData; duties: DayDuty[]; canEdit: boolean
  onAssign: (dutyId: string, crewMemberId: string | null) => void
  // a locked allocation survives the roster generator
  onLock:   (dutyId: string, locked: boolean) => void
}) {
  const blockById = useMemo(() => new Map(data.blocks.map(b => [b.id, b])), [data.blocks])
  const shiftCode = useMemo(() => new Map(data.shifts.map(s => [s.id, s.code])), [data.shifts])
  const dutyById  = useMemo(() => new Map(data.duties.map(d => [d.id, d])), [data.duties])
  // every crew member, the duty's operator first, then the free ones
  const crewOptions = (duty: DayDuty): ComboboxOption[] => [...data.crew]
    .sort((a, b) => Number(b.branchId === duty.branchId) - Number(a.branchId === duty.branchId)
      || Number(crewSituation(b, dutyById).tone === 'free') - Number(crewSituation(a, dutyById).tone === 'free'))
    .map(c => ({ id: c.id, label: `${c.code} — ${c.name}`, secondary: crewSituation(c, dutyById).label }))

  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border">
        <tr>
          <th className={th}>Tabela</th><th className={th}>Turno</th><th className={th}>Horário</th><th className={th}>Trab.</th>
          <th className={th}>Carros · linhas</th><th className={th}>Condutor</th><th className={th}>Pendências</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {duties.map(d => {
          const blocks = [...new Set(d.pieces.map(p => p.dailyBlockId).filter((x): x is string => !!x))].map(id => blockById.get(id)).filter((b): b is DayBlock => !!b)
          const lines  = [...new Set(blocks.flatMap(b => b.events.filter(e => e.kind === 'TRIP' && d.pieces.some(p => p.dailyBlockId === b.id && e.endMinutes > p.startMinutes && e.startMinutes < p.endMinutes)).map(e => e.lineCode)))]
          const s = d.summary
          return (
            <tr key={d.id} className={cn(d.isStale && 'bg-red-500/5')}>
              <td className={cn(td, 'font-medium whitespace-nowrap')}>{dutyLabel(d)}</td>
              <td className={td}>{d.shiftId ? shiftCode.get(d.shiftId) ?? '—' : '—'}</td>
              <td className={cn(td, 'tabular-nums whitespace-nowrap')}>{s?.startMinutes != null && s.endMinutes != null ? `${fmtTime(s.startMinutes)}–${fmtTime(s.endMinutes)}` : '—'}</td>
              <td className={cn(td, 'tabular-nums')}>{s ? fmtTime(s.workMinutes) : '—'}</td>
              <td className={cn(td, 'text-xs text-muted-foreground')}>{blocks.map(b => b.blockNumber).join(', ') || '—'}{lines.length > 0 && ` · ${lines.join(', ')}`}</td>
              <td className={td}>
                <div className="flex items-center gap-1">
                  <LocalPicker value={d.crewMemberId} options={crewOptions(d)} onSelect={(id) => onAssign(d.id, id)} disabled={!canEdit} placeholder="Sem condutor" />
                  {d.crewMemberId && (
                    <button
                      type="button" disabled={!canEdit} onClick={() => onLock(d.id, !d.locked)}
                      title={d.locked ? 'Travado — o gerador de escala mantém' : 'Travar — o gerador de escala mantém'}
                      className={cn('p-1 rounded hover:bg-muted disabled:opacity-50', d.locked ? 'text-foreground' : 'text-muted-foreground/50')}
                    >
                      {d.locked ? <Icons.Lock className="w-3.5 h-3.5" /> : <Icons.LockOpen className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </td>
              <td className={td}><IssueList issues={d.issues} /></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── blocks ────────────────────────────────────────────────────────────────────

export function BlocksTable({ data, blocks, canEdit, onVehicle, onCancelTrip }: {
  data: DailyBoardData; blocks: DayBlock[]; canEdit: boolean
  onVehicle: (blockId: string, vehicleId: string | null) => void
  onCancelTrip: (eventId: string, cancelled: boolean) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const abbr = useMemo(() => new Map(data.operators.map(o => [o.branchId, o.abbr])), [data.operators])
  const usedBy = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const b of data.blocks) if (b.vehicleId) m.set(b.vehicleId, [...(m.get(b.vehicleId) ?? []), b.blockNumber])
    return m
  }, [data.blocks])
  // the block's operator's vehicles first
  const vehicleOptions = (b: DayBlock): ComboboxOption[] => [...data.vehicles]
    .sort((x, y) => Number(y.branchId === b.branchId) - Number(x.branchId === b.branchId) || Number(!!x.unavailable) - Number(!!y.unavailable))
    .map(v => ({
      id: v.id, label: v.code,
      secondary: [VEHICLE_TYPE_LABELS[v.vehicleType as VehicleTypeValue] ?? v.vehicleType, abbr.get(v.branchId), v.unavailable,
        usedBy.get(v.id)?.filter(n => n !== b.blockNumber).map(n => `carro ${n}`).join(', ')].filter(Boolean).join(' · '),
    }))

  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border">
        <tr>
          <th className={th}>Carro</th><th className={th}>Empresa</th><th className={th}>Tipo</th><th className={th}>Horário</th>
          <th className={th}>Viagens</th><th className={th}>Veículo</th><th className={th}>Pendências</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {blocks.map(b => {
          const trips = b.events.filter(e => e.kind === 'TRIP')
          const start = Math.min(...b.events.map(e => e.startMinutes)), end = Math.max(...b.events.map(e => e.endMinutes))
          const cancelled = trips.filter(t => t.isCancelled).length
          const isOpen = open === b.id
          return (
            <tr key={b.id}>
              <td className={cn(td, 'font-medium')}>{b.blockNumber}</td>
              <td className={td}>{b.branchId ? abbr.get(b.branchId) ?? '—' : '—'}</td>
              <td className={cn(td, 'text-xs')}>{VEHICLE_TYPE_LABELS[b.vehicleType as VehicleTypeValue] ?? b.vehicleType}</td>
              <td className={cn(td, 'tabular-nums whitespace-nowrap')}>{b.events.length ? `${fmtTime(start)}–${fmtTime(end)}` : '—'}</td>
              <td className={td}>
                <button type="button" onClick={() => setOpen(isOpen ? null : b.id)} className="text-xs text-primary hover:underline">
                  {trips.length} viagem(ns){cancelled > 0 && `, ${cancelled} cancelada(s)`}
                </button>
                {isOpen && (
                  <ul className="mt-1 space-y-0.5">
                    {trips.map(t => (
                      <li key={t.id} className="flex items-center gap-2 text-xs">
                        <span className={cn('tabular-nums', t.isCancelled && 'line-through text-muted-foreground')}>{fmtTime(t.startMinutes)}–{fmtTime(t.endMinutes)} · {t.lineCode}</span>
                        {canEdit && (
                          <button type="button" onClick={() => onCancelTrip(t.id, !t.isCancelled)} className="text-muted-foreground hover:text-foreground">
                            {t.isCancelled ? 'restaurar' : 'cancelar'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className={td}>
                <LocalPicker value={b.vehicleId} options={vehicleOptions(b)} onSelect={(id) => onVehicle(b.id, id)} disabled={!canEdit} placeholder="Sem veículo" />
              </td>
              <td className={td}><IssueList issues={b.issues} /></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── crew ──────────────────────────────────────────────────────────────────────

export function CrewTable({ data, crew, canEdit, onDayOff }: {
  data: DailyBoardData; crew: DayCrew[]; canEdit: boolean; onDayOff: (crewMemberId: string, kind: 'DAY_OFF' | 'COMP_OFF' | null) => void
}) {
  const abbr      = useMemo(() => new Map(data.operators.map(o => [o.branchId, o.abbr])), [data.operators])
  const shiftCode = useMemo(() => new Map(data.shifts.map(s => [s.id, s.code])), [data.shifts])
  const dutyById  = useMemo(() => new Map(data.duties.map(d => [d.id, d])), [data.duties])
  const toneCls = { ok: '', off: 'text-muted-foreground', warn: 'text-amber-600 dark:text-amber-400', free: 'text-emerald-600 dark:text-emerald-400' }
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border">
        <tr>
          <th className={th}>Matrícula</th><th className={th}>Nome</th><th className={th}>Empresa</th><th className={th}>Turno</th>
          <th className={th}>No dia</th><th className={th}>Folga lançada</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {crew.map(c => {
          const sit = crewSituation(c, dutyById)
          return (
            <tr key={c.id}>
              <td className={cn(td, 'tabular-nums')}>{c.code}</td>
              <td className={td}>{c.name}</td>
              <td className={td}>{abbr.get(c.branchId) ?? '—'}</td>
              <td className={td}>{c.shiftId ? shiftCode.get(c.shiftId) ?? '—' : <span className="text-amber-600 dark:text-amber-400">sem turno</span>}</td>
              <td className={cn(td, toneCls[sit.tone])}>{sit.label}</td>
              <td className={td}>
                <Select
                  value={c.dayOff ?? ''} size="sm" wrapperClassName="w-44"
                  disabled={!canEdit || c.dutyIds.length > 0}
                  onChange={(e) => onDayOff(c.id, (e.target.value || null) as 'DAY_OFF' | 'COMP_OFF' | null)}
                >
                  <option value="">—</option>
                  <option value="DAY_OFF">Folga</option>
                  <option value="COMP_OFF">Folga compensada</option>
                </Select>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
