'use client'

import { useEffect, useRef, useState } from 'react'
import { GanttEngine, type EngineState } from '../engine/gantt-engine'
import { vehiclesView, type VehiclePlanGanttData, type GanttBlock, type GanttBlockTrip } from '../views/vehicles.view'
import { TimeRuler }          from './TimeRuler'
import { RowList }            from './RowList'
import { SegmentTooltip }     from './SegmentTooltip'
import { BlockDetailPopover } from './BlockDetailPopover'
import type { LayoutRow, LayoutSegment } from '../engine/layout/layout.types'
import type { ViewportSnapshot }         from '../engine/gantt.types'

const RULER_HEIGHT = 40   // px — matches TimeRuler h-10
export const LABEL_WIDTH  = 160  // px — matches RowList width

interface Props {
  data:              VehiclePlanGanttData
  onViewportChange?: (vp: ViewportSnapshot) => void
}

interface TooltipState {
  segment: LayoutSegment
  rect:    DOMRect
  headway: number | null
}

function computeHeadway(seg: LayoutSegment, blocks: GanttBlock[]): number | null {
  if (seg.isDeadhead) return null
  const bt     = seg.data as GanttBlockTrip
  const lineId = bt.trip.route.line.id
  const dir    = bt.trip.route.direction

  const departures = blocks
    .flatMap(b => b.blockTrips)
    .filter(t => !t.isDeadhead && t.trip.route.line.id === lineId && t.trip.route.direction === dir)
    .map(t => t.trip.departureMinutes)
    .sort((a, b) => a - b)

  const dep = bt.trip.departureMinutes
  const idx = departures.indexOf(dep)
  if (idx < 0 || departures.length < 2) return null

  if (idx < departures.length - 1) return departures[idx + 1] - dep
  return dep - departures[idx - 1]
}

interface BlockDetailState {
  block:   GanttBlock
  screenY: number
  screenX: number
}

const INITIAL_VP: ViewportSnapshot = {
  scrollX: 0, scrollY: 0, pixelsPerMinute: 1.2,
  width: 0, dayStartMinute: 0,
}

export function GanttBoard({ data, onViewportChange }: Props) {
  const canvasRef            = useRef<HTMLCanvasElement>(null)
  const containerRef         = useRef<HTMLDivElement>(null)
  const engineRef            = useRef<GanttEngine | null>(null)
  const onViewportChangeRef  = useRef(onViewportChange)
  const dataRef              = useRef(data)
  useEffect(() => { onViewportChangeRef.current = onViewportChange }, [onViewportChange])
  useEffect(() => { dataRef.current = data }, [data])

  const [vp,           setVp]           = useState<ViewportSnapshot>(INITIAL_VP)
  const [layoutRows,   setLayoutRows]   = useState<LayoutRow[]>([])
  const [canvasH,      setCanvasH]      = useState(0)
  const [tooltip,      setTooltip]      = useState<TooltipState | null>(null)
  const [blockDetail,  setBlockDetail]  = useState<BlockDetailState | null>(null)

  // ── engine lifecycle ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = containerRef.current
    if (!canvas || !wrap) return

    const engine      = new GanttEngine()
    engineRef.current = engine
    let initialized   = false

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setCanvasH(height)
      if (!initialized) {
        engine.viewport.resize(width, height)
        engine.init(canvas)
        initialized = true
      } else {
        engine.resize(width, height)
      }
    })
    ro.observe(wrap)

    engine.onStateChangeCallback((state: EngineState) => {
      setVp(state.viewport)
      setLayoutRows(state.layoutRows)
      onViewportChangeRef.current?.(state.viewport)

      if (state.hoveredSegment) {
        const rect = engine.getSegmentRect(state.hoveredSegment.id)
        if (rect) {
          setTooltip({
            segment: state.hoveredSegment,
            rect,
            headway: computeHeadway(state.hoveredSegment, dataRef.current?.blocks ?? []),
          })
        }
      } else {
        setTooltip(null)
      }
    })

    engine.onSegmentClickCallback((seg) => {
      const rect = engine.getSegmentRect(seg.id)
      if (rect) {
        setTooltip({
          segment: seg,
          rect,
          headway: computeHeadway(seg, dataRef.current?.blocks ?? []),
        })
      }
    })

    return () => {
      ro.disconnect()
      engine.dispose()
      engineRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── load view when data changes ─────────────────────────────────────────────

  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !data) return
    engine.setView(vehiclesView, data)
  }, [data])

  // ── block detail popover ────────────────────────────────────────────────────

  function handleRowInfo(row: LayoutRow) {
    const block   = row.data as GanttBlock
    const screenY = RULER_HEIGHT + row.y - vp.scrollY
    const screenX = LABEL_WIDTH + 8
    setBlockDetail({ block, screenY, screenX })
  }

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background relative">
      {/* header: corner + time ruler */}
      <div className="flex shrink-0" style={{ height: RULER_HEIGHT }}>
        <div
          className="shrink-0 border-b border-r bg-muted/30 z-10 flex items-end px-3 pb-1"
          style={{ width: LABEL_WIDTH }}
        >
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Bloco</span>
        </div>
        <div className="flex-1 min-w-0">
          <TimeRuler viewport={vp} />
        </div>
      </div>

      {/* content: row labels + canvas */}
      <div className="flex flex-1 overflow-hidden">
        <div className="border-r bg-muted/10 shrink-0" style={{ width: LABEL_WIDTH }}>
          <RowList
            rows={layoutRows}
            scrollY={vp.scrollY}
            height={canvasH}
            onInfoClick={handleRowInfo}
          />
        </div>

        <div ref={containerRef} className="relative flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
          />

          {tooltip && (
            <SegmentTooltip
              segment={tooltip.segment}
              rect={tooltip.rect}
              containerW={vp.width}
              containerH={canvasH}
              headway={tooltip.headway}
            />
          )}
        </div>
      </div>

      {/* block detail popover — positioned relative to the full board */}
      {blockDetail && (
        <BlockDetailPopover
          block={blockDetail.block}
          screenY={blockDetail.screenY}
          screenX={blockDetail.screenX}
          onClose={() => setBlockDetail(null)}
        />
      )}
    </div>
  )
}
