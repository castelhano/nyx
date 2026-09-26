'use client'

import { useMemo } from 'react'
import { fmtTime } from '../board.types'

// Shared by the vehicle and duty views: the time range, the sticky hour ruler and the hour
// grid lines. Minutes are the operational day's (> 1440 = after midnight).

export const LABEL_W = 88

export interface TimeRange { start: number; end: number }

export function useTimeRange(spans: { startMinutes: number; endMinutes: number }[]): TimeRange {
  return useMemo(() => {
    if (spans.length === 0) return { start: 0, end: 1440 }
    return {
      start: Math.floor(Math.min(...spans.map(s => s.startMinutes)) / 60) * 60,
      end:   Math.ceil(Math.max(...spans.map(s => s.endMinutes)) / 60) * 60,
    }
  }, [spans])
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

export function HourGrid({ range, pxPerMinute }: { range: TimeRange; pxPerMinute: number }) {
  return (
    <>
      {hoursOf(range).map(h => (
        <div key={h} className="absolute top-0 bottom-0 border-l border-border/30" style={{ left: (h - range.start) * pxPerMinute }} />
      ))}
    </>
  )
}
