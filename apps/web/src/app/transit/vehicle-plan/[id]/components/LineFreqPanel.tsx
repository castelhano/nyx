'use client'

// Painel lateral "Frequência da linha" — espelho só-leitura da viagem focada
// no GanttBoard (focusedSegId). Mostra a linha inteira do sentido focado,
// colunas [freq][I][V][freq] (bidirecional) ou [freq][C] (sentido único),
// recortada (sem scroll) e centralizada na viagem focada. Ver
// docs/TODO.md e line-freq.view.ts pro desenho/índice por trás disso.
//
// Não tem foco/seleção próprios — clicar nas células não faz nada; as únicas
// interações são as setas de troca de linha, que só chamam onFocusChange
// (o próprio GanttBoard já escuta focusedSegId e rola até o segmento).

import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import type { LineFreqIndex, FreqLineGroup, FreqTrip } from '../views/line-freq.view'

interface Props {
  index:         LineFreqIndex
  focusedSegId:  string | null
  onFocusChange: (segId: string) => void
  rangeSegIds?:  Set<string> | null
}

const PANEL_WIDTH = 176
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

export function LineFreqPanel({ index, focusedSegId, onFocusChange, rangeSegIds }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState(0)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setBodyHeight(entries[0].contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const location = focusedSegId ? index.segIndex.get(focusedSegId) : undefined
  const group    = location ? index.groups.get(location.lineId) : undefined

  function changeLine(delta: number) {
    if (index.lineOrder.length === 0) return
    const curPos  = location ? index.lineOrder.indexOf(location.lineId) : -1
    const nextPos = (curPos + delta + index.lineOrder.length) % index.lineOrder.length
    const nextGroup = index.groups.get(index.lineOrder[nextPos])
    const tripId = nextGroup && firstTripId(nextGroup)
    if (tripId) onFocusChange(tripId)
  }

  const visibleRows = Math.max(1, Math.floor((bodyHeight - HEADER_H) / ROW_H))

  let rows: number[] = []
  if (group) {
    const totalRows = group.mode === 'both'
      ? Math.max(group.outbound.length, group.inbound.length)
      : group.outbound.length
    const start = Math.max(0, Math.min(totalRows - visibleRows, location!.idx - Math.floor(visibleRows / 2)))
    rows = Array.from({ length: Math.min(visibleRows, Math.max(0, totalRows - start)) }, (_, i) => start + i)
  }

  function headwayCell(t: FreqTrip | undefined, key: string) {
    return (
      <td key={key} style={colWidth(FREQ_COL_PX)} className="text-center text-[10px] text-muted-foreground tabular-nums">
        {t ? (t.headway == null ? '::' : `${t.headway}'`) : ''}
      </td>
    )
  }

  function timeCell(t: FreqTrip | undefined, idx: number, dir: 'outbound' | 'inbound', key: string) {
    const focused = !!location && location.direction === dir && location.idx === idx
    const inRange = !focused && !!t && !!rangeSegIds?.has(t.id)
    return (
      <td
        key={key}
        style={colWidth(TIME_COL_PX)}
        className={[
          'text-center text-xs font-mono py-0.5',
          focused ? 'bg-ring/20 ring-1 ring-inset ring-ring rounded-sm' : '',
          inRange ? 'bg-ring/20' : '',
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
        <button onClick={() => changeLine(-1)} className="text-muted-foreground hover:text-foreground p-0.5">
          <Icons.ArrowLeft className="w-3 h-3" />
        </button>
        <div className="text-xs font-semibold">{group?.lineCode ?? '—'}</div>
        <button onClick={() => changeLine(1)} className="text-muted-foreground hover:text-foreground p-0.5">
          <Icons.ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div ref={bodyRef} className="flex-1 min-h-0">
        {!group ? (
          <div className="flex items-center justify-center h-full text-center text-[11px] text-muted-foreground px-3">
            Foque uma viagem no Gantt
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
                    {timeCell(out, i, 'outbound', `o${i}`)}
                    {group.mode === 'both' && (
                      <>
                        {timeCell(inb, i, 'inbound', `i${i}`)}
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
