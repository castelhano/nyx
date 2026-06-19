'use client'

import { Icons } from '@/lib/icons'
import type { LayoutRow } from '../engine/layout/layout.types'
import type { GanttBlock } from '../views/vehicles.view'

interface Props {
  rows:         LayoutRow[]
  scrollY:      number
  height:       number
  onInfoClick?: (row: LayoutRow) => void
}

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const r = m % 60
  return r > 0 ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}

export function RowList({ rows, scrollY, height, onInfoClick }: Props) {
  return (
    <div
      className="overflow-hidden select-none shrink-0"
      style={{ height, width: 160 }}
    >
      <div style={{ position: 'relative', transform: `translateY(-${scrollY}px)`, height: rows.length > 0 ? rows[rows.length - 1].y + rows[rows.length - 1].height : 0 }}>
        {rows.map((row) => {
          const block   = row.data as GanttBlock
          const summary = block?.summary ?? null
          const trips   = block?.blockTrips?.length ?? 0
          const locked  = block?.constraints?.locked === true

          return (
            <div
              key={row.id}
              className="absolute left-0 right-0 flex items-center px-2 border-b border-border/40"
              style={{ top: row.y, height: row.height }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{row.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {trips}v{summary ? ` · ${fmtMinutes(summary.totalMinutes)}` : ''}
                </div>
              </div>

              {/* icon column: info + lock stacked */}
              <div className="flex flex-col items-center gap-0.5 shrink-0 ml-1">
                {onInfoClick && (
                  <button
                    onClick={() => onInfoClick(row)}
                    className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  >
                    <Icons.Info className="w-3 h-3" />
                  </button>
                )}
                {locked && (
                  <span className="p-0.5 text-amber-500">
                    <Icons.Lock className="w-3 h-3" />
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
