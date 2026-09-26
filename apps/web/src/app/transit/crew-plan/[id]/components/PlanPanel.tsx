'use client'

import { useState } from 'react'
import { formatDutyNumber, CREW_ROLES, type CrewRole } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import type { CrewBoardData, BoardDuty } from '../board.types'
import { fmtDuration, dutyColorVars, SWATCH_BG_CLASS, ROLE_LABEL, KIND_LABEL } from '../board.types'
import { cn } from '@/lib/utils'
import { Badge } from './DutyPanel'

interface Props {
  data:        CrewBoardData
  canEdit:     boolean
  onSelect:    (duty: BoardDuty) => void
  onCreate:    (role: CrewRole) => void
}

// Shown when no duty is selected — plan-level summary and the full duty list.
export function PlanPanel({ data, canEdit, onSelect, onCreate }: Props) {
  const [role, setRole] = useState<CrewRole>('DRIVER')
  const s = data.plan.summary

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
            <Stat label="Trabalhado" value={fmtDuration(s.workMinutes)} />
            <Stat label="Pago"       value={fmtDuration(s.paidMinutes)} />
            <Stat label="Extra"      value={fmtDuration(s.overtimeMinutes)} />
            <Stat label="Desatualizadas" value={String(s.staleDutyCount)} tone={s.staleDutyCount > 0 ? 'red' : undefined} />
            <Stat label="Com pendências" value={String(s.issueDutyCount)} tone={s.issueDutyCount > 0 ? 'amber' : undefined} />
            <Stat label="Noturno"    value={fmtDuration(s.nightMinutes)} />
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jornadas</p>
          {data.duties.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma jornada. Clique num ponto de troca de um carro para criar a primeira pegada.</p>
          )}
          <ul className="space-y-1">
            {data.duties.map(d => (
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'amber' }) {
  return (
    <div className="rounded bg-muted/40 px-2 py-1">
      <p className="text-muted-foreground">{label}</p>
      <p className={tone === 'red' ? 'font-medium text-red-600 dark:text-red-400' : tone === 'amber' ? 'font-medium text-amber-600 dark:text-amber-400' : 'font-medium text-foreground'}>{value}</p>
    </div>
  )
}
