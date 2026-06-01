'use client'

import { useMemo } from 'react'
import type { VehiclePlanGanttData } from '../views/vehicles.view'
import type { ViewportSnapshot }     from '../engine/gantt.types'
import { LABEL_WIDTH }               from './GanttBoard'

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
  const { groups, minMinute, maxMinute } = useMemo(() => {
    const groups = new Map<string, number[]>()

    for (const block of data.blocks) {
      for (const bt of block.blockTrips) {
        if (bt.isDeadhead) continue
        const dir = bt.trip.route.direction
        if (!groups.has(dir)) groups.set(dir, [])
        groups.get(dir)!.push(bt.trip.departureMinutes)
      }
    }

    for (const minutes of groups.values()) minutes.sort((a, b) => a - b)

    let minMinute = Infinity
    let maxMinute = -Infinity
    for (const minutes of groups.values()) {
      if (minutes[0] < minMinute)                   minMinute = minutes[0]
      if (minutes[minutes.length - 1] > maxMinute)  maxMinute = minutes[minutes.length - 1]
    }

    if (minMinute === Infinity) { minMinute = 0; maxMinute = 1440 }

    return { groups, minMinute, maxMinute }
  }, [data])

  const orderedDirs = [
    ...DIRECTION_ORDER.filter(d => groups.has(d)),
    ...[...groups.keys()].filter(d => !DIRECTION_ORDER.includes(d)),
  ]

  if (orderedDirs.length === 0) return null

  return (
    <div className="border-t bg-card shrink-0 select-none">
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
          <div className="h-3.5" />
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

          <div className="flex justify-between text-[10px] text-muted-foreground/50 h-3.5">
            <span>{fmtMin(minMinute)}</span>
            <span>{fmtMin(Math.round((minMinute + maxMinute) / 2))}</span>
            <span>{fmtMin(maxMinute)}</span>
          </div>
        </div>

      </div>
    </div>
  )
}
