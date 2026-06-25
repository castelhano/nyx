import type { Viewport } from './viewport'
import type { LayoutRow, LayoutSegment } from './layout/layout.types'

const SEG_RADIUS  = 3
const SEG_PADDING = 3   // px vertical
const LABEL_FONT  = '11px Inter, system-ui, sans-serif'
const DEADHEAD_PATTERN_ALPHA = 0.4
const DIM_ALPHA              = 0.25
const SELECTION_RING_COLOR   = 'rgba(255, 255, 255, 0.9)'
const SELECTION_RING_WIDTH   = 2.5
const LOCK_DOT_RADIUS        = 3
const LOCK_DOT_COLOR         = '#0f172a'
const LOCK_DOT_MIN_WIDTH     = 12  // skip dot below this segment width

const EMPTY_SET = new Set<string>()

export class Renderer {
  private ctx!: CanvasRenderingContext2D

  init(ctx: CanvasRenderingContext2D): void {
    this.ctx = ctx
  }

  render(
    viewport:      Viewport,
    rows:          LayoutRow[],
    segments:      LayoutSegment[],
    hoveredSegId:  string | null,
    selectedSegIds: Set<string> = EMPTY_SET,
  ): void {
    const { ctx } = this
    ctx.clearRect(0, 0, viewport.width, viewport.height)
    this.drawRowBands(viewport, rows)
    this.drawTimeGrid(viewport)
    this.drawDayBoundaries(viewport)
    this.drawSegments(viewport, rows, segments, hoveredSegId, selectedSegIds)
  }

  private drawDayBoundaries(viewport: Viewport): void {
    const { ctx } = this
    const start = Math.ceil(viewport.visibleStartMinute / 1440) * 1440
    if (start > viewport.visibleEndMinute) return

    ctx.save()
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)'
    ctx.lineWidth   = 1
    ctx.setLineDash([4, 4])

    for (let m = start; m <= viewport.visibleEndMinute; m += 1440) {
      const x = Math.round(viewport.minuteToX(m)) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, viewport.height)
      ctx.stroke()
    }

    ctx.restore()
  }

  private drawRowBands(viewport: Viewport, rows: LayoutRow[]): void {
    const { ctx } = this
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!viewport.isRowVisible(row.y, row.height)) continue
      const canvasY = viewport.contentToCanvasY(row.y)
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.02)'
        ctx.fillRect(0, canvasY, viewport.width, row.height)
      }
    }
  }

  private drawTimeGrid(viewport: Viewport): void {
    const { ctx }           = this
    const interval          = gridInterval(viewport.pixelsPerMinute)
    const startM            = Math.floor(viewport.visibleStartMinute / interval) * interval
    ctx.strokeStyle         = 'rgba(0,0,0,0.07)'
    ctx.lineWidth           = 1
    for (let m = startM; m <= viewport.visibleEndMinute; m += interval) {
      const x = Math.round(viewport.minuteToX(m)) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, viewport.height)
      ctx.stroke()
    }
  }

  private drawSegments(
    viewport:      Viewport,
    rows:          LayoutRow[],
    segments:      LayoutSegment[],
    hoveredSegId:  string | null,
    selectedSegIds: Set<string>,
  ): void {
    const { ctx }    = this
    const rowMap     = new Map(rows.map((r) => [r.id, r]))
    const hasSelect  = selectedSegIds.size > 0
    ctx.font         = LABEL_FONT
    ctx.textBaseline = 'middle'

    // collect selected rects for the ring pass and locked positions for the dot pass
    const rings: Array<{ x: number; y: number; w: number; h: number }> = []
    const dots:  Array<{ cx: number; cy: number; dimmed: boolean }>     = []

    for (const seg of segments) {
      if (!viewport.isTimeVisible(seg.startMinute, seg.endMinute)) continue
      const row = rowMap.get(seg.rowId)
      if (!row || !viewport.isRowVisible(row.y, row.height)) continue

      const x        = viewport.minuteToX(seg.startMinute)
      const w        = Math.max(2, (seg.endMinute - seg.startMinute) * viewport.pixelsPerMinute)
      const y        = viewport.contentToCanvasY(row.y) + SEG_PADDING
      const h        = row.height - SEG_PADDING * 2
      const isSelected = selectedSegIds.has(seg.id)
      const hovered  = seg.id === hoveredSegId

      if (seg.isDeadhead) {
        ctx.globalAlpha = hasSelect && !isSelected ? DIM_ALPHA * 0.6 : DEADHEAD_PATTERN_ALPHA
      } else if (hasSelect && !isSelected) {
        ctx.globalAlpha = DIM_ALPHA
      } else {
        ctx.globalAlpha = 1
      }

      ctx.fillStyle = seg.color
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, SEG_RADIUS)
      ctx.fill()

      if (hovered && !hasSelect) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.lineWidth   = 2
        ctx.stroke()
      }

      ctx.globalAlpha = 1

      if (w > 30) {
        ctx.fillStyle = seg.isDeadhead ? '#6b7280' : '#fff'
        const labelAlpha = hasSelect && !isSelected ? DIM_ALPHA : 1
        if (labelAlpha < 1) ctx.globalAlpha = labelAlpha
        ctx.fillText(seg.label, x + 5, y + h / 2, Math.max(0, w - 10))
        ctx.globalAlpha = 1
      }

      if (isSelected) rings.push({ x, y, w, h })

      if (seg.locked && !seg.isDeadhead && w > LOCK_DOT_MIN_WIDTH) {
        dots.push({
          cx:     x + w - LOCK_DOT_RADIUS - 3,
          cy:     y + LOCK_DOT_RADIUS + 3,
          dimmed: hasSelect && !isSelected,
        })
      }
    }

    // ring pass: draw selection outline on top of everything
    if (rings.length > 0) {
      ctx.strokeStyle = SELECTION_RING_COLOR
      ctx.lineWidth   = SELECTION_RING_WIDTH
      for (const { x, y, w, h } of rings) {
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, SEG_RADIUS)
        ctx.stroke()
      }
    }

    // dot pass: lock indicator (slate-900, avoids palette color conflicts)
    if (dots.length > 0) {
      ctx.fillStyle = LOCK_DOT_COLOR
      for (const { cx, cy, dimmed } of dots) {
        ctx.globalAlpha = dimmed ? DIM_ALPHA : 1
        ctx.beginPath()
        ctx.arc(cx, cy, LOCK_DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }
}

function gridInterval(ppm: number): number {
  if (ppm >= 4)   return 15
  if (ppm >= 1.5) return 30
  if (ppm >= 0.8) return 60
  return 120
}
