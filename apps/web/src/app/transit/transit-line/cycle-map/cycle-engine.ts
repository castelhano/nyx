import { markOutliers, buildRawWindowCandidates, type Methodology } from './cycle-utils'
import type { DotCluster, DotClickInfo, CycleEngineState, MarqueeItem, MarqueeSelection } from './types'

const PAD   = { left: 52, right: 20, bottom: 44 }
const MIN_TOP_PAD = 44
const PILL_ROW_H   = 22   // vertical spacing between stacked avg-pill rows when they'd otherwise overlap
const COLORS = {
  normal:   '#3b82f6',
  outlier:  '#ef4444',
  disabled: '#9ca3af',
  edited:   '#f97316',
  cut:      '#64748b',
  cutHover: '#0f172a',
  subCut:      '#8b5cf6',
  subCutHover: '#6d28d9',
  grid:     'rgba(0,0,0,0.07)',
  gridH:    'rgba(0,0,0,0.05)',
  axisText: '#64748b',
  avgLine:  'rgba(59,130,246,0.35)',
  band:     'rgba(0,0,0,0.02)',
}
const CUT_HIT     = 7   // px tolerance to hit a cut line
const SUBCUT_ZONE = 0.25  // fraction of column width, from its center, that counts as the 30min cut click zone
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
  private subCuts:       Set<number>                = new Set()
  private methodology:   Methodology                 = 'linear'
  // grows past MIN_TOP_PAD when avg pills need to stack into extra rows —
  // recomputed at the start of every draw() so it never falls out of sync
  private topPad:        number                      = MIN_TOP_PAD

  private hoveredDot:    { hour: number; idx: number } | null = null
  private dragCut:       { original: number; boundary: number; downX: number; downY: number } | null = null
  private marqueeDown:   { x: number; y: number } | null = null
  private marqueeRect:   { x0: number; y0: number; x1: number; y1: number } | null = null
  private confirmedSelection: MarqueeItem[] | null = null
  private suppressNextClick = false
  private handlers:      { el: EventTarget; type: string; fn: EventListener }[] = []

  onStateChange?:    (s: CycleEngineState) => void
  onCutsChange?:     (cuts: number[]) => void
  onSubCutsChange?:  (subCuts: number[]) => void
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

  setData(hourClusters: Map<number, DotCluster[]>, cuts: number[], subCuts: number[], methodology: Methodology): void {
    this.hourClusters = hourClusters
    this.hours        = Array.from(hourClusters.keys()).sort((a, b) => a - b)
    this.cuts         = new Set(cuts)
    this.subCuts      = new Set(subCuts)
    this.methodology  = methodology
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

    // avg pills are laid out first — they decide how tall the top margin
    // needs to be this frame (grows when narrow 30min-cut windows force
    // them to stack into extra rows), so everything else below reads it
    // off this.topPad instead of a fixed constant
    const avg = this.computeAvgPills()
    this.topPad = avg.topPad

    const { min: yMin, max: yMax } = this.yRange()
    const cW  = this.colWidth()
    const cH  = H - this.topPad - PAD.bottom

    // column bands
    ctx.save()
    for (let i = 0; i < this.hours.length; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = COLORS.band
        ctx.fillRect(PAD.left + i * cW, this.topPad, cW, cH)
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
    this.drawAvgLines(avg, yMin, yMax)

    // cut lines
    this.drawCuts(yMin, yMax)

    // 30min sub-cut lines
    this.drawSubCuts()

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
    ctx.moveTo(PAD.left, this.topPad)
    ctx.lineTo(PAD.left, H - PAD.bottom)
    ctx.stroke()
    ctx.restore()
  }

  // lays out (but doesn't draw) the avg pills, and derives how tall the top
  // margin needs to be this frame — called once at the start of draw(),
  // before the margin-dependent geometry (minutesToY etc.) is settled
  private computeAvgPills(): {
    pills: { c: { from: number; to: number; minutes: number }; x1: number; x2: number; midX: number; pw: number; label: string }[]
    rows: number[]
    topPad: number
  } {
    const { ctx, width: W } = this
    const candidates = buildRawWindowCandidates(this.hourClusters, [...this.cuts], [...this.subCuts], this.methodology)
      .filter(c => c.minutes > 0)

    ctx.save()
    ctx.font = 'bold 11px Inter, system-ui, sans-serif'
    // "'" instead of "min" keeps the pill narrow enough for short windows —
    // a 30min sub-cut can produce a window as narrow as half a column
    const pills = candidates.map(c => {
      const x1    = Math.max(PAD.left,      this.slotToX(c.from, 'from'))
      const x2    = Math.min(W - PAD.right, this.slotToX(c.to,   'to'))
      const label = `${c.minutes}'`
      const pw    = ctx.measureText(label).width + 12
      const midX  = (x1 + x2) / 2
      return { c, x1, x2, midX, pw, label }
    })
    ctx.restore()

    // stack pills into rows when adjacent ones would otherwise overlap —
    // narrow windows from a 30min sub-cut sit close enough to their
    // neighbor that a single fixed row isn't always enough room
    const rowRightEdge: number[] = []
    const rows = pills.map(p => {
      const left = p.midX - p.pw / 2
      for (let r = 0; r < rowRightEdge.length; r++) {
        if (left > rowRightEdge[r] + 4) { rowRightEdge[r] = p.midX + p.pw / 2; return r }
      }
      rowRightEdge.push(p.midX + p.pw / 2)
      return rowRightEdge.length - 1
    })

    const rowCount = rowRightEdge.length
    const topPad   = rowCount > 0 ? Math.max(MIN_TOP_PAD, 12 + rowCount * PILL_ROW_H + 10) : MIN_TOP_PAD

    return { pills, rows, topPad }
  }

  private isDark(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  }

  private drawAvgLines(
    avg: ReturnType<CycleEngine['computeAvgPills']>,
    yMin: number,
    yMax: number,
  ): void {
    const { ctx } = this
    const { pills, rows } = avg

    for (let i = 0; i < pills.length; i++) {
      const { c, x1, x2, midX, pw, label } = pills[i]
      const y = Math.round(this.minutesToY(c.minutes, yMin, yMax)) + 0.5

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
      ctx.save()
      ctx.font         = 'bold 11px Inter, system-ui, sans-serif'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      const ph        = 18
      const stripMidY = 12 + rows[i] * PILL_ROW_H
      const pillY     = stripMidY - ph / 2
      const dark      = this.isDark()
      ctx.fillStyle   = dark ? 'rgba(30,41,59,0.92)' : 'rgba(255,255,255,0.92)'
      ctx.strokeStyle = COLORS.avgLine
      ctx.lineWidth   = 1
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.roundRect(midX - pw / 2, pillY, pw, ph, 5)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = dark ? '#93c5fd' : '#3b82f6'
      ctx.fillText(label, midX, stripMidY)
      ctx.restore()
    }
  }

  // maps a candidate's from/to (whole hour, or hour+0.5 from a 30min sub-cut)
  // to an x position: as a start it's the column's left edge (or midpoint for
  // a .5 value); as an end it's the column's right edge (or midpoint if the
  // value is a bare hour, meaning the window was truncated mid-column)
  private slotToX(v: number, role: 'from' | 'to'): number {
    const h    = Math.floor(v)
    const half = v - h === 0.5
    const mid  = this.hourToX(h) ?? PAD.left
    const cW   = this.colWidth()
    if (role === 'from') return half ? mid : mid - cW / 2
    return half ? mid + cW / 2 : mid
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
      ctx.moveTo(x, this.topPad)
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
        ctx.moveTo(x, this.topPad)
        ctx.lineTo(x, H - PAD.bottom)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
    ctx.restore()
  }

  private drawSubCuts(): void {
    const { ctx, height: H } = this
    ctx.save()
    ctx.lineWidth = 1   // thinner than the full cut's line, to read as a lighter/secondary mark

    for (const subCut of this.subCuts) {
      const x = this.hourToX(subCut)
      if (x === null) continue
      const rx = Math.round(x) + 0.5

      ctx.strokeStyle = COLORS.subCut
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(rx, this.topPad)
      ctx.lineTo(rx, H - PAD.bottom)
      ctx.stroke()

      // diamond handle, sitting above the X axis hour label instead of on top of it
      ctx.setLineDash([])
      ctx.fillStyle = COLORS.subCut
      const hy = H - PAD.bottom + 4
      ctx.beginPath()
      ctx.moveTo(rx,     hy - 3)
      ctx.lineTo(rx + 3, hy)
      ctx.lineTo(rx,     hy + 3)
      ctx.lineTo(rx - 3, hy)
      ctx.closePath()
      ctx.fill()
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
      for (const { cluster: c, idx: i, cx } of this.layoutDotsForHour(h)) {
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

  // `half` constrains the spread to one side of the column (0 = left/first
  // half, 1 = right/second half) when the hour has an active 30min sub-cut;
  // null spreads across the whole column, as when there's no sub-cut
  private dotX(colIdx: number, dotIdx: number, total: number, half: 0 | 1 | null): number {
    const cW      = this.colWidth()
    const colLeft = PAD.left + colIdx * cW
    const segW    = half === null ? cW : cW / 2
    const segLeft = colLeft + (half === 1 ? cW / 2 : 0)
    if (total === 1) return segLeft + segW / 2
    const margin  = Math.max(DOT_MAX_R + 2, segW * 0.1)
    const usable  = Math.max(0, segW - 2 * margin)
    return segLeft + margin + (dotIdx / (total - 1)) * usable
  }

  // a cluster can mix trips from both halves of the hour (it's grouped by
  // similar cycle time, not by departure time) — majority side wins for
  // where its dot gets positioned
  private clusterHalf(cluster: DotCluster): 0 | 1 {
    let first = 0, second = 0
    for (const t of cluster.trips) {
      const minute = parseInt(t.departureTime.split(':')[1] ?? '0', 10) || 0
      if (minute >= 30) second++; else first++
    }
    return second > first ? 1 : 0
  }

  // positions every dot for an hour in one place, so drawing and hit-testing
  // can never drift apart. `idx` is always the cluster's index in the
  // original hourClusters array (not the position within its half-group) —
  // that's what hover/toggle/marquee state keys off.
  private layoutDotsForHour(h: number): { cluster: DotCluster; idx: number; cx: number }[] {
    const clusters = this.hourClusters.get(h)
    if (!clusters) return []
    const colIdx = this.hours.indexOf(h)

    if (!this.subCuts.has(h)) {
      return clusters.map((cluster, idx) => ({ cluster, idx, cx: this.dotX(colIdx, idx, clusters.length, null) }))
    }

    const firstIdx:  number[] = []
    const secondIdx: number[] = []
    clusters.forEach((c, i) => (this.clusterHalf(c) === 1 ? secondIdx : firstIdx).push(i))

    const result: { cluster: DotCluster; idx: number; cx: number }[] = []
    firstIdx.forEach((origIdx, gi) => result.push({
      cluster: clusters[origIdx], idx: origIdx, cx: this.dotX(colIdx, gi, firstIdx.length, 0),
    }))
    secondIdx.forEach((origIdx, gi) => result.push({
      cluster: clusters[origIdx], idx: origIdx, cx: this.dotX(colIdx, gi, secondIdx.length, 1),
    }))
    return result
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
    const chartH = this.height - this.topPad - PAD.bottom
    return this.topPad + (1 - (m - yMin) / (yMax - yMin)) * chartH
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
      this.dragCut   = { original: cut, boundary, downX: x, downY: y }
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
      const { original, boundary, downX, downY } = this.dragCut
      this.dragCut = null
      this.canvas.style.cursor = ''
      this.suppressNextClick = true

      const moved = Math.hypot(e.offsetX - downX, e.offsetY - downY) > MARQUEE_MIN_DRAG
      const next  = new Set(this.cuts)

      if (!moved) {
        // plain click on a cut, no drag → remove it
        next.delete(original)
      } else {
        // remove old cut, add at new position
        const newCut = boundary > 0 && boundary < this.hours.length
          ? this.hours[boundary - 1]
          : null
        next.delete(original)
        if (newCut !== null && newCut !== original) next.add(newCut)
        else next.add(original) // didn't cross a boundary — keep original
      }

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

    // cut zone (bottom strip) → add cut
    // (clicks on an existing cut are handled by the mousedown/mouseup drag-or-remove path above)
    const isInCutZone = y > H - PAD.bottom - 4

    if (isInCutZone) {
      // center band of the column → 30min sub-cut, toggle on/off
      const subHour = this.xToMidpointHour(x)
      if (subHour !== null) {
        const next = new Set(this.subCuts)
        if (next.has(subHour)) next.delete(subHour); else next.add(subHour)
        this.subCuts = next
        this.onSubCutsChange?.([...this.subCuts])
        this.requestDraw()
        return
      }

      // rest of the strip (near a column boundary) → full cut, as before
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
      for (const { cluster, idx: i, cx } of this.layoutDotsForHour(h)) {
        const cy   = this.minutesToY(cluster.minutes, yMin, yMax)
        const r    = this.dotRadius(cluster.count) + DOT_HIT_PAD
        const dist = Math.hypot(mx - cx, my - cy)
        if (dist <= r && (!best || dist < best.dist)) {
          best = { hour: h, idx: i, cluster, cx, dist }
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
      for (const { cluster, idx: i, cx } of this.layoutDotsForHour(h)) {
        const cy = this.minutesToY(cluster.minutes, yMin, yMax)
        if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
          found.push({ hour: h, idx: i, cluster })
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

  // returns the hour whose column x falls in the center band (SUBCUT_ZONE) of,
  // or null if x is close enough to a boundary to be a full-cut click instead
  private xToMidpointHour(x: number): number | null {
    const cW = this.colWidth()
    const rel = (x - PAD.left) / cW
    const colIdx = Math.floor(rel)
    if (colIdx < 0 || colIdx >= this.hours.length) return null
    const fracInCol = rel - colIdx
    if (Math.abs(fracInCol - 0.5) <= SUBCUT_ZONE) return this.hours[colIdx]
    return null
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
