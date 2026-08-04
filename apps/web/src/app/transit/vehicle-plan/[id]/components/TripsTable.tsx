'use client'

// Running-schedule table ("Viagens" view) — an alternate rendering of the
// same in-memory plan data GanttBoard reads, grouped by line/direction
// instead of by vehicle block. Columns are trip order, not clock time, so
// this is a plain table (sticky first two columns, no time ruler) rather
// than a canvas timeline — see trips-table.view.ts for the grouping.
//
// Controlled like GanttBoard: focus/range/click flow through props, all
// state and keyboard shortcuts live in the page (see the `viewMode` block in
// page.tsx). Headway cells carry no click handler and are never part of
// `focus`/`range` — keyboard nav only ever walks trip cells.
//
// Every cell gets an explicit width/minWidth/maxWidth inline instead of a
// <colgroup> — a <colgroup>+table-layout:fixed combo measurably didn't hold
// its declared widths once mounted inside this app's layout (confirmed via
// getComputedStyle: declared 56/64/60px columns rendered at ~30/51/45px,
// each a different ratio of its declared width, so not a uniform zoom/scale
// either — the same markup in an isolated page respected <colgroup> exactly,
// so something in this app's cascade fights it specifically). Per-cell
// min/max-width is enforced by the box model directly, independent of
// whatever the table's own column-distribution algorithm decides, so it
// holds regardless. This also matters for the scroll-into-view math below,
// which needs the sticky width to be exactly right, not just close.

import { useEffect, useRef, type CSSProperties } from 'react'
import type { LineTripsGroup, TripCell } from '../views/trips-table.view'

export interface TripsFocus { rowKey: string; idx: number }
export interface TripsRange { rowKey: string; from: number; to: number }

interface Props {
  groups:      LineTripsGroup[]
  focus:       TripsFocus | null
  range:       TripsRange | null
  onCellClick: (rowKey: string, idx: number) => void
}

const LABEL_COL_1_PX = 56  // line code
const LABEL_COL_2_PX = 64  // sentido / "Intervalo"
const TRIP_COL_PX    = 60
const STICKY_WIDTH   = LABEL_COL_1_PX + LABEL_COL_2_PX

function colWidth(px: number): CSSProperties {
  return { width: px, minWidth: px, maxWidth: px }
}

function formatMinute(m: number): string {
  const h = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function TripsTable({ groups, focus, range, onCellClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Keeps the focused trip cell inside the visible (and un-occluded-by-the-
  // sticky-columns) area as arrow-key nav moves it — otherwise focus can walk
  // straight off screen, or land back at index 0 partially hidden behind the
  // sticky label columns since scrollLeft isn't reset on its own. ↑/↓ moves
  // between direction rows (possibly across lines), so this has to follow
  // scrollTop too, not just scrollLeft — nothing sticky occludes vertically,
  // so that half is a plain "is it inside [scrollTop, scrollTop+clientHeight)".
  useEffect(() => {
    if (!focus) return
    const container = containerRef.current
    if (!container) return
    const cell = container.querySelector<HTMLElement>(
      `td[data-row-key="${focus.rowKey}"][data-idx="${focus.idx}"]`,
    )
    if (!cell) return

    const cellLeft  = cell.offsetLeft
    const cellRight = cellLeft + cell.offsetWidth
    const viewLeft  = container.scrollLeft + STICKY_WIDTH
    const viewRight = container.scrollLeft + container.clientWidth

    if (cellLeft < viewLeft) {
      container.scrollLeft = cellLeft - STICKY_WIDTH
    } else if (cellRight > viewRight) {
      container.scrollLeft = cellRight - container.clientWidth
    }

    const cellTop    = cell.offsetTop
    const cellBottom = cellTop + cell.offsetHeight
    if (cellTop < container.scrollTop) {
      container.scrollTop = cellTop
    } else if (cellBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = cellBottom - container.clientHeight
    }
  }, [focus])

  function isFocused(rowKey: string, idx: number): boolean {
    return focus?.rowKey === rowKey && focus.idx === idx
  }
  function isInRange(rowKey: string, idx: number): boolean {
    if (!range || range.rowKey !== rowKey) return false
    const lo = Math.min(range.from, range.to)
    const hi = Math.max(range.from, range.to)
    return idx >= lo && idx <= hi
  }

  function headwayCells(trips: TripCell[], topBorder: string) {
    return trips.map((t) => (
      <td
        key={t.id}
        style={colWidth(TRIP_COL_PX)}
        className={`px-1 py-0.5 text-center text-[10px] text-muted-foreground border-l border-border/30 overflow-hidden whitespace-nowrap ${topBorder}`}
      >
        {t.headway != null ? `${t.headway}'` : ''}
      </td>
    ))
  }

  function tripCells(rowKey: string, trips: TripCell[]) {
    return trips.map((t, i) => {
      const focused = isFocused(rowKey, i)
      const inRange = isInRange(rowKey, i)
      return (
        <td
          key={t.id}
          data-row-key={rowKey}
          data-idx={i}
          onClick={() => onCellClick(rowKey, i)}
          style={colWidth(TRIP_COL_PX)}
          className={[
            'px-1 py-1 text-center text-xs font-mono cursor-pointer select-none border-l border-border/30 overflow-hidden whitespace-nowrap',
            focused ? 'ring-2 ring-inset ring-ring' : '',
            inRange && !focused ? 'bg-ring/20' : '',
          ].join(' ')}
        >
          {formatMinute(t.dep)}
        </td>
      )
    })
  }

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Nenhuma viagem para exibir
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto">
      <table className="border-separate border-spacing-0" style={{ tableLayout: 'fixed' }}>
        {groups.map((group, gi) => {
          const first     = group.directions[0]
          const last      = group.directions[group.directions.length - 1]
          const topBorder = gi > 0 ? 'border-t border-border/60' : ''
          return (
            <tbody key={group.lineId}>
              {first && (
                <tr>
                  <td style={colWidth(LABEL_COL_1_PX)} className={`sticky left-0 bg-card ${topBorder}`} />
                  <td
                    style={{ ...colWidth(LABEL_COL_2_PX), left: LABEL_COL_1_PX }}
                    className={`sticky bg-card px-1 py-0.5 text-[10px] text-muted-foreground border-r border-border/30 overflow-hidden whitespace-nowrap ${topBorder}`}
                  >
                    Intervalo
                  </td>
                  {headwayCells(first.trips, topBorder)}
                </tr>
              )}
              {group.directions.map((dir, di) => {
                const rowKey = `${group.lineId}:${dir.direction}`
                return (
                  <tr key={rowKey}>
                    {di === 0 && (
                      <td
                        rowSpan={group.directions.length}
                        title={group.lineName}
                        style={colWidth(LABEL_COL_1_PX)}
                        className="sticky left-0 bg-card px-1 py-1 text-xs font-medium align-middle border-r border-border/30 overflow-hidden whitespace-nowrap"
                      >
                        {group.lineCode}
                      </td>
                    )}
                    <td
                      style={{ ...colWidth(LABEL_COL_2_PX), left: LABEL_COL_1_PX }}
                      className="sticky bg-card px-1 py-1 text-xs text-muted-foreground border-r border-border/30 overflow-hidden whitespace-nowrap"
                    >
                      {dir.label}
                    </td>
                    {tripCells(rowKey, dir.trips)}
                  </tr>
                )
              })}
              {last && (
                <tr>
                  <td style={colWidth(LABEL_COL_1_PX)} className="sticky left-0 bg-card" />
                  <td
                    style={{ ...colWidth(LABEL_COL_2_PX), left: LABEL_COL_1_PX }}
                    className="sticky bg-card px-1 py-0.5 text-[10px] text-muted-foreground border-r border-border/30 overflow-hidden whitespace-nowrap"
                  >
                    Intervalo
                  </td>
                  {headwayCells(last.trips, '')}
                </tr>
              )}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}
