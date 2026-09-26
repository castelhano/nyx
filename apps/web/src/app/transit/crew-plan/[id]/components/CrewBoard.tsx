'use client'

import { useMemo, useState } from 'react'
import { formatDutyNumber, type ReliefPoint } from '@nyx/schemas'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'
import type { BoardBlock, BoardDuty, BoardPiece } from '../board.types'
import { fmtTime, dutyColor, STALE_LABEL } from '../board.types'

// One row per vehicle block: the vehicle lane on top (trips, deadruns, intervals and the
// relief points where a piece may start/end) and the crew lane below (DRIVER pieces
// colored per duty, uncovered spans in red). Pieces of other roles get a thin extra lane.
// A piece is created by clicking two relief points of the same block (start → end).

export interface PieceDraftStart {
  blockId: string
  point:   ReliefPoint
}

interface Props {
  blocks:         BoardBlock[]
  duties:         BoardDuty[]
  uncovered:      { vehicleBlockId: string; startMinutes: number; endMinutes: number }[]
  localityName:   (id: string) => string
  pxPerMinute:    number
  selectedDutyId: string | null
  draftStart:     PieceDraftStart | null
  canEdit:        boolean
  onPointClick:   (block: BoardBlock, point: ReliefPoint) => void
  onPieceClick:   (duty: BoardDuty, piece: BoardPiece) => void
}

const LABEL_W = 88
const ROW_H   = 44

export function CrewBoard({
  blocks, duties, uncovered, localityName, pxPerMinute, selectedDutyId, draftStart, canEdit, onPointClick, onPieceClick,
}: Props) {
  // relief points are only rendered for the hovered row (or the row being picked on) —
  // a plan easily has ~200 blocks × ~100 points each
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)

  const range = useMemo(() => {
    const windows = blocks.map(b => b.window).filter((w): w is NonNullable<typeof w> => !!w)
    if (windows.length === 0) return { start: 0, end: 1440 }
    return {
      start: Math.floor(Math.min(...windows.map(w => w.startMinutes)) / 60) * 60,
      end:   Math.ceil(Math.max(...windows.map(w => w.endMinutes)) / 60) * 60,
    }
  }, [blocks])

  // pieces grouped by block, split into the driver lane and the other-roles lane
  const piecesByBlock = useMemo(() => {
    const map = new Map<string, { duty: BoardDuty; piece: BoardPiece }[]>()
    for (const duty of duties) {
      for (const piece of duty.pieces) {
        if (!piece.vehicleBlockId) continue
        if (!map.has(piece.vehicleBlockId)) map.set(piece.vehicleBlockId, [])
        map.get(piece.vehicleBlockId)!.push({ duty, piece })
      }
    }
    return map
  }, [duties])

  const issuePieceIds = useMemo(
    () => new Set(duties.flatMap(d => d.issues.map(i => i.pieceId).filter((id): id is string => !!id))),
    [duties],
  )

  const uncoveredByBlock = useMemo(() => {
    const map = new Map<string, typeof uncovered>()
    for (const u of uncovered) {
      if (!map.has(u.vehicleBlockId)) map.set(u.vehicleBlockId, [])
      map.get(u.vehicleBlockId)!.push(u)
    }
    return map
  }, [uncovered])

  const x     = (m: number) => (m - range.start) * pxPerMinute
  const width = (range.end - range.start) * pxPerMinute
  const hours = Array.from({ length: (range.end - range.start) / 60 + 1 }, (_, i) => range.start + i * 60)

  return (
    <div className="h-full overflow-auto">
      <div style={{ width: LABEL_W + width }} className="relative">
        {/* ruler */}
        <div className="sticky top-0 z-20 flex bg-background border-b border-border h-7">
          <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-background border-r border-border" />
          <div className="relative" style={{ width }}>
            {hours.map(h => (
              <div key={h} className="absolute top-0 bottom-0 border-l border-border/70 text-[10px] text-muted-foreground ps-1 pt-1.5" style={{ left: x(h) }}>
                {fmtTime(h)}
              </div>
            ))}
          </div>
        </div>

        {blocks.map(block => {
          const items      = piecesByBlock.get(block.id) ?? []
          const driver     = items.filter(i => i.duty.role === 'DRIVER')
          const others     = items.filter(i => i.duty.role !== 'DRIVER')
          const isDraftRow = draftStart?.blockId === block.id
          const blockUncovered = uncoveredByBlock.get(block.id) ?? []

          return (
            <div
              key={block.id}
              className={cn('flex border-b border-border/60', isDraftRow && 'bg-accent/30')}
              style={{ height: ROW_H }}
              onMouseEnter={() => setHoveredBlockId(block.id)}
              onMouseLeave={() => setHoveredBlockId(h => (h === block.id ? null : h))}
            >
              <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-background border-r border-border flex items-center justify-between px-2 text-xs">
                <span className="font-medium">Carro {block.blockNumber}</span>
                {blockUncovered.length > 0 && <Icons.AlertTriangle className="w-3.5 h-3.5 text-red-600" aria-label="Trechos sem motorista" />}
              </div>

              <div className="relative" style={{ width }}>
                {hours.map(h => <div key={h} className="absolute top-0 bottom-0 border-l border-border/30" style={{ left: x(h) }} />)}

                {/* vehicle lane */}
                {block.trips.map(t => (
                  <div
                    key={t.id}
                    className="absolute top-1 h-4 rounded-sm bg-slate-300 dark:bg-slate-600 text-[9px] leading-4 text-slate-700 dark:text-slate-200 overflow-hidden whitespace-nowrap px-0.5"
                    style={{ left: x(t.departureMinutes), width: Math.max(1, (t.arrivalMinutes - t.departureMinutes) * pxPerMinute) }}
                    title={`${t.lineCode} ${fmtTime(t.departureMinutes)}–${fmtTime(t.arrivalMinutes)}`}
                  >
                    {t.lineCode}
                  </div>
                ))}
                {block.deadruns.map(d => (
                  <div
                    key={d.id}
                    className="absolute top-2.5 h-1 bg-slate-400/70 dark:bg-slate-500/70"
                    style={{ left: x(d.departureMinutes), width: Math.max(1, (d.arrivalMinutes - d.departureMinutes) * pxPerMinute) }}
                    title={`Deslocamento ${fmtTime(d.departureMinutes)}–${fmtTime(d.arrivalMinutes)}`}
                  />
                ))}
                {block.intervals.map(i => (
                  <div
                    key={i.id}
                    className="absolute top-1 h-4 border border-dashed border-slate-400 rounded-sm"
                    style={{ left: x(i.departureMinutes), width: Math.max(1, (i.arrivalMinutes - i.departureMinutes) * pxPerMinute) }}
                    title={`Intervalo ${fmtTime(i.departureMinutes)}–${fmtTime(i.arrivalMinutes)}`}
                  />
                ))}

                {/* relief points — only on the hovered row, or while picking a piece on this row */}
                {canEdit && (hoveredBlockId === block.id || isDraftRow) && block.points.map((p, idx) => {
                  const isStart = isDraftRow && draftStart.point.minutes === p.minutes && draftStart.point.localityId === p.localityId
                  return (
                    <button
                      key={`${p.localityId}:${p.minutes}:${idx}`}
                      type="button"
                      onClick={() => onPointClick(block, p)}
                      className={cn(
                        'absolute top-0 z-10 w-2 h-6 -ms-1 rounded-sm',
                        isStart ? 'bg-amber-500' : 'bg-sky-600/60 hover:bg-sky-500',
                      )}
                      style={{ left: x(p.minutes) }}
                      title={`${localityName(p.localityId)} · ${fmtTime(p.minutes)}`}
                    />
                  )
                })}

                {/* crew lane — uncovered spans */}
                {blockUncovered.map(u => (
                  <div
                    key={`${u.startMinutes}`}
                    className="absolute top-6 h-3.5 rounded-sm bg-red-500/20 border border-red-500/60"
                    style={{ left: x(u.startMinutes), width: Math.max(1, (u.endMinutes - u.startMinutes) * pxPerMinute) }}
                    title={`Sem motorista ${fmtTime(u.startMinutes)}–${fmtTime(u.endMinutes)}`}
                  />
                ))}

                {/* crew lane — driver pieces */}
                {driver.map(({ duty, piece }) => (
                  <PieceBar
                    key={piece.id} duty={duty} piece={piece} top={24} height={14}
                    left={x(piece.startMinutes)} width={(piece.endMinutes - piece.startMinutes) * pxPerMinute}
                    selected={duty.id === selectedDutyId} hasIssue={issuePieceIds.has(piece.id)}
                    localityName={localityName} onClick={() => onPieceClick(duty, piece)}
                  />
                ))}

                {/* other roles — thin lane at the bottom */}
                {others.map(({ duty, piece }) => (
                  <PieceBar
                    key={piece.id} duty={duty} piece={piece} top={39} height={4}
                    left={x(piece.startMinutes)} width={(piece.endMinutes - piece.startMinutes) * pxPerMinute}
                    selected={duty.id === selectedDutyId} hasIssue={issuePieceIds.has(piece.id)}
                    localityName={localityName} onClick={() => onPieceClick(duty, piece)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PieceBar({ duty, piece, top, height, left, width, selected, hasIssue, localityName, onClick }: {
  duty: BoardDuty; piece: BoardPiece; top: number; height: number; left: number; width: number
  selected: boolean; hasIssue: boolean; localityName: (id: string) => string; onClick: () => void
}) {
  const label = formatDutyNumber(duty.role, duty.dutyNumber)
  const title = [
    `${label} · ${fmtTime(piece.startMinutes)} ${localityName(piece.startLocalityId)} → ${fmtTime(piece.endMinutes)} ${localityName(piece.endLocalityId)}`,
    piece.isStale && piece.staleReason ? `Desatualizada: ${STALE_LABEL[piece.staleReason]}` : null,
    hasIssue ? 'Com pendências' : null,
  ].filter(Boolean).join('\n')

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'absolute z-[5] rounded-sm text-[10px] font-medium text-white overflow-hidden whitespace-nowrap px-1 text-left',
        selected && 'ring-2 ring-offset-1 ring-foreground ring-offset-background',
        piece.isStale && 'opacity-60 outline outline-2 outline-dashed outline-red-600',
        !piece.isStale && hasIssue && 'outline outline-2 outline-amber-500',
      )}
      style={{ top, height, left, width: Math.max(2, width), backgroundColor: dutyColor(duty), lineHeight: `${height}px` }}
    >
      {height >= 12 ? label : null}
    </button>
  )
}
