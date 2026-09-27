'use client'

import { useMemo, type CSSProperties, type Ref } from 'react'
import { formatDutyNumber } from '@nyx/schemas'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'
import type { BoardBlock, BoardDuty, BoardPiece, BoardActivity, BreakSlot } from '../board.types'
import { fmtTime, fmtDuration, blockColorVars, pieceTrips, breakSlots, SWATCH_BG_CLASS, LINE_BG_CLASS, ACTIVITY_LABEL, DIRECTION_LABEL, STALE_LABEL } from '../board.types'
import { LABEL_W, Ruler, HourGrid, type TimeRange } from './Timeline'
import { PinToggle } from './CrewFilterBar'

// One row per duty, whatever vehicles it runs on: its pieces colored per vehicle (so a
// vehicle change stands out) with the trips they operate in a thin lane below (so a line
// change stands out), its off-vehicle activities in neutral styles, and — when the
// duty has no explicit SIGN_ON/SIGN_OFF — a thin line for the sign-on/off time the
// calculation assumes. Breaks (BREAK activities, always manual) show hatched in the trips
// lane. Clicking a free slot — the vehicle's idle time in the trips lane, or
// the gap between two pieces — inserts a break there; pieces are created from the vehicle view.

interface Props {
  range:          TimeRange
  blockById:      Map<string, BoardBlock>
  duties:         BoardDuty[]
  signOnMinutes:  number
  signOffMinutes: number
  localityName:   (id: string) => string
  pxPerMinute:    number
  selectedDutyId: string | null
  onSelectDuty:   (duty: BoardDuty) => void
  // line code → color vars when "Cores das linhas" is on; null = neutral trips
  lineColors:     Map<string, CSSProperties> | null
  canEdit:        boolean
  onSlotClick:    (duty: BoardDuty, slot: BreakSlot) => void
  scrollRef:      Ref<HTMLDivElement>
  // pin toggles shown while the filter bar is open
  pinnable:       boolean
  pinnedIds:      Set<string>
  onTogglePin:    (dutyId: string) => void
}

const ROW_H = 40

const ACTIVITY_CLASS: Record<BoardActivity['type'], string> = {
  SIGN_ON:  'bg-slate-300 dark:bg-slate-600',
  SIGN_OFF: 'bg-slate-300 dark:bg-slate-600',
  TRAVEL:   'bg-slate-300 dark:bg-slate-600',
  STANDBY:  'bg-slate-200 dark:bg-slate-700 border border-slate-400 dark:border-slate-500',
  BREAK:    'border border-slate-400 dark:border-slate-500 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(148_163_184/0.45)_4px_6px)]',
}

export function DutyBoard({
  range, blockById, duties, signOnMinutes, signOffMinutes, localityName, pxPerMinute, selectedDutyId, onSelectDuty,
  lineColors, canEdit, onSlotClick, scrollRef, pinnable, pinnedIds, onTogglePin,
}: Props) {
  const issuePieceIds = useMemo(
    () => new Set(duties.flatMap(d => d.issues.map(i => i.pieceId).filter((id): id is string => !!id))),
    [duties],
  )

  const x     = (m: number) => (m - range.start) * pxPerMinute
  const w     = (a: number, b: number) => Math.max(2, (b - a) * pxPerMinute)
  const width = (range.end - range.start) * pxPerMinute

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div style={{ width: LABEL_W + width }} className="relative">
        <Ruler range={range} pxPerMinute={pxPerMinute} />

        {duties.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground">Nenhuma jornada. Crie pegadas pela visão de carros.</div>
        )}

        {duties.map(duty => {
          const live     = duty.pieces.filter(p => !p.isStale)
          const hasOn    = duty.activities.some(a => a.type === 'SIGN_ON')
          const hasOff   = duty.activities.some(a => a.type === 'SIGN_OFF')
          const first    = live.length ? Math.min(...live.map(p => p.startMinutes)) : null
          const last     = live.length ? Math.max(...live.map(p => p.endMinutes)) : null
          const selected = duty.id === selectedDutyId

          return (
            <div
              key={duty.id}
              data-row={duty.id}
              className={cn('flex border-b border-border/60 cursor-pointer', selected && 'bg-accent/30')}
              style={{ height: ROW_H }}
              onClick={() => onSelectDuty(duty)}
            >
              <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-background border-r border-border flex items-center justify-between gap-1 px-2 text-xs">
                <span className="flex items-center gap-1 font-medium">
                  {pinnable && <PinToggle pinned={pinnedIds.has(duty.id)} onToggle={() => onTogglePin(duty.id)} noun="jornada" />}
                  {formatDutyNumber(duty.role, duty.dutyNumber)}
                  {duty.locked && <Icons.Lock className="w-3 h-3 text-muted-foreground" aria-label="Travada" />}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {duty.summary && fmtDuration(duty.summary.workMinutes)}
                  {duty.isStale && <Icons.Circle className="w-2.5 h-2.5 fill-current text-red-600 dark:text-red-400" aria-label="Desatualizada" />}
                  {!duty.isStale && duty.hasIssues && <Icons.Circle className="w-2.5 h-2.5 fill-current text-amber-500 dark:text-amber-400" aria-label="Com pendências" />}
                </span>
              </div>

              <div className="relative" style={{ width }}>
                <HourGrid range={range} pxPerMinute={pxPerMinute} />

                {/* implicit sign-on/off assumed by the calculation */}
                {first != null && !hasOn && signOnMinutes > 0 && (
                  <div className="absolute top-3 h-0.5 -translate-y-1/2 bg-slate-400 dark:bg-slate-500"
                    style={{ left: x(first - signOnMinutes), width: w(first - signOnMinutes, first) }}
                    title={`Apresentação (padrão) ${fmtTime(first - signOnMinutes)}–${fmtTime(first)}`} />
                )}
                {last != null && !hasOff && signOffMinutes > 0 && (
                  <div className="absolute top-3 h-0.5 -translate-y-1/2 bg-slate-400 dark:bg-slate-500"
                    style={{ left: x(last), width: w(last, last + signOffMinutes) }}
                    title={`Encerramento (padrão) ${fmtTime(last)}–${fmtTime(last + signOffMinutes)}`} />
                )}

                {duty.activities.map(a => (
                  <div
                    key={a.id}
                    className={cn(
                      'absolute z-[6] rounded-sm text-slate-700 dark:text-slate-200 overflow-hidden whitespace-nowrap px-1',
                      // breaks sit in the trips lane, where they read against the vehicle's idle time
                      a.type === 'BREAK' ? 'top-[22px] h-3.5 text-[9px] leading-[12px]' : 'top-1 h-4 text-[10px] leading-4',
                      ACTIVITY_CLASS[a.type],
                    )}
                    style={{ left: x(a.startMinutes), width: w(a.startMinutes, a.endMinutes) }}
                    title={`${ACTIVITY_LABEL[a.type]}${a.intervalTypeName ? ` (${a.intervalTypeName})` : ''} ${fmtTime(a.startMinutes)}–${fmtTime(a.endMinutes)}`}
                  >
                    {ACTIVITY_LABEL[a.type]}
                  </div>
                ))}

                {duty.pieces.map(p => {
                  const block = p.vehicleBlockId ? blockById.get(p.vehicleBlockId) : undefined
                  return (
                    <PieceBar
                      key={p.id} piece={p}
                      blockNumber={block?.blockNumber ?? null}
                      left={x(p.startMinutes)} width={w(p.startMinutes, p.endMinutes)}
                      hasIssue={issuePieceIds.has(p.id)} localityName={localityName}
                    />
                  )
                })}

                {/* free break slots — idle time in the trips lane, gaps between pieces full height */}
                {canEdit && breakSlots(duty, blockById).map(slot => (
                  <div
                    key={`slot:${slot.startMinutes}`}
                    className={cn(
                      'absolute z-[6] rounded-sm cursor-pointer hover:bg-accent hover:outline hover:outline-1 hover:outline-dashed hover:outline-foreground/40',
                      slot.inPiece ? 'top-[22px] h-3.5' : 'top-1 bottom-1',
                    )}
                    style={{ left: x(slot.startMinutes), width: w(slot.startMinutes, slot.endMinutes) }}
                    title={`Inserir intervalo ${fmtTime(slot.startMinutes)}–${fmtTime(slot.endMinutes)}`}
                    onClick={(e) => { e.stopPropagation(); onSlotClick(duty, slot) }}
                  />
                ))}

                {/* trips lane — clipped to the piece, which may start/end mid-trip */}
                {duty.pieces.flatMap(p => pieceTrips(p, p.vehicleBlockId ? blockById.get(p.vehicleBlockId) : undefined).map(t => {
                  const from     = Math.max(t.departureMinutes, p.startMinutes)
                  const to       = Math.min(t.arrivalMinutes, p.endMinutes)
                  const lineVars = lineColors?.get(t.lineCode)
                  return (
                    <div
                      key={`${p.id}:${t.id}`}
                      className={cn(
                        'absolute top-[22px] h-3.5 rounded-sm text-[9px] leading-[14px] overflow-hidden whitespace-nowrap px-0.5',
                        lineVars
                          ? cn(LINE_BG_CLASS, 'text-slate-800 dark:text-slate-100')
                          : 'bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200',
                      )}
                      style={{ ...lineVars, left: x(from), width: Math.max(1, (to - from) * pxPerMinute) }}
                      title={`${t.lineCode} ${DIRECTION_LABEL[t.direction] ?? t.direction} ${fmtTime(t.departureMinutes)}–${fmtTime(t.arrivalMinutes)}`}
                    >
                      {t.lineCode}
                    </div>
                  )
                }))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PieceBar({ piece, blockNumber, left, width, hasIssue, localityName }: {
  piece: BoardPiece; blockNumber: number | null; left: number; width: number
  hasIssue: boolean; localityName: (id: string) => string
}) {
  const duration = fmtDuration(piece.endMinutes - piece.startMinutes)
  const label    = blockNumber != null ? `Carro ${blockNumber} • ${duration}` : `Sem bloco • ${duration}`
  const title = [
    `${label} · ${fmtTime(piece.startMinutes)} ${localityName(piece.startLocalityId)} → ${fmtTime(piece.endMinutes)} ${localityName(piece.endLocalityId)}`,
    piece.isStale && piece.staleReason ? `Desatualizada: ${STALE_LABEL[piece.staleReason]}` : null,
    hasIssue ? 'Com pendências' : null,
  ].filter(Boolean).join('\n')

  return (
    <div
      title={title}
      className={cn(
        'absolute top-1 h-4 z-[5] flex items-center justify-between gap-1 rounded-sm text-[10px] font-medium overflow-hidden whitespace-nowrap px-1',
        // orphan pieces (block removed) have no vehicle color
        blockNumber != null ? cn(SWATCH_BG_CLASS, 'text-white') : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200',
        piece.isStale && 'opacity-60 outline outline-2 outline-dashed outline-red-600',
      )}
      style={{ ...(blockNumber != null ? blockColorVars(blockNumber) : {}), left, width }}
    >
      <span className="truncate">{label}</span>
      {hasIssue && !piece.isStale && <Icons.Circle className="w-2.5 h-2.5 shrink-0 fill-current text-amber-200" aria-label="Com pendências" />}
    </div>
  )
}
