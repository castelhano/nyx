'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { VEHICLE_TYPE_LABELS, type VehicleTypeValue } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { ISSUE_LABEL, WEEKDAY, cellSummary, clock, dutyName, fmtDay, hm, requestImpact, weekday, type BoardIndex, type RosterBoard, type RosterBoardDuty } from './board'

interface Suggestion { crewMemberId: string; code: string; name: string; points: number; warns: number; reasons: string[] }

// The side panel: what is selected — a crew member on a date (his figures, the day, his requests
// with approve / refuse), a duty (operator, cars, lock, pendências) — and the date's days with
// publish / close.

export interface PanelActions {
  assign:   (duty: RosterBoardDuty, memberId: string | null) => void
  lock:     (duty: RosterBoardDuty, locked: boolean) => void
  vehicle:  (duty: RosterBoardDuty, blockId: string, vehicleId: string | null) => void
  dayOff:   (memberId: string, date: string, kind: 'DAY_OFF' | 'COMP_OFF' | null, absenceTypeId?: string | null) => void
  review:   (requestId: string, status: 'APPROVED' | 'REJECTED', answer?: string) => void
  status:   (operationId: string, to: 'PUBLISHED' | 'CLOSED') => void
}

interface Props {
  board:    RosterBoard
  idx:      BoardIndex
  date:     string | null
  memberId: string | null
  dutyId:   string | null
  canEdit:  boolean
  actions:  PanelActions
}

const STATUS_LABEL = { PLANNED: 'Planejada', PUBLISHED: 'Publicada', CLOSED: 'Encerrada' }

export function ContextPanel({ board, idx, date, memberId, dutyId, canEdit, actions }: Props) {
  const member = memberId ? idx.memberById.get(memberId) : null
  const cell = member && date ? idx.cellOf.get(`${member.id}|${date}`) : undefined
  const s = member && date ? cellSummary(cell, idx, board.multiScope) : null
  const duty = dutyId ? idx.dutyById.get(dutyId) : s?.duties[0]
  const day = date ? board.days.find(d => d.date === date) : null

  return (
    <aside className="space-y-4 text-sm">
      {member && date && s && (
        <section className="rounded-lg border border-border p-3 space-y-2">
          <div>
            <p className="font-medium"><span className="tabular-nums text-muted-foreground">{member.code}</span> {member.name}</p>
            <p className="text-xs text-muted-foreground">
              {[member.shiftId ? `Turno ${idx.shiftCode.get(member.shiftId)}` : 'Sem turno', member.rest].filter(Boolean).join(' · ')}
            </p>
          </div>
          {member.stats && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="Horas / carga" value={`${hm(member.stats.workedMinutes)} / ${hm(member.stats.targetMinutes)}`} warn={member.stats.workedMinutes < member.stats.targetMinutes * 0.97} />
              <Stat label="Trocas" value={String(member.stats.changes)} />
              <Stat label="Preferidas" value={member.stats.prefShare == null ? '—' : `${member.stats.prefShare}%`} />
            </div>
          )}
          <div className="border-t border-border pt-2 space-y-1.5">
            <p className="text-xs text-muted-foreground">{WEEKDAY[weekday(date)]} {fmtDay(date)}{s.holiday && ' · feriado'}</p>
            <p>
              {s.duties.length ? s.duties.map(d => dutyName(d, board.multiScope)).join(' + ')
                : s.off ? s.offName
                : s.absence ? s.absence.label
                : s.patternOff ? 'Folga do regime (não lançada)' : 'Livre'}
              {s.window && <span className="text-muted-foreground"> · ⏱ {s.window.label}</span>}
            </p>
            {canEdit && !s.duties.length && (
              <div className="flex flex-wrap gap-1.5">
                {board.offTypes.map(t => {
                  const on = s.offTypeId === t.id
                  return (
                    <Button key={t.id} size="sm" variant={on ? 'default' : 'outline'} title={t.name}
                      onClick={() => actions.dayOff(member.id, date, on ? null : t.effect, on ? null : t.id)}>
                      {t.system ? (t.effect === 'COMP_OFF' ? 'Compensada' : 'Folga') : t.code}
                    </Button>
                  )
                })}
              </div>
            )}
          </div>
          {(cell?.requests ?? []).length > 0 && (
            <div className="border-t border-border pt-2 space-y-1.5">
              <p className="text-xs font-medium">Pedidos no dia</p>
              {cell!.requests.map(r => (
                <RequestRow
                  key={r.id} r={r} canEdit={canEdit} onReview={actions.review}
                  impact={r.status === 'REQUESTED' ? requestImpact(r, member.id, board.cells.filter(c => c.crewMemberId === member.id && c.requests.some(x => x.id === r.id)).map(c => c.date), idx, board.multiScope) : []}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {duty && <DutySection board={board} idx={idx} duty={duty} canEdit={canEdit} actions={actions} />}

      {day && (
        <section className="rounded-lg border border-border p-3 space-y-2">
          <p className="font-medium">{WEEKDAY[weekday(day.date)]} {fmtDay(day.date)}</p>
          <p className="text-xs text-muted-foreground">{day.assigned}/{day.duties} tabela(s) com operador · {day.issues} com pendência</p>
          {!day.operations.length && <p className="text-xs text-muted-foreground">Dia ainda não criado — gere a escala do período.</p>}
          {day.operations.map(o => (
            <div key={o.id} className="flex items-center gap-2 text-xs">
              <span className="truncate">{o.scope}</span>
              <span className={cn('ml-auto', o.status === 'PUBLISHED' && 'text-emerald-600 dark:text-emerald-400', o.status === 'CLOSED' && 'text-muted-foreground')}>{STATUS_LABEL[o.status]}</span>
              {canEdit && o.status === 'PLANNED'   && <Button size="sm" variant="outline" className="h-6" onClick={() => actions.status(o.id, 'PUBLISHED')}>Publicar</Button>}
              {canEdit && o.status === 'PUBLISHED' && <Button size="sm" variant="outline" className="h-6" onClick={() => actions.status(o.id, 'CLOSED')}>Encerrar</Button>}
            </div>
          ))}
        </section>
      )}

      {!member && !duty && !day && <p className="text-xs text-muted-foreground">Selecione um operador, uma tabela ou um dia.</p>}
    </aside>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-sm bg-muted/40 px-2 py-1">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums font-medium', warn && 'text-amber-600 dark:text-amber-400')}>{value}</p>
    </div>
  )
}

function DutySection({ board, idx, duty, canEdit, actions }: { board: RosterBoard; idx: BoardIndex; duty: RosterBoardDuty; canEdit: boolean; actions: PanelActions }) {
  const holder = duty.crewMemberId ? idx.memberById.get(duty.crewMemberId) : null
  const [crewSearch, setCrewSearch] = useState('')
  const [carSearch, setCarSearch] = useState<Record<string, string>>({})

  // the empresa's crew members, the free ones on the date first, with what each has
  const crewOptions = useMemo((): ComboboxOption[] => board.members
    .filter(m => !m.foreign)
    .map(m => {
      const s = cellSummary(idx.cellOf.get(`${m.id}|${duty.date}`), idx, board.multiScope)
      const what = s.duties.length ? s.label : s.off ? s.offName.toLowerCase() : s.absence ? s.absence.label : s.patternOff ? 'folga do regime' : 'livre'
      return { id: m.id, label: `${m.code} — ${m.name}`, secondary: what }
    })
    .sort((a, b) => Number(b.secondary === 'livre') - Number(a.secondary === 'livre'))
    .filter(o => !crewSearch.trim() || o.label.toLowerCase().includes(crewSearch.trim().toLowerCase()))
    .slice(0, 50), [board, idx, duty.date, crewSearch])

  // cars on the date's other blocks
  const usedBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of board.duties) if (d.date === duty.date) for (const b of d.blocks) if (b.vehicleId) m.set(b.vehicleId, b.number)
    return m
  }, [board.duties, duty.date])

  // the best crew members for it (the generator's scoring) — only while it has none
  const { data: suggestions, isFetching: suggesting } = useQuery<Suggestion[]>({
    queryKey: ['transit', 'roster-board', 'suggest', duty.id],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/roster-board/suggest?dutyId=${duty.id}`)
      return res.ok ? (await res.json()).suggestions : []
    },
    enabled: canEdit && !duty.crewMemberId && !duty.locked,
    staleTime: 30_000,
  })

  // the duty's and its cars' pendências, one line per kind (with how many cars)
  const issues = [
    ...duty.issues.map(i => ({ ...i, cars: 0 })),
    ...[...duty.blocks.flatMap(b => b.issues).reduce((m, i) => m.set(i.code, { ...i, cars: (m.get(i.code)?.cars ?? 0) + 1 }), new Map<string, (typeof duty.issues)[number] & { cars: number }>()).values()],
  ]
  return (
    <section className="rounded-lg border border-border p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <p className="font-medium">{dutyName(duty, board.multiScope)}</p>
        <span className="text-xs text-muted-foreground">{WEEKDAY[weekday(duty.date)]} {fmtDay(duty.date)} · {duty.shiftId ? `turno ${idx.shiftCode.get(duty.shiftId)}` : 'sem turno'}</span>
        {canEdit && duty.crewMemberId && (
          <button type="button" onClick={() => actions.lock(duty, !duty.locked)} title={duty.locked ? 'Destravar' : 'Travar — o gerador mantém'}
            className={cn('ml-auto p-1 rounded hover:bg-muted cursor-pointer', duty.locked ? 'text-foreground' : 'text-muted-foreground/60')}>
            {duty.locked ? <Icons.Lock className="w-3.5 h-3.5" /> : <Icons.LockOpen className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {duty.start != null && duty.end != null ? `${clock(duty.start)}–${clock(duty.end)}` : '—'} · {hm(duty.paid)} pagas · {duty.lines.join(', ') || 'sem linha'}
      </p>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Operador</p>
        <Combobox
          value={duty.crewMemberId} displayValue={holder ? `${holder.code} — ${holder.name}` : ''}
          search={crewSearch} onSearchChange={setCrewSearch} options={crewOptions}
          onSelect={(o) => { setCrewSearch(''); actions.assign(duty, o?.id ?? null) }}
          placeholder="Sem operador" disabled={!canEdit || duty.locked} className="h-8 text-sm" emptyMessage="Nenhum operador"
        />
      </div>
      {canEdit && !duty.crewMemberId && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Sugestões {suggesting && <Icons.Loader2 className="inline w-3 h-3 animate-spin" />}</p>
          {suggestions && !suggestions.length && <p className="text-xs text-muted-foreground">Ninguém livre que possa assumir.</p>}
          {suggestions?.map(sg => (
            <button
              key={sg.crewMemberId} type="button" onClick={() => actions.assign(duty, sg.crewMemberId)}
              className="w-full rounded-sm px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer"
            >
              <span className="flex items-baseline gap-1.5 text-xs">
                <span className="tabular-nums text-muted-foreground">{sg.code}</span>
                <span className="truncate font-medium">{sg.name}</span>
                {sg.warns > 0 && <Icons.AlertTriangle className="w-3 h-3 shrink-0 text-amber-500" />}
                <span className={cn('ml-auto tabular-nums', sg.points >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{sg.points > 0 ? '+' : ''}{sg.points}</span>
              </span>
              <span className="block text-[10px] text-muted-foreground">{sg.reasons.join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
      {duty.blocks.map(b => {
        const q = (carSearch[b.id] ?? '').trim().toLowerCase()
        const options: ComboboxOption[] = board.vehicles
          .filter(v => !q || v.code.toLowerCase().includes(q))
          .slice(0, 50)
          .map(v => ({
            id: v.id, label: v.code,
            secondary: [VEHICLE_TYPE_LABELS[v.vehicleType as VehicleTypeValue] ?? v.vehicleType, usedBy.get(v.id) != null && usedBy.get(v.id) !== b.number ? `carro ${usedBy.get(v.id)}` : ''].filter(Boolean).join(' · '),
          }))
        return (
          <div key={b.id} className="space-y-1">
            <p className="text-xs text-muted-foreground">Carro {b.number}</p>
            <Combobox
              value={b.vehicleId} displayValue={b.vehicleCode ?? ''}
              search={carSearch[b.id] ?? ''} onSearchChange={(v) => setCarSearch(s => ({ ...s, [b.id]: v }))} options={options}
              onSelect={(o) => { setCarSearch(s => ({ ...s, [b.id]: '' })); actions.vehicle(duty, b.id, o?.id ?? null) }}
              placeholder="Sem veículo" disabled={!canEdit} className="h-8 text-sm" emptyMessage="Nenhum veículo"
            />
          </div>
        )
      })}
      {issues.length > 0 && (
        <ul className="border-t border-border pt-2 space-y-0.5">
          {issues.map((i, k) => (
            <li key={k} className="flex items-start gap-1 text-xs">
              <Icons.AlertTriangle className={cn('w-3.5 h-3.5 shrink-0 mt-px', i.severity === 'warning' ? 'text-amber-500' : 'text-red-600 dark:text-red-400')} />
              <span>{ISSUE_LABEL[i.code] ?? i.code}{i.cars > 1 && ` (${i.cars} carros)`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// a request on the day: approve, or refuse with an answer (Enter refuses, Esc goes back)
export function RequestRow({ r, canEdit, onReview, impact = [] }: {
  r: { id: string; kind: string; status: string; label: string }; canEdit: boolean; onReview: PanelActions['review']
  // what approving it does to the roster
  impact?: string[]
}) {
  const [refusing, setRefusing] = useState(false)
  const [answer, setAnswer] = useState('')
  return (
    <div className="space-y-1">
      <p className="text-xs">
        {r.kind === 'TIME_WINDOW' ? `⏱ ${r.label}` : r.label}
        <span className={cn('ml-1.5', r.status === 'REQUESTED' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
          {r.status === 'REQUESTED' ? 'solicitado' : 'aprovado'}
        </span>
      </p>
      {impact.map((t, i) => <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400">Aprovar: {t}</p>)}
      {canEdit && r.status === 'REQUESTED' && (refusing ? (
        <div className="flex gap-1">
          <input
            value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Resposta" autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (answer.trim()) onReview(r.id, 'REJECTED', answer) }
              if (e.key === 'Escape') { e.stopPropagation(); setRefusing(false) }
            }}
            className="h-8 flex-1 min-w-0 border border-input rounded-sm text-xs bg-input-bg px-2"
          />
          <Button size="sm" variant="destructive" disabled={!answer.trim()} onClick={() => onReview(r.id, 'REJECTED', answer)}>Recusar</Button>
          <Button size="sm" variant="ghost" onClick={() => setRefusing(false)}>Voltar</Button>
        </div>
      ) : (
        <div className="flex gap-1">
          <Button size="sm" variant="safeConfirm" onClick={() => onReview(r.id, 'APPROVED')}>Aprovar</Button>
          <Button size="sm" variant="outline" onClick={() => setRefusing(true)}>Recusar</Button>
        </div>
      ))}
    </div>
  )
}
