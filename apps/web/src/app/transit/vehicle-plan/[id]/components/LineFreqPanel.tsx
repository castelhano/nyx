'use client'

// Sidebar "Line frequency" panel — read-only mirror of the trip focused on
// the GanttBoard (focusedSegId), or the plan's first line when nothing is
// focused (e.g. panel opened outside edit mode). Shows the whole line for
// the focused direction, columns [freq][I][V][freq] (bidirectional) or
// [freq][C] (single direction), clipped (no scroll) and centered on the
// focused trip. See docs/TODO.md and line-freq.view.ts for the layout/index
// behind this.
//
// Has no focus/selection of its own — clicking cells does nothing; the only
// interactions are the line-switch arrows, which just call onFocusChange
// (the GanttBoard itself already listens to focusedSegId and scrolls to the
// segment).

import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { DIRECTION_LABELS } from '../views/vehicles.view'
import type { LineFreqIndex, FreqLineGroup, FreqTrip, FreqDeltaInfo } from '../views/line-freq.view'

interface Props {
  index:         LineFreqIndex
  focusedSegId:  string | null
  onFocusChange: (segId: string) => void
  rangeSegIds?:  Set<string> | null
}

export const PANEL_WIDTH = 176
const FREQ_COL_PX = 32
const TIME_COL_PX = 56
const TITLE_H     = 22
const HEADER_H    = 18
const ROW_H       = 24

function colWidth(px: number) {
  return { width: px, minWidth: px, maxWidth: px }
}

function formatMinute(m: number): string {
  const h = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function firstTripId(group: FreqLineGroup): string | null {
  return group.outbound[0]?.id ?? group.inbound[0]?.id ?? null
}

function formatDeltaTooltip(deltaInfo: FreqDeltaInfo[]): string {
  return deltaInfo.map(d => {
    const lines = d.perLine.map(l => `${l.lineCode}: ${l.offsetMinutes}min até o delta`).join('\n')
    return `${DIRECTION_LABELS[d.direction] ?? d.direction} — delta: ${d.localityName}\n${lines}`
  }).join('\n\n')
}

const LINE_TINT_PALETTE = ['border-l-blue-500', 'border-l-emerald-500', 'border-l-violet-500', 'border-l-amber-500']

export function LineFreqPanel({ index, focusedSegId, onFocusChange, rangeSegIds }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState(0)

  // Which group (a line, or the combined "Multilinha" entry) is on screen —
  // deliberately its own state, not derived from focusedSegId: clicking a trip
  // elsewhere on the Gantt must never force a switch away from whatever's
  // showing here (Fase 4). Defaults to lineOrder[0], which is the combined
  // entry when one exists — that's the intended first view, focus or not.
  const [activeKey, setActiveKey] = useState(index.lineOrder[0] ?? '')

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setBodyHeight(entries[0].contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Only resets when the active group actually vanishes (e.g. the line
  // selection changed) — never just because focus moved.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- corrects a now-invalid key, not a reaction to focus
    if (!index.groups.has(activeKey) && index.lineOrder.length > 0) setActiveKey(index.lineOrder[0])
  }, [index, activeKey])

  const group = index.groups.get(activeKey)

  function changeLine(delta: number) {
    if (index.lineOrder.length === 0) return
    const curPos  = index.lineOrder.indexOf(activeKey)
    const nextPos = (curPos + delta + index.lineOrder.length) % index.lineOrder.length
    const nextKey = index.lineOrder[nextPos]
    setActiveKey(nextKey)
    const nextGroup = index.groups.get(nextKey)
    const tripId = nextGroup && firstTripId(nextGroup)
    if (tripId) onFocusChange(tripId)
  }

  const visibleRows = Math.max(1, Math.floor((bodyHeight - HEADER_H) / ROW_H))

  // Row to center the (clipped, no-scroll) window on — the focused trip's own
  // position *within whatever group is currently shown*, found by id rather
  // than the per-line segIndex (which doesn't know about combined-group rows,
  // and would point outside this group's list entirely when focus is on a
  // line that isn't — or isn't only — the one on screen).
  let centerIdx = 0
  if (group && focusedSegId) {
    const outIdx = group.outbound.findIndex(t => t.id === focusedSegId)
    const inIdx  = outIdx < 0 && group.mode === 'both' ? group.inbound.findIndex(t => t.id === focusedSegId) : -1
    if (outIdx >= 0) centerIdx = outIdx
    else if (inIdx >= 0) centerIdx = inIdx
  }

  let rows: number[] = []
  if (group) {
    const totalRows = group.mode === 'both'
      ? Math.max(group.outbound.length, group.inbound.length)
      : group.outbound.length
    const start = Math.max(0, Math.min(totalRows - visibleRows, centerIdx - Math.floor(visibleRows / 2)))
    rows = Array.from({ length: Math.min(visibleRows, Math.max(0, totalRows - start)) }, (_, i) => start + i)
  }

  // lineCode → color, stable within this group (only combined-group rows carry
  // lineCode at all — regular per-line groups render with no tint).
  const lineTintByCode = new Map<string, string>()
  if (group) {
    for (const t of [...group.outbound, ...group.inbound]) {
      if (t.lineCode && !lineTintByCode.has(t.lineCode)) {
        lineTintByCode.set(t.lineCode, LINE_TINT_PALETTE[lineTintByCode.size % LINE_TINT_PALETTE.length])
      }
    }
  }

  function headwayCell(t: FreqTrip | undefined, key: string) {
    return (
      <td key={key} style={colWidth(FREQ_COL_PX)} className="text-center text-[10px] text-muted-foreground tabular-nums">
        {t ? (t.headway == null ? '::' : `${t.headway}'`) : ''}
      </td>
    )
  }

  function timeCell(t: FreqTrip | undefined, key: string) {
    const focused = !!t && t.id === focusedSegId
    const inRange = !focused && !!t && !!rangeSegIds?.has(t.id)
    const tint    = t?.lineCode ? lineTintByCode.get(t.lineCode) : undefined
    return (
      <td
        key={key}
        style={colWidth(TIME_COL_PX)}
        title={t?.lineCode ? `${t.lineCode} · ${formatMinute(t.dep)}` : undefined}
        className={[
          'text-center text-xs font-mono py-0.5',
          focused ? 'bg-ring/20 ring-1 ring-inset ring-ring rounded-sm' : '',
          inRange ? 'bg-ring/20' : '',
          tint ? `border-l-2 ${tint}` : '',
        ].join(' ')}
      >
        {t ? formatMinute(t.dep) : ''}
      </td>
    )
  }

  return (
    <div
      className="absolute top-0 right-2 z-10 border border-border/60 rounded-md bg-card shadow-md overflow-hidden flex flex-col"
      style={{ width: PANEL_WIDTH, height: '100%' }}
    >
      <div className="flex items-center justify-between px-1 border-b border-border/60 shrink-0" style={{ height: TITLE_H }}>
        <button onClick={() => changeLine(-1)} className="text-muted-foreground hover:text-foreground p-0.5 shrink-0">
          <Icons.ArrowLeft className="w-3 h-3" />
        </button>
        <div className="flex items-center gap-0.5 min-w-0">
          <div className="text-xs font-semibold truncate px-0.5" title={group?.lineCode}>{group?.lineCode ?? '—'}</div>
          {group?.deltaInfo && group.deltaInfo.length > 0 && (
            <span
              title={formatDeltaTooltip(group.deltaInfo)}
              className="text-muted-foreground hover:text-foreground shrink-0 cursor-help"
            >
              <Icons.Info className="w-3 h-3" />
            </span>
          )}
        </div>
        <button onClick={() => changeLine(1)} className="text-muted-foreground hover:text-foreground p-0.5 shrink-0">
          <Icons.ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div ref={bodyRef} className="flex-1 min-h-0">
        {!group ? (
          <div className="flex items-center justify-center h-full text-center text-[11px] text-muted-foreground px-3">
            Nenhuma linha no plano
          </div>
        ) : (
          <table className="border-collapse w-full" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr className="border-b border-border/30" style={{ height: HEADER_H }}>
                <td style={colWidth(FREQ_COL_PX)} />
                <td style={colWidth(TIME_COL_PX)} className="text-center text-[10px] text-muted-foreground">
                  {group.outboundAbbrev}
                </td>
                {group.mode === 'both' && (
                  <>
                    <td style={colWidth(TIME_COL_PX)} className="text-center text-[10px] text-muted-foreground">
                      {group.inboundAbbrev}
                    </td>
                    <td style={colWidth(FREQ_COL_PX)} />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const out = group.outbound[i]
                const inb = group.mode === 'both' ? group.inbound[i] : undefined
                return (
                  <tr key={i} style={{ height: ROW_H }}>
                    {headwayCell(out, `fl${i}`)}
                    {timeCell(out, `o${i}`)}
                    {group.mode === 'both' && (
                      <>
                        {timeCell(inb, `i${i}`)}
                        {headwayCell(inb, `fr${i}`)}
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
