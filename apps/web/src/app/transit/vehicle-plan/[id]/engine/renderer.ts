import type { Viewport } from './viewport'
import type { LayoutRow, LayoutSegment } from './layout/layout.types'

const SEG_RADIUS  = 3
const SEG_PADDING = 3   // px vertical
const LABEL_FONT  = '11px Inter, system-ui, sans-serif'
const DEADHEAD_PATTERN_ALPHA = 0.4
const DIM_ALPHA              = 0.25
const SELECTION_RING_WIDTH   = 2.5
const LOCK_DOT_RADIUS        = 3
const LOCK_DOT_COLOR         = '#0f172a'
const LOCK_DOT_MIN_WIDTH     = 12  // skip dot below this segment width
const DRIFT_DOT_RADIUS       = 3
const DRIFT_DOT_COLOR        = '#dc2626'  // red-600 — distinct from lock's slate, bottom-left corner
const DRIFT_DOT_MIN_WIDTH    = 12
const MOVE_TARGET_COLOR      = '#3b82f6'
const MOVE_TARGET_FILL       = 'rgba(59, 130, 246, 0.08)'
const MOVE_TARGET_WIDTH      = 2

// ── break (intervalo) — bracket: linha + marcas verticais, sem preencher a faixa ──
const BRACKET_TICK_RATIO  = 0.5   // fração da altura da linha usada pelas marcas verticais
const BRACKET_LINE_WIDTH  = 1.25
const BRACKET_DASH        = [3, 2]  // não remunerado
const BRACKET_COLOR       = '#64748b'  // slate-500
const BRACKET_LABEL_FONT  = '10px Inter, system-ui, sans-serif'
const BRACKET_LABEL_GAP   = 4  // px entre a linha e o rótulo, abaixo
const IRREGULAR_COLOR     = '#f59e0b'  // amber-500 — intervalo fora do min/máx

const EMPTY_SET = new Set<string>()

export class Renderer {
  private ctx!: CanvasRenderingContext2D

  init(ctx: CanvasRenderingContext2D): void {
    this.ctx = ctx
  }

  private isDark(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
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
    const bandColor = this.isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!viewport.isRowVisible(row.y, row.height)) continue
      const canvasY = viewport.contentToCanvasY(row.y)
      if (i % 2 === 0) {
        ctx.fillStyle = bandColor
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
    ctx.strokeStyle         = this.isDark() ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'
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
    const dark       = this.isDark()
    const ringColor  = dark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.85)'
    const hoverColor = dark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(15, 23, 42, 0.75)'
    ctx.font         = LABEL_FONT
    ctx.textBaseline = 'middle'

    // collect selected rects for the ring pass and locked positions for the dot pass
    const rings: Array<{ x: number; y: number; w: number; h: number; radius: number }> = []
    const dots:  Array<{ cx: number; cy: number; dimmed: boolean }>     = []
    const driftDots: Array<{ cx: number; cy: number; dimmed: boolean }> = []
    let focusRect: { x: number; y: number; w: number; h: number; radius: number } | null = null

    for (const seg of segments) {
      if (!viewport.isTimeVisible(seg.startMinute, seg.endMinute)) continue
      const row = rowMap.get(seg.rowId)
      if (!row || !viewport.isRowVisible(row.y, row.height)) continue

      const isBreak  = seg.kind === 'break'
      const x        = viewport.minuteToX(seg.startMinute)
      const w        = Math.max(2, (seg.endMinute - seg.startMinute) * viewport.pixelsPerMinute)
      const rowTopY  = viewport.contentToCanvasY(row.y)
      const centerY  = rowTopY + row.height / 2
      const tickHalf = (row.height * BRACKET_TICK_RATIO) / 2
      const y        = isBreak ? centerY - tickHalf : rowTopY + SEG_PADDING
      const h        = isBreak ? tickHalf * 2 : row.height - SEG_PADDING * 2
      const radius   = isBreak ? 2 : SEG_RADIUS
      const isSelected = selectedSegIds.has(seg.id)
      const hovered  = seg.id === hoveredSegId
      const dimmed   = hasSelect && !isSelected

      if (seg.kind === 'deadhead') {
        ctx.globalAlpha = dimmed ? DIM_ALPHA * 0.6 : DEADHEAD_PATTERN_ALPHA
      } else {
        ctx.globalAlpha = dimmed ? DIM_ALPHA : 1
      }

      if (isBreak) {
        // bracket: linha central + marcas verticais nas extremidades, sem preencher
        // a faixa — deixa a timeline "limpa" e reserva cor para sinalizar irregularidade
        // (ver docs/proposal/vehicle-plan-block-intervals.md §5.3/§7.1).
        const irregular   = seg.irregular != null
        const strokeColor = irregular ? IRREGULAR_COLOR : BRACKET_COLOR
        ctx.save()
        ctx.strokeStyle = strokeColor
        ctx.lineWidth   = BRACKET_LINE_WIDTH
        ctx.setLineDash(seg.fillStyle === 'outline' ? BRACKET_DASH : [])
        ctx.beginPath()
        ctx.moveTo(x, centerY)
        ctx.lineTo(x + w, centerY)
        ctx.moveTo(x, centerY - tickHalf)
        ctx.lineTo(x, centerY + tickHalf)
        ctx.moveTo(x + w, centerY - tickHalf)
        ctx.lineTo(x + w, centerY + tickHalf)
        ctx.stroke()
        ctx.restore()
      } else {
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, radius)
        ctx.fillStyle = seg.color
        ctx.fill()
      }

      if (hovered && !hasSelect) {
        ctx.strokeStyle = hoverColor
        ctx.lineWidth   = 2
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, radius)
        ctx.stroke()
      }

      ctx.globalAlpha = 1

      if (isBreak) {
        // rótulo colado logo abaixo da linha — só a duração (ex. "120'"), sem
        // disputar espaço vertical com a faixa da linha seguinte.
        if (w > 20) {
          const irregular = seg.irregular != null
          ctx.save()
          ctx.font         = BRACKET_LABEL_FONT
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle    = irregular ? IRREGULAR_COLOR : BRACKET_COLOR
          ctx.globalAlpha  = dimmed ? DIM_ALPHA : 1
          ctx.fillText(seg.label, x + w / 2, centerY + BRACKET_LABEL_GAP, w)
          ctx.restore()
        }
      } else if (w > 30) {
        ctx.fillStyle = seg.kind === 'deadhead' ? '#6b7280' : '#fff'
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

      if (seg.offSchedule && seg.kind === 'trip' && w > DRIFT_DOT_MIN_WIDTH) {
        driftDots.push({
          cx:     x + DRIFT_DOT_RADIUS + 3,
          cy:     y + h - DRIFT_DOT_RADIUS - 3,
          dimmed,
        })
      }
    }

    // ring pass: draw selection outline on top of everything
    if (rings.length > 0) {
      ctx.strokeStyle = ringColor
      ctx.lineWidth   = SELECTION_RING_WIDTH
      for (const { x, y, w, h, radius } of rings) {
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, radius)
        ctx.stroke()
      }
    }

    // focus ring pass: keyboard-nav highlight — same ring, no dimming
    if (focusRect) {
      ctx.strokeStyle = ringColor
      ctx.lineWidth   = SELECTION_RING_WIDTH
      ctx.beginPath()
      ctx.roundRect(focusRect.x, focusRect.y, focusRect.w, focusRect.h, focusRect.radius)
      ctx.stroke()
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

    // dot pass: OSO-drift indicator (bottom-left, red — never the same corner as lock)
    if (driftDots.length > 0) {
      ctx.fillStyle = DRIFT_DOT_COLOR
      for (const { cx, cy, dimmed } of driftDots) {
        ctx.globalAlpha = dimmed ? DIM_ALPHA : 1
        ctx.beginPath()
        ctx.arc(cx, cy, DRIFT_DOT_RADIUS, 0, Math.PI * 2)
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
