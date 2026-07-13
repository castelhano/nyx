import { markOutliers } from './cycle-utils'
import type { DotCluster, DotClickInfo, CycleEngineState, MarqueeItem, MarqueeSelection } from './types'

const PAD   = { left: 52, right: 20, top: 44, bottom: 44 }
const COLORS = {
  normal:   '#3b82f6',
  outlier:  '#ef4444',
  disabled: '#9ca3af',
  edited:   '#f97316',
  cut:      '#64748b',
  cutHover: '#0f172a',
  grid:     'rgba(0,0,0,0.07)',
  gridH:    'rgba(0,0,0,0.05)',
  axisText: '#64748b',
  avgLine:  'rgba(59,130,246,0.35)',
  band:     'rgba(0,0,0,0.02)',
}
const CUT_HIT     = 7   // px tolerance to hit a cut line
const DOT_HIT_PAD = 4   // extra px around dot radius
const DOT_MIN_R   = 5
const DOT_MAX_R   = 18
const MARQUEE_MIN_DRAG = 4  // px before a mousedown-drag counts as a marquee, not a click

export class CycleEngine {
  private canvas!:       HTMLCanvasElement
  private ctx!:          CanvasRenderingContext2D
  private rafPending     = false
  private ready          = false
  private width          = 0
  private height         = 0

  private hourClusters:  Map<number, DotCluster[]> = new Map()
  private hours:         number[]                   = []
  private cuts:          Set<number>                = new Set()

  private hoveredDot:    { hour: number; idx: number } | null = null
  private dragCut:       { original: number; boundary: number } | null = null
  private marqueeDown:   { x: number; y: number } | null = null
  private marqueeRect:   { x0: number; y0: number; x1: number; y1: number } | null = null
  private confirmedSelection: MarqueeItem[] | null = null
  private suppressNextClick = false
  private handlers:      { el: EventTarget; type: string; fn: EventListener }[] = []

  onStateChange?:    (s: CycleEngineState) => void
  onCutsChange?:     (cuts: number[]) => void
  onDotToggle?:      (hour: number, clusterIdx: number) => void
  onDotClick?:       (info: DotClickInfo) => void
  onHoverChange?:    (info: DotClickInfo | null) => void
  onMarqueeSelect?:  (sel: MarqueeSelection | null) => void

  // ── lifecycle ─────────────────────────────────────────────────────────────

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    const ctx   = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D not available')
    this.ctx    = ctx
    this.ready  = true
    this.applyDpr()
    this.attach()
    this.notify()
    this.requestDraw()
  }

  dispose(): void {
    for (const { el, type, fn } of this.handlers) el.removeEventListener(type, fn)
    this.handlers = []
  }

  resize(w: number, h: number): void {
    this.width  = w
    this.height = h
    if (this.ready) {
      this.applyDpr()
      this.notify()
      this.requestDraw()
    }
  }

  setData(hourClusters: Map<number, DotCluster[]>, cuts: number[]): void {
    this.hourClusters = hourClusters
    this.hours        = Array.from(hourClusters.keys()).sort((a, b) => a - b)
    this.cuts         = new Set(cuts)
    this.requestDraw()
  }

  // drop any pending marquee confirmation (e.g. React closed the popup, or data changed underneath it)
  clearSelection(): void {
    if (!this.confirmedSelection) return
    this.confirmedSelection = null
    this.requestDraw()
  }

  requestDraw(): void {
    if (!this.ready || this.rafPending) return
    this.rafPending = true
    requestAnimationFrame(() => {
      this.rafPending = false
      this.draw()
    })
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  private draw(): void {
    const { ctx, width: W, height: H } = this
    ctx.clearRect(0, 0, W, H)
    if (this.hours.length === 0) return

    const { min: yMin, max: yMax } = this.yRange()
    const cW  = this.colWidth()
    const cH  = H - PAD.top - PAD.bottom

    // column bands
    ctx.save()
    for (let i = 0; i < this.hours.length; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = COLORS.band
        ctx.fillRect(PAD.left + i * cW, PAD.top, cW, cH)
      }
    }
    ctx.restore()

    // horizontal grid lines + Y axis labels
    ctx.save()
    ctx.font         = '11px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign    = 'right'
    ctx.fillStyle    = COLORS.axisText
    const yStep = niceStep(yMax - yMin)
    const yStart = Math.ceil(yMin / yStep) * yStep
    for (let m = yStart; m <= yMax; m += yStep) {
      const y = Math.round(this.minutesToY(m, yMin, yMax)) + 0.5
      ctx.strokeStyle = COLORS.gridH
      ctx.lineWidth   = 1
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(W - PAD.right, y)
      ctx.stroke()
      ctx.fillText(`${m}min`, PAD.left - 6, y)
    }
    ctx.restore()

    // X axis labels
    ctx.save()
    ctx.font         = '11px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'top'
    ctx.textAlign    = 'center'
    ctx.fillStyle    = COLORS.axisText
    for (let i = 0; i < this.hours.length; i++) {
      const x = PAD.left + (i + 0.5) * cW
      ctx.fillText(String(this.hours[i]), x, H - PAD.bottom + 8)
    }
    ctx.restore()

    // average lines per window
    this.drawAvgLines(yMin, yMax)

    // cut lines
    this.drawCuts(yMin, yMax)

    // dots
    this.drawDots(yMin, yMax)

    // marquee selection rectangle (live drag)
    this.drawMarquee()

    // X axis baseline
    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(PAD.left, H - PAD.bottom)
    ctx.lineTo(W - PAD.right, H - PAD.bottom)
    ctx.stroke()
    // Y axis baseline
    ctx.beginPath()
    ctx.moveTo(PAD.left, PAD.top)
    ctx.lineTo(PAD.left, H - PAD.bottom)
    ctx.stroke()
    ctx.restore()
  }

  private drawAvgLines(yMin: number, yMax: number): void {
    const { ctx, width: W } = this
    const cuts = [...this.cuts].sort((a, b) => a - b)
    const minH = this.hours[0]
    const maxH = this.hours[this.hours.length - 1]
    const bounds = [minH, ...cuts.filter(c => c >= minH && c < maxH).map(c => c + 1), maxH + 1]

    for (let i = 0; i < bounds.length - 1; i++) {
      const from = bounds[i]
      const to   = bounds[i + 1] - 1
      const all: DotCluster[] = []
      for (let h = from; h <= to; h++) {
        const cs = this.hourClusters.get(h)
        if (cs) all.push(...cs)
      }
      const active = all.filter(c => !c.isOutlier && !c.isDisabled)
      if (active.length === 0) continue
      const hoursInWindow = this.hours.filter(h => h >= from && h <= to)
      if (hoursInWindow.length === 0) continue
      const total = active.reduce((s, c) => s + c.minutes * c.count, 0)
      const cnt   = active.reduce((s, c) => s + c.count, 0)
      const avg   = total / cnt
      const rounded = Math.round(avg)
      const y     = Math.round(this.minutesToY(avg, yMin, yMax)) + 0.5
      const x1    = Math.max(PAD.left,        this.hourToX(hoursInWindow[0])! - this.colWidth() * 0.5)
      const x2    = Math.min(W - PAD.right,   this.hourToX(hoursInWindow[hoursInWindow.length - 1])! + this.colWidth() * 0.5)

      // dashed avg line
      ctx.save()
      ctx.strokeStyle = COLORS.avgLine
      ctx.lineWidth   = 2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x1, y)
      ctx.lineTo(x2, y)
      ctx.stroke()
      ctx.restore()

      // pill label pinned to the reserved top strip (above chart area)
      const label  = `${rounded}min`
      ctx.save()
      ctx.font         = 'bold 11px Inter, system-ui, sans-serif'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      const midX  = (x1 + x2) / 2
      const tw    = ctx.measureText(label).width
      const ph    = 18
      const pw    = tw + 12
      const stripMidY = PAD.top / 2          // center of the top reserved strip
      const pillY     = stripMidY - ph / 2
      ctx.fillStyle   = 'rgba(255,255,255,0.92)'
      ctx.strokeStyle = COLORS.avgLine
      ctx.lineWidth   = 1
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.roundRect(midX - pw / 2, pillY, pw, ph, 5)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#3b82f6'
      ctx.fillText(label, midX, stripMidY)
      ctx.restore()
    }
  }

  private drawCuts(yMin: number, yMax: number): void {
    const { ctx, height: H } = this
    ctx.save()
    ctx.lineWidth = 2
    const cW = this.colWidth()

    for (const cut of this.cuts) {
      const idx = this.hours.indexOf(cut)
      if (idx < 0 || idx >= this.hours.length - 1) continue
      const x       = Math.round(PAD.left + (idx + 1) * cW) + 0.5
      const isHover = this.dragCut?.original === cut || this.dragCut?.boundary === idx + 1

      ctx.strokeStyle = isHover ? COLORS.cutHover : COLORS.cut
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(x, PAD.top)
      ctx.lineTo(x, H - PAD.bottom)
      ctx.stroke()

      // drag handle
      ctx.setLineDash([])
      ctx.fillStyle = isHover ? COLORS.cutHover : COLORS.cut
      ctx.beginPath()
      ctx.arc(x, H - PAD.bottom + 6, 5, 0, Math.PI * 2)
      ctx.fill()
    }

    // preview ghost while dragging
    if (this.dragCut) {
      const { boundary } = this.dragCut
      if (boundary > 0 && boundary < this.hours.length) {
        const x = Math.round(PAD.left + boundary * cW) + 0.5
        ctx.strokeStyle = COLORS.cutHover
        ctx.globalAlpha = 0.4
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(x, PAD.top)
        ctx.lineTo(x, H - PAD.bottom)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
    ctx.restore()
  }

  private drawDots(yMin: number, yMax: number): void {
    const { ctx } = this
    ctx.save()
    ctx.font         = '10px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign    = 'center'

    const liveSelection = this.marqueeRect ? this.dotsInRect(this.marqueeRect) : null
    const selectedKeys  = new Set(
      (this.confirmedSelection ?? liveSelection ?? []).map(s => `${s.hour}:${s.idx}`),
    )

    for (const h of this.hours) {
      const clusters = this.hourClusters.get(h)
      if (!clusters) continue
      const colIdx = this.hours.indexOf(h)

      for (let i = 0; i < clusters.length; i++) {
        const c   = clusters[i]
        const cx  = this.dotX(colIdx, i, clusters.length)
        const cy  = this.minutesToY(c.minutes, yMin, yMax)
        const r   = this.dotRadius(c.count)
        const hov = this.hoveredDot?.hour === h && this.hoveredDot.idx === i
        const sel = selectedKeys.has(`${h}:${i}`)

        ctx.globalAlpha = c.isDisabled ? 0.35 : 1

        // fill
        ctx.fillStyle = c.isDisabled ? COLORS.disabled
          : c.isOutlier              ? COLORS.outlier
          : COLORS.normal
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()

        // edited stroke
        if (c.hasEdited && !c.isDisabled) {
          ctx.strokeStyle = COLORS.edited
          ctx.lineWidth   = 2
          ctx.stroke()
        }

        // hover ring
        if (hov) {
          ctx.globalAlpha = 1
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'
          ctx.lineWidth   = 2
          ctx.stroke()
        }

        // marquee selection ring
        if (sel) {
          ctx.globalAlpha = 1
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth   = 2.5
          ctx.beginPath()
          ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
          ctx.stroke()
        }

        ctx.globalAlpha = 1

        // count label
        if (c.count > 1 && r >= 10) {
          ctx.fillStyle = '#fff'
          ctx.fillText(String(c.count), cx, cy)
        }
      }
    }
    ctx.restore()
  }

  private drawMarquee(): void {
    if (!this.marqueeRect) return
    const { ctx } = this
    const { x0, y0, x1, y1 } = this.marqueeRect
    const x = Math.min(x0, x1)
    const y = Math.min(y0, y1)
    const w = Math.abs(x1 - x0)
    const h = Math.abs(y1 - y0)

    ctx.save()
    ctx.fillStyle   = 'rgba(59,130,246,0.08)'
    ctx.strokeStyle = 'rgba(59,130,246,0.6)'
    ctx.lineWidth   = 1
    ctx.setLineDash([4, 3])
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x, y, w, h)
    ctx.restore()
  }

  // ── coordinate helpers ────────────────────────────────────────────────────

  private dotX(colIdx: number, dotIdx: number, total: number): number {
    const cW      = this.colWidth()
    const colLeft = PAD.left + colIdx * cW
    if (total === 1) return colLeft + cW / 2
    const margin  = Math.max(DOT_MAX_R + 2, cW * 0.1)
    const usable  = Math.max(0, cW - 2 * margin)
    return colLeft + margin + (dotIdx / (total - 1)) * usable
  }

  private colWidth(): number {
    if (this.hours.length === 0) return 1
    return (this.width - PAD.left - PAD.right) / this.hours.length
  }

  private hourToX(h: number): number | null {
    const idx = this.hours.indexOf(h)
    if (idx < 0) return null
    return PAD.left + (idx + 0.5) * this.colWidth()
  }

  private minutesToY(m: number, yMin: number, yMax: number): number {
    const chartH = this.height - PAD.top - PAD.bottom
    return PAD.top + (1 - (m - yMin) / (yMax - yMin)) * chartH
  }

  private yRange(): { min: number; max: number } {
    let lo = Infinity, hi = -Infinity
    for (const cs of this.hourClusters.values()) {
      for (const c of cs) {
        if (c.minutes < lo) lo = c.minutes
        if (c.minutes > hi) hi = c.minutes
      }
    }
    if (!isFinite(lo)) return { min: 0, max: 60 }
    const pad = Math.max(5, Math.round((hi - lo) * 0.15))
    return { min: Math.max(0, lo - pad), max: hi + pad }
  }

  private dotRadius(count: number): number {
    return DOT_MIN_R + Math.min(count - 1, 8) * ((DOT_MAX_R - DOT_MIN_R) / 8)
  }

  // ── mouse events ──────────────────────────────────────────────────────────

  private on(el: EventTarget, type: string, fn: EventListener): void {
    el.addEventListener(type, fn, { passive: false } as AddEventListenerOptions)
    this.handlers.push({ el, type, fn })
  }

  private attach(): void {
    this.on(this.canvas, 'mousedown',  this.onMouseDown  as EventListener)
    this.on(this.canvas, 'mousemove',  this.onMouseMove  as EventListener)
    this.on(this.canvas, 'mouseup',    this.onMouseUp    as EventListener)
    this.on(this.canvas, 'mouseleave', this.onMouseLeave as EventListener)
    this.on(this.canvas, 'click',      this.onClick      as EventListener)
  }

  private onMouseDown = (e: MouseEvent): void => {
    const { offsetX: x, offsetY: y } = e
    const cut = this.hitCut(x, y)
    if (cut !== null) {
      const boundary = this.hours.indexOf(cut) + 1
      this.dragCut   = { original: cut, boundary }
      this.canvas.style.cursor = 'ew-resize'
      e.preventDefault()
      return
    }

    // starting any new interaction dismisses a pending marquee confirmation
    if (this.confirmedSelection) {
      this.confirmedSelection = null
      this.onMarqueeSelect?.(null)
    }

    const inCutZone = y > this.height - PAD.bottom - 4
    const onDot     = this.hitDot(x, y) !== null
    if (!inCutZone && !onDot) {
      this.marqueeDown = { x, y }
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    const { offsetX: x, offsetY: y } = e
    if (this.dragCut) {
      const b = this.xToBoundary(x)
      if (b !== null) this.dragCut.boundary = b
      this.requestDraw()
      return
    }

    if (this.marqueeDown) {
      const dx = x - this.marqueeDown.x
      const dy = y - this.marqueeDown.y
      if (this.marqueeRect || Math.hypot(dx, dy) > MARQUEE_MIN_DRAG) {
        this.marqueeRect = { x0: this.marqueeDown.x, y0: this.marqueeDown.y, x1: x, y1: y }
        this.canvas.style.cursor = 'crosshair'
        this.requestDraw()
      }
      return
    }

    // hover
    const dot = this.hitDot(x, y)
    const prev = this.hoveredDot
    this.hoveredDot = dot ? { hour: dot.hour, idx: dot.idx } : null

    const changed = prev?.hour !== this.hoveredDot?.hour || prev?.idx !== this.hoveredDot?.idx
    if (changed) {
      this.canvas.style.cursor = dot ? 'pointer' : this.hitCut(x, y) !== null ? 'ew-resize' : ''
      this.onHoverChange?.(dot ? {
        cluster:    dot.cluster,
        hour:       dot.hour,
        clusterIdx: dot.idx,
        canvasX:    dot.cx,
        canvasY:    y,
      } : null)
      this.requestDraw()
    }
  }

  private onMouseUp = (e: MouseEvent): void => {
    if (this.dragCut) {
      const { original, boundary } = this.dragCut
      this.dragCut = null
      this.canvas.style.cursor = ''
      this.suppressNextClick = true

      // remove old cut, add at new position
      const newCut = boundary > 0 && boundary < this.hours.length
        ? this.hours[boundary - 1]
        : null

      const next = new Set(this.cuts)
      next.delete(original)
      if (newCut !== null && newCut !== original) next.add(newCut)
      else next.add(original) // didn't move enough — keep original

      this.cuts = next
      this.onCutsChange?.([...this.cuts])
      this.requestDraw()
      return
    }

    if (this.marqueeDown) {
      const rect = this.marqueeRect
      this.marqueeDown = null
      this.marqueeRect = null
      this.canvas.style.cursor = ''
      if (rect) {
        this.suppressNextClick = true
        const items = this.dotsInRect(rect)
        if (items.length > 0) {
          this.confirmedSelection = items
          this.onMarqueeSelect?.({ items, x: e.offsetX, y: e.offsetY })
        }
        this.requestDraw()
      }
    }
  }

  private onMouseLeave = (): void => {
    if (this.dragCut) {
      // cancel drag
      this.dragCut = null
      this.canvas.style.cursor = ''
      this.requestDraw()
    }
    if (this.marqueeDown) {
      this.marqueeDown = null
      this.marqueeRect = null
      this.canvas.style.cursor = ''
      this.requestDraw()
    }
    if (this.hoveredDot) {
      this.hoveredDot = null
      this.onHoverChange?.(null)
      this.requestDraw()
    }
  }

  private onClick = (e: MouseEvent): void => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false
      return
    }

    const { offsetX: x, offsetY: y } = e
    const H = this.height

    // check dot toggle
    const dot = this.hitDot(x, y)
    if (dot) {
      this.onDotClick?.({
        cluster:    dot.cluster,
        hour:       dot.hour,
        clusterIdx: dot.idx,
        canvasX:    dot.cx,
        canvasY:    y,
      })
      return
    }

    // cut zone (bottom strip) or cut line hit → toggle cut
    const isInCutZone = y > H - PAD.bottom - 4
    const existingCut = this.hitCut(x, y)

    if (existingCut !== null) {
      // remove
      const next = new Set(this.cuts)
      next.delete(existingCut)
      this.cuts = next
      this.onCutsChange?.([...this.cuts])
      this.requestDraw()
      return
    }

    if (isInCutZone) {
      // add at nearest boundary
      const b = this.xToBoundary(x)
      if (b !== null && b > 0 && b < this.hours.length) {
        const cut = this.hours[b - 1]
        const next = new Set(this.cuts)
        next.add(cut)
        this.cuts = next
        this.onCutsChange?.([...this.cuts])
        this.requestDraw()
      }
    }
  }

  // ── hit testing ───────────────────────────────────────────────────────────

  private hitDot(
    mx: number, my: number,
  ): { hour: number; idx: number; cluster: DotCluster; cx: number } | null {
    const { min: yMin, max: yMax } = this.yRange()
    let best: { hour: number; idx: number; cluster: DotCluster; cx: number; dist: number } | null = null

    for (const h of this.hours) {
      const cs     = this.hourClusters.get(h)
      if (!cs) continue
      const colIdx = this.hours.indexOf(h)
      for (let i = 0; i < cs.length; i++) {
        const cx   = this.dotX(colIdx, i, cs.length)
        const cy   = this.minutesToY(cs[i].minutes, yMin, yMax)
        const r    = this.dotRadius(cs[i].count) + DOT_HIT_PAD
        const dist = Math.hypot(mx - cx, my - cy)
        if (dist <= r && (!best || dist < best.dist)) {
          best = { hour: h, idx: i, cluster: cs[i], cx, dist }
        }
      }
    }
    return best
  }

  private dotsInRect(rect: { x0: number; y0: number; x1: number; y1: number }): MarqueeItem[] {
    const { min: yMin, max: yMax } = this.yRange()
    const left   = Math.min(rect.x0, rect.x1)
    const right  = Math.max(rect.x0, rect.x1)
    const top    = Math.min(rect.y0, rect.y1)
    const bottom = Math.max(rect.y0, rect.y1)
    const found: MarqueeItem[] = []

    for (const h of this.hours) {
      const cs = this.hourClusters.get(h)
      if (!cs) continue
      const colIdx = this.hours.indexOf(h)
      for (let i = 0; i < cs.length; i++) {
        const cx = this.dotX(colIdx, i, cs.length)
        const cy = this.minutesToY(cs[i].minutes, yMin, yMax)
        if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
          found.push({ hour: h, idx: i, cluster: cs[i] })
        }
      }
    }
    return found
  }

  private hitCut(x: number, y: number): number | null {
    if (y > this.height - PAD.bottom + 14) return null  // below handle area
    const cW = this.colWidth()
    for (const cut of this.cuts) {
      const idx = this.hours.indexOf(cut)
      if (idx < 0) continue
      const cx = PAD.left + (idx + 1) * cW
      if (Math.abs(x - cx) <= CUT_HIT) return cut
    }
    return null
  }

  private xToBoundary(x: number): number | null {
    const cW = this.colWidth()
    const b  = Math.round((x - PAD.left) / cW)
    if (b < 0 || b > this.hours.length) return null
    return b
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private notify(): void {
    this.onStateChange?.({ width: this.width, height: this.height })
  }

  private applyDpr(): void {
    const dpr            = window.devicePixelRatio ?? 1
    this.canvas.width    = this.width  * dpr
    this.canvas.height   = this.height * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // allow engine to recalculate outliers after external toggle
  toggleDot(hour: number, clusterIdx: number): void {
    const cs = this.hourClusters.get(hour)
    if (!cs || !cs[clusterIdx]) return
    cs[clusterIdx] = { ...cs[clusterIdx], isDisabled: !cs[clusterIdx].isDisabled }
    // recalculate outliers for this hour
    const updated = markOutliers(cs)
    this.hourClusters.set(hour, updated)
    this.requestDraw()
  }
}

function niceStep(range: number): number {
  if (range <= 10)  return 2
  if (range <= 20)  return 5
  if (range <= 50)  return 10
  if (range <= 100) return 15
  return 30
}
