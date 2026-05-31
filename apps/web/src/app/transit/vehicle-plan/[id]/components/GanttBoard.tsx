'use client'

import { useEffect, useRef, useState } from 'react'
import { GanttEngine, type EngineState } from '../engine/gantt-engine'
import { vehiclesView, type VehiclePlanGanttData } from '../views/vehicles.view'
import { TimeRuler }      from './TimeRuler'
import { RowList }        from './RowList'
import { SegmentTooltip } from './SegmentTooltip'
import type { LayoutRow, LayoutSegment } from '../engine/layout/layout.types'
import type { ViewportSnapshot }         from '../engine/gantt.types'

const RULER_HEIGHT = 40   // px — matches TimeRuler h-10
const LABEL_WIDTH  = 112  // px — matches RowList width

interface Props {
  data: VehiclePlanGanttData
}

interface TooltipState {
  segment: LayoutSegment
  rect:    DOMRect
}

const INITIAL_VP: ViewportSnapshot = {
  scrollX: 0, scrollY: 0, pixelsPerMinute: 1.2,
  width: 0, dayStartMinute: 0,
}

export function GanttBoard({ data }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef    = useRef<GanttEngine | null>(null)

  const [vp,         setVp]         = useState<ViewportSnapshot>(INITIAL_VP)
  const [layoutRows, setLayoutRows] = useState<LayoutRow[]>([])
  const [canvasH,    setCanvasH]    = useState(0)
  const [tooltip,    setTooltip]    = useState<TooltipState | null>(null)

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

      if (state.hoveredSegment) {
        const rect = engine.getSegmentRect(state.hoveredSegment.id)
        if (rect) {
          setTooltip({ segment: state.hoveredSegment, rect })
        }
      } else {
        setTooltip(null)
      }
    })

    engine.onSegmentClickCallback((seg) => {
      const rect = engine.getSegmentRect(seg.id)
      if (rect) setTooltip({ segment: seg, rect })
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

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
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
          <RowList rows={layoutRows} scrollY={vp.scrollY} height={canvasH} />
        </div>

        <div ref={containerRef} className="relative flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
          />

          {tooltip && (
            <SegmentTooltip segment={tooltip.segment} rect={tooltip.rect} />
          )}
        </div>
      </div>
    </div>
  )
}
