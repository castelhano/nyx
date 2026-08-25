'use client'

import { useMemo } from 'react'
import type { VehiclePlanGanttData } from '../views/vehicles.view'
import type { ViewportSnapshot }     from '../engine/gantt.types'
import { LABEL_WIDTH }               from './GanttBoard'
import { TimeRuler }                 from './TimeRuler'

const DIRECTION_LABELS: Record<string, string> = {
  OUTBOUND: 'IDA',
  INBOUND:  'VOLTA',
  CIRCULAR: 'CIRC',
}

const DIRECTION_ORDER = ['OUTBOUND', 'INBOUND', 'CIRCULAR']

const DIRECTION_COLORS: Record<string, string> = {
  OUTBOUND: 'bg-blue-500',
  INBOUND:  'bg-emerald-500',
  CIRCULAR: 'bg-violet-500',
}

function fmtMin(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
}

// Snaps to the device pixel grid, not just the CSS pixel grid — on a fractional
// devicePixelRatio (e.g. 125%/150% display scaling) a whole CSS px can still land
// on a blurry half-device-pixel, which is what made these 1px hairlines look
// blurry/"thicker" on some minutes but not others. The canvas Gantt board avoids
// this by rendering at devicePixelRatio scale (engine/gantt-engine.ts); here we
// just snap the CSS position to whatever that grid is.
function snapToDevicePixel(x: number): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return Math.round(x * dpr) / dpr
}

interface Props {
  data:           VehiclePlanGanttData
  vp:             ViewportSnapshot
  focusedTripId?: string | null
}

interface FreqEntry {
  min: number
  // true when this trip's own line has another trip at this exact minute+direction —
  // one vehicle can't run two trips at once, so this almost always signals a
  // generation/edit bug rather than two unrelated lines just coinciding on the clock.
  dup: boolean
}

export function FrequencyPanel({ data, vp, focusedTripId }: Props) {
  const groups = useMemo(() => {
    const raw = new Map<string, { min: number; lineId: string }[]>()

    for (const block of data.blocks) {
      for (const bt of block.blockTrips) {
        const dir = bt.trip.route.direction
        if (!raw.has(dir)) raw.set(dir, [])
        raw.get(dir)!.push({ min: bt.trip.departureMinutes, lineId: bt.trip.route.line.id })
      }
    }

    const map = new Map<string, FreqEntry[]>()
    for (const [dir, list] of raw) {
      const counts = new Map<string, number>()
      for (const e of list) {
        const key = `${e.lineId}:${e.min}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const entries = list
        .map(e => ({ min: e.min, dup: counts.get(`${e.lineId}:${e.min}`)! > 1 }))
        .sort((a, b) => a.min - b.min)
      map.set(dir, entries)
    }
    return map
  }, [data])

  const orderedDirs = [
    ...DIRECTION_ORDER.filter(d => groups.has(d)),
    ...[...groups.keys()].filter(d => !DIRECTION_ORDER.includes(d)),
  ]

  // Focused trip — highlights its own tick below instead of the whole row.
  const focused = useMemo(() => {
    if (!focusedTripId) return null
    for (const block of data.blocks) {
      const bt = block.blockTrips.find(bt => bt.id === focusedTripId)
      if (bt) return { direction: bt.trip.route.direction, min: bt.trip.departureMinutes }
    }
    return null
  }, [data, focusedTripId])

  if (orderedDirs.length === 0) return null

  return (
    <div className="border-t bg-card shrink-0 select-none">
      {/* bars row */}
      <div className="flex items-stretch">

        {/* label column — same width as GanttBoard's row label panel */}
        <div
          className="shrink-0 border-r flex flex-col justify-center py-2 px-2 gap-1"
          style={{ width: LABEL_WIDTH }}
        >
          {orderedDirs.map(dir => (
            <div key={dir} className="h-4 flex items-center justify-end">
              <span className="text-[10px] font-medium text-muted-foreground tracking-wider">
                {DIRECTION_LABELS[dir] ?? dir}
              </span>
            </div>
          ))}
        </div>

        {/* bar area — same coordinate space as GanttBoard canvas */}
        <div className="flex-1 min-w-0 overflow-hidden py-2 flex flex-col gap-1">
          {orderedDirs.map(dir => {
            const entries  = groups.get(dir)!
            const barColor = DIRECTION_COLORS[dir] ?? 'bg-foreground'
            return (
              <div key={dir} className="relative h-4 overflow-hidden">
                {entries.map((entry, i) => {
                  const isFocused = focused != null && focused.direction === dir && focused.min === entry.min
                  const title     = entry.dup ? `${fmtMin(entry.min)} · viagens sobrepostas` : fmtMin(entry.min)
                  const cls       = entry.dup
                    ? 'absolute top-0 bottom-0 w-0.5 bg-amber-400'
                    : isFocused
                      ? `absolute top-0 bottom-0 w-px ${barColor}`
                      : `absolute top-0.5 bottom-0.5 w-px ${barColor} opacity-80`
                  return (
                    <div
                      key={i}
                      title={title}
                      className={cls}
                      style={{ left: snapToDevicePixel((entry.min - vp.dayStartMinute) * vp.pixelsPerMinute - vp.scrollX) }}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>

      </div>

      {/* time ruler — mirrors GanttBoard header layout: LABEL_WIDTH corner + flex-1 ruler */}
      <div className="flex border-t">
        <div className="shrink-0 border-r" style={{ width: LABEL_WIDTH }} />
        <div className="flex-1 min-w-0">
          <TimeRuler viewport={vp} className="border-b-0 bg-card" />
        </div>
      </div>
    </div>
  )
}
