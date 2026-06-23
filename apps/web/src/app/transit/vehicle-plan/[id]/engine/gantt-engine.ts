import { Viewport }          from './viewport'
import { Renderer }           from './renderer'
import { HitTester }          from './hit-tester'
import { Interaction }        from './interaction'
import { SequentialLayout }   from './layout/sequential.layout'
import type { GanttView, Point, ViewportSnapshot } from './gantt.types'
import type { LayoutRow, LayoutSegment, LayoutStrategy } from './layout/layout.types'

export interface EngineState {
  viewport:       ViewportSnapshot
  layoutRows:     LayoutRow[]
  hoveredSegId:   string | null
  hoveredSegment: LayoutSegment | null
}

export class GanttEngine {
  readonly viewport    = new Viewport()
  readonly renderer    = new Renderer()
  readonly hitTester   = new HitTester()
  readonly interaction = new Interaction()

  private layout:        LayoutStrategy  = new SequentialLayout()
  private canvas!:       HTMLCanvasElement
  private ctx!:          CanvasRenderingContext2D
  private rafPending     = false
  private ready          = false

  private layoutRows:    LayoutRow[]     = []
  private segments:      LayoutSegment[] = []
  private hoveredSeg:    string | null   = null
  private selectedSegIds: Set<string>   = new Set()

  private onStateChange?: (state: EngineState) => void
  private onSegmentClickCb?: (seg: LayoutSegment, pos: Point) => void

  // ── lifecycle ──────────────────────────────────────────────────────────────

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    const ctx   = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')
    this.ctx   = ctx
    this.ready = true

    this.applyDpr()
    this.renderer.init(this.ctx)
    this.interaction.init(this, canvas)
    this.notify()       // propagate correct width/height to React
    this.requestDraw()  // draw any view set before init
  }

  dispose(): void {
    this.interaction.dispose()
  }

  resize(width: number, height: number): void {
    this.viewport.resize(width, height)
    this.applyDpr()
    this.notify()
    this.requestDraw()
  }

  // ── public API ─────────────────────────────────────────────────────────────

  setLayout(strategy: LayoutStrategy): void {
    this.layout = strategy
  }

  setView<T>(view: GanttView<T>, data: T): void {
    const rawRows     = view.getRows(data)
    const rawSegments = rawRows.flatMap((row) => view.getSegments(row, data))
    const result      = this.layout.compute(rawRows, rawSegments)

    this.layoutRows           = result.rows
    this.segments             = result.segments
    this.viewport.totalHeight = result.totalHeight

    // extend end boundary to cover any segments that cross midnight
    const maxEnd = result.segments.reduce((max, s) => Math.max(max, s.endMinute), 1440)
    this.viewport.dayEndMinute = maxEnd

    this.hitTester.build(this.segments, this.viewport, this.layoutRows)
    this.notify()
    this.requestDraw()
  }

  setSelectedSegIds(ids: Set<string>): void {
    this.selectedSegIds = ids
    this.requestDraw()
  }

  getLayoutSegments(): LayoutSegment[] {
    return this.segments
  }

  getLayoutRows(): LayoutRow[] {
    return this.layoutRows
  }

  setHovered(segId: string | null): void {
    if (this.hoveredSeg === segId) return
    this.hoveredSeg = segId
    this.notify()
    this.requestDraw()
  }

  handleSegmentClick(segId: string, pos: Point): void {
    const seg = this.segments.find((s) => s.id === segId)
    if (seg) this.onSegmentClickCb?.(seg, pos)
  }

  getSegmentRect(segId: string): DOMRect | null {
    const seg = this.segments.find((s) => s.id === segId)
    if (!seg) return null
    const row = this.layoutRows.find((r) => r.id === seg.rowId)
    if (!row) return null

    const x = this.viewport.minuteToX(seg.startMinute)
    const w = (seg.endMinute - seg.startMinute) * this.viewport.pixelsPerMinute
    const y = this.viewport.contentToCanvasY(row.y)
    const h = row.height
    return new DOMRect(x, y, w, h)
  }

  onStateChangeCallback(cb: (state: EngineState) => void): void {
    this.onStateChange = cb
  }

  onSegmentClickCallback(cb: (seg: LayoutSegment, pos: Point) => void): void {
    this.onSegmentClickCb = cb
  }

  requestDraw(): void {
    if (!this.ready || this.rafPending) return
    this.rafPending = true
    requestAnimationFrame(() => {
      this.rafPending = false
      this.draw()
    })
  }

  // ── private ────────────────────────────────────────────────────────────────

  private draw(): void {
    this.renderer.render(this.viewport, this.layoutRows, this.segments, this.hoveredSeg, this.selectedSegIds)
    this.hitTester.build(this.segments, this.viewport, this.layoutRows)
  }

  notify(): void {
    this.onStateChange?.({
      viewport:       this.viewport.snapshot(),
      layoutRows:     this.layoutRows,
      hoveredSegId:   this.hoveredSeg,
      hoveredSegment: this.hoveredSeg
        ? (this.segments.find((s) => s.id === this.hoveredSeg) ?? null)
        : null,
    })
  }

  private applyDpr(): void {
    const dpr             = window.devicePixelRatio ?? 1
    this.canvas.width     = this.viewport.width  * dpr
    this.canvas.height    = this.viewport.height * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}
