'use client'

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { formatDutyNumber, type ReliefPoint } from '@nyx/schemas'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'
import type { BoardBlock, BoardDuty, BoardPiece } from '../board.types'
import { LABEL_W, Ruler, HourGrid, type TimeRange } from './Timeline'
import { PinToggle } from './CrewFilterBar'
import { fmtTime, fmtDuration, dutyColorVars, SWATCH_BG_CLASS, LINE_BG_CLASS, STALE_LABEL, DEADRUN_LABEL, DEADRUN_CLASS } from '../board.types'
import type { CSSProperties, Ref } from 'react'

// One row per vehicle block: the vehicle lane on top (trips, deadruns, intervals and the
// relief points where a piece may start/end) and the crew lane below (DRIVER pieces
// colored per duty, uncovered spans in red). Pieces of other roles get a thin extra lane.
// Clicking a relief point ends a piece there, starting it where the uncovered stretch
// before it begins; shift+click picks the start explicitly (then a second click ends it).

export interface PieceDraftStart {
  blockId: string
  point:   ReliefPoint
}

interface Props {
  range:          TimeRange
  blocks:         BoardBlock[]
  duties:         BoardDuty[]
  uncovered:      { vehicleBlockId: string; startMinutes: number; endMinutes: number }[]
  localityName:   (id: string) => string
  pxPerMinute:    number
  selectedDutyId: string | null
  draftStart:     PieceDraftStart | null
  canEdit:        boolean
  onPointClick:   (block: BoardBlock, point: ReliefPoint, pickStart: boolean) => void
  onPieceClick:   (duty: BoardDuty, piece: BoardPiece) => void
  // line code → color vars when "Cores das linhas" is on; null = neutral trips
  lineColors:     Map<string, CSSProperties> | null
  scrollRef:      Ref<HTMLDivElement>
  // pin toggles shown while the filter bar is open
  pinnable:       boolean
  pinnedIds:      Set<string>
  onTogglePin:    (blockId: string) => void
}

const ROW_H   = 44

export function CrewBoard({
  range, blocks, duties, uncovered, localityName, pxPerMinute, selectedDutyId, draftStart, canEdit, onPointClick, onPieceClick,
  lineColors, scrollRef, pinnable, pinnedIds, onTogglePin,
}: Props) {
  // relief points are only rendered for the hovered row (or the row being picked on) —
  // a plan easily has ~200 blocks × ~100 points each
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)

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

  // stable callbacks so memoized rows skip re-rendering when only the page re-renders
  const handlers = useRef({ onPointClick, onPieceClick, onTogglePin })
  useLayoutEffect(() => { handlers.current = { onPointClick, onPieceClick, onTogglePin } })
  const pointClick = useCallback((block: BoardBlock, point: ReliefPoint, pickStart: boolean) => handlers.current.onPointClick(block, point, pickStart), [])
  const pieceClick = useCallback((duty: BoardDuty, piece: BoardPiece) => handlers.current.onPieceClick(duty, piece), [])
  const togglePin  = useCallback((blockId: string) => handlers.current.onTogglePin(blockId), [])

  const width = (range.end - range.start) * pxPerMinute

  return (
    // pin toggles are shown via CSS so opening/closing the filter doesn't re-render every row
    <div ref={scrollRef} className="h-full overflow-auto group/board" data-pinnable={pinnable || undefined}>
      <div style={{ width: LABEL_W + width }} className="relative">
        <Ruler range={range} pxPerMinute={pxPerMinute} />

        {blocks.map(block => {
          const items = piecesByBlock.get(block.id) ?? NONE
          return (
            <BlockRow
              key={block.id} block={block} items={items} uncovered={uncoveredByBlock.get(block.id) ?? NONE}
              range={range} pxPerMinute={pxPerMinute} localityName={localityName} lineColors={lineColors} canEdit={canEdit}
              hovered={hoveredBlockId === block.id}
              draftStart={draftStart?.blockId === block.id ? draftStart : null}
              selectedDutyId={items.some(i => i.duty.id === selectedDutyId) ? selectedDutyId : null}
              issuePieceIds={issuePieceIds} pinned={pinnedIds.has(block.id)}
              onHover={setHoveredBlockId} onPointClick={pointClick} onPieceClick={pieceClick} onTogglePin={togglePin}
            />
          )
        })}
      </div>
    </div>
  )
}

const NONE: never[] = []

const BlockRow = memo(function BlockRow({
  block, items, uncovered: blockUncovered, range, pxPerMinute, localityName, lineColors, canEdit, hovered, draftStart,
  selectedDutyId, issuePieceIds, pinned, onHover, onPointClick, onPieceClick, onTogglePin,
}: {
  block: BoardBlock; items: { duty: BoardDuty; piece: BoardPiece }[]
  uncovered: { startMinutes: number; endMinutes: number }[]; range: TimeRange; pxPerMinute: number
  localityName: (id: string) => string; lineColors: Map<string, CSSProperties> | null; canEdit: boolean
  hovered: boolean; draftStart: PieceDraftStart | null; selectedDutyId: string | null; issuePieceIds: Set<string>
  pinned: boolean; onHover: Dispatch<SetStateAction<string | null>>
  onPointClick: (block: BoardBlock, point: ReliefPoint, pickStart: boolean) => void
  onPieceClick: (duty: BoardDuty, piece: BoardPiece) => void; onTogglePin: (blockId: string) => void
}) {
  const x          = (m: number) => (m - range.start) * pxPerMinute
  const width      = (range.end - range.start) * pxPerMinute
  const driver     = items.filter(i => i.duty.role === 'DRIVER')
  const others     = items.filter(i => i.duty.role !== 'DRIVER')
  const isDraftRow = draftStart != null

  return (
    <div
      data-row={block.id}
      className={cn('flex border-b border-border/60', isDraftRow && 'bg-accent/30')}
      style={{ height: ROW_H }}
      onMouseEnter={() => onHover(block.id)}
      onMouseLeave={() => onHover(h => (h === block.id ? null : h))}
    >
      <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-background border-r border-border flex items-center justify-between px-2 text-xs">
        <span className="flex items-center gap-1 font-medium">
          <span className="hidden group-data-[pinnable]/board:inline-flex">
            <PinToggle pinned={pinned} onToggle={() => onTogglePin(block.id)} noun="carro" />
          </span>
          Carro {block.blockNumber}
        </span>
        {blockUncovered.length > 0 && <Icons.AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" aria-label="Trechos sem motorista" />}
      </div>

      <div className="relative" style={{ width }}>
        <HourGrid range={range} pxPerMinute={pxPerMinute} />

        {/* vehicle lane */}
        {block.trips.map(t => {
          const lineVars = lineColors?.get(t.lineCode)
          return (
            <div
              key={t.id}
              className={cn(
                'absolute top-1 h-4 rounded-sm text-[9px] leading-4 overflow-hidden whitespace-nowrap px-0.5',
                lineVars
                  ? cn(LINE_BG_CLASS, 'text-slate-800 dark:text-slate-100')
                  : 'bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200',
              )}
              style={{ ...lineVars, left: x(t.departureMinutes), width: Math.max(1, (t.arrivalMinutes - t.departureMinutes) * pxPerMinute) }}
              title={`${t.lineCode} ${fmtTime(t.departureMinutes)}–${fmtTime(t.arrivalMinutes)}`}
            >
              {t.lineCode}
            </div>
          )
        })}
        {block.deadruns.map(d => (
          <div
            key={d.id}
            className={cn('absolute top-1 h-4 rounded-sm text-[9px] leading-[14px] overflow-hidden whitespace-nowrap px-0.5', DEADRUN_CLASS)}
            style={{ left: x(d.departureMinutes), width: Math.max(2, (d.arrivalMinutes - d.departureMinutes) * pxPerMinute) }}
            title={`Trajeto ocioso · ${DEADRUN_LABEL[d.type] ?? d.type} ${fmtTime(d.departureMinutes)}–${fmtTime(d.arrivalMinutes)}`}
          >
            {DEADRUN_LABEL[d.type] ?? d.type}
          </div>
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
        {canEdit && (hovered || isDraftRow) && block.points.map((p, idx) => {
          const isStart = draftStart != null && draftStart.point.minutes === p.minutes && draftStart.point.localityId === p.localityId
          return (
            <button
              key={`${p.localityId}:${p.minutes}:${idx}`}
              type="button"
              onClick={(e) => onPointClick(block, p, e.shiftKey)}
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
            className="absolute top-6 h-3.5 rounded-sm bg-red-500/20 border border-red-500/60 text-[10px] leading-3 font-medium text-red-700 dark:text-red-300 overflow-hidden whitespace-nowrap px-1"
            style={{ left: x(u.startMinutes), width: Math.max(1, (u.endMinutes - u.startMinutes) * pxPerMinute) }}
            title={`Sem motorista ${fmtTime(u.startMinutes)}–${fmtTime(u.endMinutes)} (${fmtDuration(u.endMinutes - u.startMinutes)})`}
          >
            {fmtDuration(u.endMinutes - u.startMinutes)}
          </div>
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
})

function PieceBar({ duty, piece, top, height, left, width, selected, hasIssue, localityName, onClick }: {
  duty: BoardDuty; piece: BoardPiece; top: number; height: number; left: number; width: number
  selected: boolean; hasIssue: boolean; localityName: (id: string) => string; onClick: () => void
}) {
  const label    = formatDutyNumber(duty.role, duty.dutyNumber)
  // this piece's own length only — a duty spread over several blocks shows one per block
  const duration = fmtDuration(piece.endMinutes - piece.startMinutes)
  const title = [
    `${label} · ${duration} · ${fmtTime(piece.startMinutes)} ${localityName(piece.startLocalityId)} → ${fmtTime(piece.endMinutes)} ${localityName(piece.endLocalityId)}`,
    piece.isStale && piece.staleReason ? `Desatualizada: ${STALE_LABEL[piece.staleReason]}` : null,
    hasIssue ? 'Com pendências' : null,
  ].filter(Boolean).join('\n')

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'absolute z-[5] flex items-center justify-between gap-1 rounded-sm text-[10px] font-medium text-white overflow-hidden whitespace-nowrap px-1 text-left',
        SWATCH_BG_CLASS,
        selected && 'ring-2 ring-offset-1 ring-foreground ring-offset-background',
        // stale = the piece no longer fits its block (dashed red); issues get an icon instead
        piece.isStale && 'opacity-60 outline outline-2 outline-dashed outline-red-600',
      )}
      style={{ ...dutyColorVars(duty), top, height, left, width: Math.max(2, width), lineHeight: `${height}px` }}
    >
      {height >= 12 && <span className="truncate">{label} • {duration}</span>}
      {height >= 12 && hasIssue && !piece.isStale && (
        <Icons.Circle className="w-2.5 h-2.5 shrink-0 fill-current text-amber-200" aria-label="Com pendências" />
      )}
    </button>
  )
}
