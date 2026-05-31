import type { Viewport } from './viewport'
import type { LayoutRow, LayoutSegment } from './layout/layout.types'

const SEG_RADIUS  = 3
const SEG_PADDING = 3   // px vertical
const LABEL_FONT  = '11px Inter, system-ui, sans-serif'
const DEADHEAD_PATTERN_ALPHA = 0.4

export class Renderer {
  private ctx!: CanvasRenderingContext2D

  init(ctx: CanvasRenderingContext2D): void {
    this.ctx = ctx
  }

  render(
    viewport:     Viewport,
    rows:         LayoutRow[],
    segments:     LayoutSegment[],
    hoveredSegId: string | null,
  ): void {
    const { ctx } = this
    ctx.clearRect(0, 0, viewport.width, viewport.height)
    this.drawRowBands(viewport, rows)
    this.drawTimeGrid(viewport)
    this.drawSegments(viewport, rows, segments, hoveredSegId)
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
    viewport:     Viewport,
    rows:         LayoutRow[],
    segments:     LayoutSegment[],
    hoveredSegId: string | null,
  ): void {
    const { ctx }  = this
    const rowMap   = new Map(rows.map((r) => [r.id, r]))
    ctx.font       = LABEL_FONT
    ctx.textBaseline = 'middle'

    for (const seg of segments) {
      if (!viewport.isTimeVisible(seg.startMinute, seg.endMinute)) continue
      const row = rowMap.get(seg.rowId)
      if (!row || !viewport.isRowVisible(row.y, row.height)) continue

      const x  = viewport.minuteToX(seg.startMinute)
      const w  = Math.max(2, (seg.endMinute - seg.startMinute) * viewport.pixelsPerMinute)
      const y  = viewport.contentToCanvasY(row.y) + SEG_PADDING
      const h  = row.height - SEG_PADDING * 2
      const hovered = seg.id === hoveredSegId

      if (seg.isDeadhead) {
        ctx.globalAlpha = DEADHEAD_PATTERN_ALPHA
      }

      ctx.fillStyle = seg.color
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, SEG_RADIUS)
      ctx.fill()

      if (hovered) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.lineWidth   = 2
        ctx.stroke()
      }

      ctx.globalAlpha = 1

      if (w > 30) {
        ctx.fillStyle = seg.isDeadhead ? '#6b7280' : '#fff'
        ctx.fillText(seg.label, x + 5, y + h / 2, Math.max(0, w - 10))
      }
    }
  }
}

function gridInterval(ppm: number): number {
  if (ppm >= 4)   return 15
  if (ppm >= 1.5) return 30
  if (ppm >= 0.8) return 60
  return 120
}
