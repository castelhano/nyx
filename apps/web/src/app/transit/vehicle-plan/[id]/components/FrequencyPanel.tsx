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

interface Props {
  data: VehiclePlanGanttData
  vp:   ViewportSnapshot
}

export function FrequencyPanel({ data, vp }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, number[]>()

    for (const block of data.blocks) {
      for (const bt of block.blockTrips) {
        if (bt.isDeadhead) continue
        const dir = bt.trip.route.direction
        if (!map.has(dir)) map.set(dir, [])
        map.get(dir)!.push(bt.trip.departureMinutes)
      }
    }

    for (const minutes of map.values()) minutes.sort((a, b) => a - b)
    return map
  }, [data])

  const orderedDirs = [
    ...DIRECTION_ORDER.filter(d => groups.has(d)),
    ...[...groups.keys()].filter(d => !DIRECTION_ORDER.includes(d)),
  ]

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
            const minutes  = groups.get(dir)!
            const barColor = DIRECTION_COLORS[dir] ?? 'bg-foreground'
            return (
              <div key={dir} className="relative h-4 overflow-hidden">
                {minutes.map((min, i) => (
                  <div
                    key={i}
                    title={fmtMin(min)}
                    className={`absolute top-0.5 bottom-0.5 w-px ${barColor} opacity-80`}
                    style={{ left: (min - vp.dayStartMinute) * vp.pixelsPerMinute - vp.scrollX }}
                  />
                ))}
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
