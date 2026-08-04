'use client'

// Prototype for the running-schedule table ("tabela de horários corridos")
// discussed alongside the line schedule generator. Corrected from a first
// pass that reused the Gantt canvas engine (time-proportional Viewport,
// ruler) — that doesn't fit here: columns are trip *order*, not clock time,
// so a trip in column 3 of Ida has no time relationship to column 3 of
// Volta or to another line's column 3. This is a plain table, not a
// timeline. In the real feature this still replaces the Gantt view in place
// via the same view toggle — it just isn't built on GanttEngine.
//
// Per line: 4 rows — headway-Ida (above), Ida, Volta, headway-Volta (below).
// Multiple lines stack in the same table. Keyboard nav (arrows, shift+arrows)
// only ever walks Ida/Volta trip cells; headway cells are never focusable.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { Icons } from '@/lib/icons'
import { MOCK_LINES, type LineTrips, type MockTrip } from './trips-mock'
import { minutesToLabel } from './generator-logic'

interface NavRow {
  key:      string // `${lineCode}:${dir}`
  lineCode: string
  dirLabel: 'Ida' | 'Volta'
  trips:    MockTrip[]
}

interface Focus { rowKey: string; idx: number }
interface Range { rowKey: string; from: number; to: number }

const LABEL_COL_1_WIDTH = 'w-14' // line code
const LABEL_COL_2_LEFT  = 'left-14' // must match LABEL_COL_1_WIDTH

function buildNavRows(lines: LineTrips[]): NavRow[] {
  return lines.flatMap((line) => [
    { key: `${line.code}:out`, lineCode: line.code, dirLabel: 'Ida' as const,   trips: line.outbound },
    { key: `${line.code}:in`,  lineCode: line.code, dirLabel: 'Volta' as const, trips: line.inbound  },
  ])
}

const DEFAULT_HINT = 'Setas navegam entre viagens · Shift+seta seleciona um intervalo'

interface Props {
  onClose: () => void
}

export function TripsGridPrototype({ onClose }: Props) {
  useShortcutContext('modal')

  const navRows = useMemo(() => buildNavRows(MOCK_LINES), [])

  const [focus, setFocus] = useState<Focus | null>(null)
  const [range, setRange] = useState<Range | null>(null)
  const anchorRef = useRef<number | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function focusCell(rowKey: string, idx: number) {
    setFocus({ rowKey, idx })
    setRange(null)
    anchorRef.current = idx
  }

  useShortcut('←', () => {
    setRange(null); anchorRef.current = null
    if (!focus) {
      const first = navRows.find((r) => r.trips.length > 0)
      if (first) setFocus({ rowKey: first.key, idx: 0 })
      return
    }
    if (focus.idx > 0) setFocus({ ...focus, idx: focus.idx - 1 })
  }, { context: 'modal', desc: 'Viagem anterior', display: false })

  useShortcut('→', () => {
    setRange(null); anchorRef.current = null
    if (!focus) {
      const first = navRows.find((r) => r.trips.length > 0)
      if (first) setFocus({ rowKey: first.key, idx: 0 })
      return
    }
    const row = navRows.find((r) => r.key === focus.rowKey)
    if (row && focus.idx < row.trips.length - 1) setFocus({ ...focus, idx: focus.idx + 1 })
  }, { context: 'modal', desc: 'Próxima viagem', display: false })

  useShortcut('↑', () => {
    if (!focus) return
    setRange(null); anchorRef.current = null
    const i = navRows.findIndex((r) => r.key === focus.rowKey)
    for (let bi = i - 1; bi >= 0; bi--) {
      if (navRows[bi].trips.length === 0) continue
      setFocus({ rowKey: navRows[bi].key, idx: Math.min(focus.idx, navRows[bi].trips.length - 1) })
      break
    }
  }, { context: 'modal', desc: 'Mesma coluna, linha/sentido anterior', display: false })

  useShortcut('↓', () => {
    if (!focus) return
    setRange(null); anchorRef.current = null
    const i = navRows.findIndex((r) => r.key === focus.rowKey)
    for (let bi = i + 1; bi < navRows.length; bi++) {
      if (navRows[bi].trips.length === 0) continue
      setFocus({ rowKey: navRows[bi].key, idx: Math.min(focus.idx, navRows[bi].trips.length - 1) })
      break
    }
  }, { context: 'modal', desc: 'Mesma coluna, linha/sentido seguinte', display: false })

  useShortcut('shift+←', () => {
    if (!focus) return
    if (anchorRef.current === null) anchorRef.current = focus.idx
    const nextIdx = Math.max(0, focus.idx - 1)
    setFocus({ ...focus, idx: nextIdx })
    setRange({ rowKey: focus.rowKey, from: anchorRef.current, to: nextIdx })
  }, { context: 'modal', desc: 'Estender seleção para trás', display: false })

  useShortcut('shift+→', () => {
    if (!focus) return
    if (anchorRef.current === null) anchorRef.current = focus.idx
    const row = navRows.find((r) => r.key === focus.rowKey)
    if (!row) return
    const nextIdx = Math.min(row.trips.length - 1, focus.idx + 1)
    setFocus({ ...focus, idx: nextIdx })
    setRange({ rowKey: focus.rowKey, from: anchorRef.current, to: nextIdx })
  }, { context: 'modal', desc: 'Estender seleção para frente', display: false })

  function isFocused(rowKey: string, idx: number): boolean {
    return focus?.rowKey === rowKey && focus.idx === idx
  }
  function isInRange(rowKey: string, idx: number): boolean {
    if (!range || range.rowKey !== rowKey) return false
    const lo = Math.min(range.from, range.to)
    const hi = Math.max(range.from, range.to)
    return idx >= lo && idx <= hi
  }

  const selectionSummary = useMemo(() => {
    if (range) {
      const n = Math.abs(range.to - range.from) + 1
      return `${n} viagens selecionadas`
    }
    if (focus) {
      const row = navRows.find((r) => r.key === focus.rowKey)
      const trip = row?.trips[focus.idx]
      if (trip) return `Viagem selecionada — ${row!.lineCode} · ${row!.dirLabel} · ${minutesToLabel(trip.dep)}`
    }
    return DEFAULT_HINT
  }, [focus, range, navRows])

  function headwayCells(trips: MockTrip[]) {
    return trips.map((t, i) => (
      <td
        key={t.id}
        className="px-2 py-0.5 text-center text-[10px] text-muted-foreground/70 border-l border-border/30 whitespace-nowrap"
      >
        {i > 0 ? `${t.dep - trips[i - 1].dep}'` : ''}
      </td>
    ))
  }

  function tripCells(rowKey: string, trips: MockTrip[]) {
    return trips.map((t, i) => {
      const focused = isFocused(rowKey, i)
      const inRange = isInRange(rowKey, i)
      return (
        <td
          key={t.id}
          onClick={() => focusCell(rowKey, i)}
          className={[
            'px-2 py-1 text-center text-xs font-mono cursor-pointer select-none border-l border-border/30 whitespace-nowrap',
            focused ? 'ring-2 ring-inset ring-ring' : '',
            inRange && !focused ? 'bg-ring/20' : '',
          ].join(' ')}
        >
          {minutesToLabel(t.dep)}
        </td>
      )
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full h-[92vh] mx-4 flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Viagens</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{selectionSummary}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="border-collapse">
            <tbody>
              {MOCK_LINES.map((line) => {
                const outKey = `${line.code}:out`
                const inKey  = `${line.code}:in`
                return (
                  <Fragment key={line.code}>
                    <tr>
                      <td className={`sticky left-0 ${LABEL_COL_1_WIDTH} bg-card`} />
                      <td className={`sticky ${LABEL_COL_2_LEFT} bg-card px-2 py-0.5 text-[10px] text-muted-foreground/70 border-r border-border/30 whitespace-nowrap`}>
                        Intervalo
                      </td>
                      {headwayCells(line.outbound)}
                    </tr>
                    <tr>
                      <td
                        rowSpan={2}
                        className={`sticky left-0 ${LABEL_COL_1_WIDTH} bg-card px-2 py-1 text-xs font-medium align-middle border-r border-border/30 whitespace-nowrap`}
                      >
                        {line.code}
                      </td>
                      <td className={`sticky ${LABEL_COL_2_LEFT} bg-card px-2 py-1 text-xs text-muted-foreground border-r border-border/30 whitespace-nowrap`}>
                        Ida
                      </td>
                      {tripCells(outKey, line.outbound)}
                    </tr>
                    <tr>
                      <td className={`sticky ${LABEL_COL_2_LEFT} bg-card px-2 py-1 text-xs text-muted-foreground border-r border-border/30 whitespace-nowrap`}>
                        Volta
                      </td>
                      {tripCells(inKey, line.inbound)}
                    </tr>
                    <tr>
                      <td className={`sticky left-0 ${LABEL_COL_1_WIDTH} bg-card border-b-4 border-b-background`} />
                      <td className={`sticky ${LABEL_COL_2_LEFT} bg-card px-2 py-0.5 text-[10px] text-muted-foreground/70 border-r border-border/30 border-b-4 border-b-background whitespace-nowrap`}>
                        Intervalo
                      </td>
                      {headwayCells(line.inbound)}
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
