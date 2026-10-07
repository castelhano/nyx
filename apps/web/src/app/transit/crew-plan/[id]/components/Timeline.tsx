'use client'

import { useMemo, type CSSProperties } from 'react'
import { fmtTime } from '../board.types'

// Shared by the vehicle and duty views: the time range, the sticky hour ruler and the hour
// grid lines. Minutes are the operational day's (> 1440 = after midnight).

export const LABEL_W = 116

export interface TimeRange { start: number; end: number }

// memoized by value: a refetch rebuilds the spans but rarely moves the range, and a new
// object here would re-render every (memoized) row
export function useTimeRange(spans: { startMinutes: number; endMinutes: number }[]): TimeRange {
  const [start, end] = useMemo(() => spans.length === 0 ? [0, 1440] : [
    Math.floor(Math.min(...spans.map(s => s.startMinutes)) / 60) * 60,
    Math.ceil(Math.max(...spans.map(s => s.endMinutes)) / 60) * 60,
  ], [spans])
  return useMemo(() => ({ start, end }), [start, end])
}

export function hoursOf(range: TimeRange): number[] {
  return Array.from({ length: (range.end - range.start) / 60 + 1 }, (_, i) => range.start + i * 60)
}

export function Ruler({ range, pxPerMinute }: { range: TimeRange; pxPerMinute: number }) {
  const width = (range.end - range.start) * pxPerMinute
  return (
    <div className="sticky top-0 z-20 flex bg-background border-b border-border h-7">
      <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-background border-r border-border" />
      <div className="relative" style={{ width }}>
        {hoursOf(range).map(h => (
          <div key={h} className="absolute top-0 bottom-0 border-l border-border/70 text-[10px] text-muted-foreground ps-1 pt-1.5" style={{ left: (h - range.start) * pxPerMinute }}>
            {fmtTime(h)}
          </div>
        ))}
      </div>
    </div>
  )
}

// hour lines as the row's own background instead of one element per hour per row — the
// range starts on a full hour, so the pattern lines up with the ruler
export function hourGridStyle(pxPerMinute: number): CSSProperties {
  return { backgroundImage: `repeating-linear-gradient(to right, hsl(var(--border) / 0.3) 0 1px, transparent 1px ${60 * pxPerMinute}px)` }
}
