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
const MOVE_TARGET_COLOR      = '#3b82f6'
const MOVE_TARGET_FILL       = 'rgba(59, 130, 246, 0.08)'
const MOVE_TARGET_WIDTH      = 2

// ── break (intervalo) — pill silhouette, subtle & distinct from trip/deadhead ────
const BREAK_RADIUS_RATIO   = 0.5   // fraction of pill height, produces a capsule
const BREAK_HEIGHT_RATIO   = 0.55  // fraction of row height
const BREAK_SOLID_COLOR    = '#64748b'  // slate-500 — remunerado
const BREAK_FAINT_FILL     = 'rgba(100, 116, 139, 0.12)'  // não remunerado
const BREAK_TEXT_COLOR     = '#64748b'
const BREAK_DASH           = [3, 2]
const IRREGULAR_COLOR      = '#f59e0b'  // amber-500
const IRREGULAR_HATCH_ALPHA = 0.55
const IRREGULAR_DOT_RADIUS  = 3

const EMPTY_SET = new Set<string>()

export class Renderer {
  private ctx!: CanvasRenderingContext2D

  init(ctx: CanvasRenderingContext2D): void {
    this.ctx = ctx
  }

  render(
    viewport:        Viewport,
    rows:            LayoutRow[],
    segments:        LayoutSegment[],
    hoveredSegId:    string | null,
    selectedSegIds:  Set<string> = EMPTY_SET,
    focusedSegId:    string | null = null,
    moveTargetRowId: string | null = null,
  ): void {
    const { ctx } = this
    ctx.clearRect(0, 0, viewport.width, viewport.height)
    this.drawRowBands(viewport, rows)
    this.drawMoveTargetFill(viewport, rows, moveTargetRowId)
    this.drawTimeGrid(viewport)
    this.drawDayBoundaries(viewport)
    this.drawSegments(viewport, rows, segments, hoveredSegId, selectedSegIds, focusedSegId)
    this.drawMoveTargetBorder(viewport, rows, moveTargetRowId)
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

  private drawMoveTargetFill(viewport: Viewport, rows: LayoutRow[], rowId: string | null): void {
    if (!rowId) return
    const row = rows.find((r) => r.id === rowId)
    if (!row || !viewport.isRowVisible(row.y, row.height)) return
    const { ctx } = this
    const canvasY = viewport.contentToCanvasY(row.y)
    ctx.fillStyle = MOVE_TARGET_FILL
    ctx.fillRect(0, canvasY, viewport.width, row.height)
  }

  private drawMoveTargetBorder(viewport: Viewport, rows: LayoutRow[], rowId: string | null): void {
    if (!rowId) return
    const row = rows.find((r) => r.id === rowId)
    if (!row || !viewport.isRowVisible(row.y, row.height)) return
    const { ctx } = this
    const canvasY = viewport.contentToCanvasY(row.y)
    ctx.save()
    ctx.strokeStyle = MOVE_TARGET_COLOR
    ctx.lineWidth   = MOVE_TARGET_WIDTH
    ctx.setLineDash([])
    ctx.strokeRect(
      MOVE_TARGET_WIDTH / 2,
      canvasY + MOVE_TARGET_WIDTH / 2,
      viewport.width - MOVE_TARGET_WIDTH,
      row.height - MOVE_TARGET_WIDTH,
    )
    ctx.restore()
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
    viewport:       Viewport,
    rows:           LayoutRow[],
    segments:       LayoutSegment[],
    hoveredSegId:   string | null,
    selectedSegIds: Set<string>,
    focusedSegId:   string | null,
  ): void {
    const { ctx }    = this
    const rowMap     = new Map(rows.map((r) => [r.id, r]))
    const hasSelect  = selectedSegIds.size > 0
    ctx.font         = LABEL_FONT
    ctx.textBaseline = 'middle'

    // collect selected rects for the ring pass and locked positions for the dot pass
    const rings: Array<{ x: number; y: number; w: number; h: number; radius: number }> = []
    const dots:  Array<{ cx: number; cy: number; dimmed: boolean }>     = []
    const irregularDots: Array<{ cx: number; cy: number; dimmed: boolean }> = []
    let focusRect: { x: number; y: number; w: number; h: number; radius: number } | null = null

    for (const seg of segments) {
      if (!viewport.isTimeVisible(seg.startMinute, seg.endMinute)) continue
      const row = rowMap.get(seg.rowId)
      if (!row || !viewport.isRowVisible(row.y, row.height)) continue

      const isBreak  = seg.kind === 'break'
      const x        = viewport.minuteToX(seg.startMinute)
      const w        = Math.max(2, (seg.endMinute - seg.startMinute) * viewport.pixelsPerMinute)
      const rowTopY  = viewport.contentToCanvasY(row.y)
      const y        = isBreak ? rowTopY + (row.height - row.height * BREAK_HEIGHT_RATIO) / 2 : rowTopY + SEG_PADDING
      const h        = isBreak ? row.height * BREAK_HEIGHT_RATIO : row.height - SEG_PADDING * 2
      const radius   = isBreak ? h * BREAK_RADIUS_RATIO : SEG_RADIUS
      const isSelected = selectedSegIds.has(seg.id)
      const hovered  = seg.id === hoveredSegId
      const dimmed   = hasSelect && !isSelected

      if (seg.kind === 'deadhead') {
        ctx.globalAlpha = dimmed ? DIM_ALPHA * 0.6 : DEADHEAD_PATTERN_ALPHA
      } else {
        ctx.globalAlpha = dimmed ? DIM_ALPHA : 1
      }

      ctx.beginPath()
      ctx.roundRect(x, y, w, h, radius)
      if (isBreak) {
        const outline = seg.fillStyle === 'outline'
        ctx.fillStyle = outline ? BREAK_FAINT_FILL : BREAK_SOLID_COLOR
        ctx.fill()
        if (outline) {
          ctx.save()
          ctx.setLineDash(BREAK_DASH)
          ctx.strokeStyle = BREAK_SOLID_COLOR
          ctx.lineWidth   = 1.25
          ctx.stroke()
          ctx.restore()
        }
      } else {
        ctx.fillStyle = seg.color
        ctx.fill()
      }

      // irregularity overlay — only the excess tail above the max is hatched;
      // below the min there's no spatial "extra" to point at, so the whole pill
      // gets an amber dashed outline instead (see docs/proposal §5.3)
      if (isBreak && seg.irregular?.severity === 'over' && seg.irregular.excessFromMinute != null) {
        const excessX = viewport.minuteToX(seg.irregular.excessFromMinute)
        const excessW = (x + w) - excessX
        if (excessW > 0) {
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(x, y, w, h, radius)
          ctx.clip()
          ctx.globalAlpha = dimmed ? DIM_ALPHA : IRREGULAR_HATCH_ALPHA
          ctx.fillStyle = IRREGULAR_COLOR
          ctx.fillRect(excessX, y, excessW, h)
          ctx.restore()
          ctx.globalAlpha = dimmed ? DIM_ALPHA : 1
        }
      } else if (isBreak && seg.irregular?.severity === 'under') {
        ctx.save()
        ctx.setLineDash(BREAK_DASH)
        ctx.strokeStyle = IRREGULAR_COLOR
        ctx.lineWidth   = 1.5
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, radius)
        ctx.stroke()
        ctx.restore()
      }

      if (hovered && !hasSelect) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.lineWidth   = 2
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, radius)
        ctx.stroke()
      }

      ctx.globalAlpha = 1

      if (w > 30) {
        ctx.fillStyle = isBreak ? BREAK_TEXT_COLOR : (seg.kind === 'deadhead' ? '#6b7280' : '#fff')
        const labelAlpha = dimmed ? DIM_ALPHA : 1
        if (labelAlpha < 1) ctx.globalAlpha = labelAlpha
        ctx.fillText(seg.label, x + 5, y + h / 2, Math.max(0, w - 10))
        ctx.globalAlpha = 1
      }

      if (isSelected) rings.push({ x, y, w, h, radius })
      if (seg.id === focusedSegId && !isSelected) focusRect = { x, y, w, h, radius }

      if (seg.locked && seg.kind === 'trip' && w > LOCK_DOT_MIN_WIDTH) {
        dots.push({
          cx:     x + w - LOCK_DOT_RADIUS - 3,
          cy:     y + LOCK_DOT_RADIUS + 3,
          dimmed,
        })
      }

      // always visible regardless of zoom/width — irregularity shouldn't disappear
      // just because the segment is narrow at a zoomed-out level
      if (isBreak && seg.irregular) {
        irregularDots.push({
          cx: Math.max(x + IRREGULAR_DOT_RADIUS, x + w - IRREGULAR_DOT_RADIUS - 3),
          cy: y + IRREGULAR_DOT_RADIUS + 3,
          dimmed,
        })
      }
    }

    // ring pass: draw selection outline on top of everything
    if (rings.length > 0) {
      ctx.strokeStyle = SELECTION_RING_COLOR
      ctx.lineWidth   = SELECTION_RING_WIDTH
      for (const { x, y, w, h, radius } of rings) {
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, radius)
        ctx.stroke()
      }
    }

    // focus ring pass: keyboard-nav highlight — same ring, no dimming
    if (focusRect) {
      ctx.strokeStyle = SELECTION_RING_COLOR
      ctx.lineWidth   = SELECTION_RING_WIDTH
      ctx.beginPath()
      ctx.roundRect(focusRect.x, focusRect.y, focusRect.w, focusRect.h, focusRect.radius)
      ctx.stroke()
    }

    // irregular-dot pass: amber warning marker for breaks outside min/max (informative only)
    if (irregularDots.length > 0) {
      for (const { cx, cy, dimmed } of irregularDots) {
        ctx.globalAlpha = dimmed ? DIM_ALPHA : 1
        ctx.fillStyle = IRREGULAR_COLOR
        ctx.beginPath()
        ctx.arc(cx, cy, IRREGULAR_DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
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
