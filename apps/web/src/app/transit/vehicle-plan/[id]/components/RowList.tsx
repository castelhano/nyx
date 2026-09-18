'use client'

import { Icons } from '@/lib/icons'
import type { LayoutRow } from '../engine/layout/layout.types'
import type { GanttBlock } from '../views/vehicles.view'

interface Props {
  rows:              LayoutRow[]
  scrollY:           number
  height:            number
  onInfoClick?:      (row: LayoutRow) => void
  // Pin toggle (docs/proposal/plan_vehicle_plan_block_filter_v1.md §2) — only
  // rendered while the block filter bar is open, otherwise it has no function
  // and is just visual noise.
  showPinToggle?:    boolean
  pinnedBlockIds?:   Set<string>
  onTogglePin?:      (blockId: string) => void
}

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const r = m % 60
  return r > 0 ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}

export function RowList({ rows, scrollY, height, onInfoClick, showPinToggle, pinnedBlockIds, onTogglePin }: Props) {
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

              {/* icon column: pin, info, lock — side by side */}
              <div className="flex flex-row items-center gap-0.5 shrink-0 ml-1">
                {showPinToggle && onTogglePin && (() => {
                  const pinned = pinnedBlockIds?.has(block.id) ?? false
                  return (
                    <button
                      onClick={() => onTogglePin(block.id)}
                      title={pinned ? 'Desafixar bloco (some ao aplicar o filtro)' : 'Fixar bloco (sempre visível, mesmo filtrado)'}
                      className={[
                        'p-1 rounded',
                        pinned ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      ].join(' ')}
                    >
                      {pinned ? <Icons.Eye className="w-3.5 h-3.5" /> : <Icons.EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  )
                })()}
                {onInfoClick && (
                  <button
                    onClick={() => onInfoClick(row)}
                    className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  >
                    <Icons.Info className="w-3.5 h-3.5" />
                  </button>
                )}
                {locked && (
                  <span className="p-1 text-amber-500">
                    <Icons.Lock className="w-3.5 h-3.5" />
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
