// Cópia adaptada de transit-line/cycle-map/cycle-engine.ts para prototipagem
// isolada. Pontos continuam agrupados por hora cheia, igual à produção — o
// eixo X sempre mostra rótulos de hora cheia (5 | 6 | 7). A novidade é um
// segundo tipo de corte ("subCut"): um marcador fixo no meio da coluna,
// representando um corte de 30min dentro daquela hora, visualmente distinto
// (cor + forma) e posicionado logo acima do rótulo da faixa, sem entrar na
// área de plotagem dos pontos. A zona de clique da faixa inferior é dividida
// em três: ~25% perto de cada borda (corte cheio, como hoje) e o ~50% central
// (corte de 30min) — nunca competem entre si nem com os pontos.
import { markOutliers } from './data'
import type { DotCluster } from './data'

export interface DotClickInfo {
  cluster:    DotCluster
  slot:       number
  clusterIdx: number
  canvasX:    number
  canvasY:    number
}

export interface MarqueeItem {
  slot:    number
  idx:     number
  cluster: DotCluster
}

export interface MarqueeSelection {
  items: MarqueeItem[]
  x:     number
  y:     number
}

export interface CycleEngineState {
  width:  number
  height: number
}

const PAD   = { left: 52, right: 20, top: 44, bottom: 44 }
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
const CUT_HIT       = 7
const SUBCUT_ZONE   = 0.25  // fração da largura da coluna, a partir do centro, que conta como zona do corte de 30min
const DOT_HIT_PAD = 4
const DOT_MIN_R   = 5
const DOT_MAX_R   = 18
const MARQUEE_MIN_DRAG = 4

export class CycleEngineProto {
  private canvas!:       HTMLCanvasElement
  private ctx!:          CanvasRenderingContext2D
  private rafPending     = false
  private ready          = false
  private width          = 0
  private height         = 0

  private slotClusters:  Map<number, DotCluster[]> = new Map()
  private slots:         number[]                   = []
  private cuts:          Set<number>                = new Set()
  private subCuts:       Set<number>                = new Set()

  private hoveredDot:    { slot: number; idx: number } | null = null
  private dragCut:       { original: number; boundary: number; downX: number; downY: number } | null = null
  private marqueeDown:   { x: number; y: number } | null = null
  private marqueeRect:   { x0: number; y0: number; x1: number; y1: number } | null = null
  private confirmedSelection: MarqueeItem[] | null = null
  private suppressNextClick = false
  private handlers:      { el: EventTarget; type: string; fn: EventListener }[] = []

  onCutsChange?:     (cuts: number[]) => void
  onSubCutsChange?:  (subCuts: number[]) => void
  onDotClick?:       (info: DotClickInfo) => void
  onHoverChange?:    (info: DotClickInfo | null) => void
  onMarqueeSelect?:  (sel: MarqueeSelection | null) => void

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    const ctx   = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D not available')
    this.ctx    = ctx
    this.ready  = true
    this.applyDpr()
    this.attach()
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
      this.requestDraw()
    }
  }

  setData(slotClusters: Map<number, DotCluster[]>, cuts: number[], subCuts: number[]): void {
    this.slotClusters = slotClusters
    this.slots         = Array.from(slotClusters.keys()).sort((a, b) => a - b)
    this.cuts          = new Set(cuts)
    this.subCuts       = new Set(subCuts)
    this.requestDraw()
  }

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

  private draw(): void {
    const { ctx, width: W, height: H } = this
    ctx.clearRect(0, 0, W, H)
    if (this.slots.length === 0) return

    const { min: yMin, max: yMax } = this.yRange()
    const cW  = this.colWidth()
    const cH  = H - PAD.top - PAD.bottom

    ctx.save()
    for (let i = 0; i < this.slots.length; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = COLORS.band
        ctx.fillRect(PAD.left + i * cW, PAD.top, cW, cH)
      }
    }
    ctx.restore()

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

    ctx.save()
    ctx.font         = '11px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'top'
    ctx.textAlign    = 'center'
    ctx.fillStyle    = COLORS.axisText
    for (let i = 0; i < this.slots.length; i++) {
      const x = PAD.left + (i + 0.5) * cW
      ctx.fillText(String(this.slots[i]), x, H - PAD.bottom + 11)
    }
    ctx.restore()

    this.drawAvgLines(yMin, yMax)
    this.drawCuts(yMin, yMax)
    this.drawSubCuts()
    this.drawDots(yMin, yMax)
    this.drawMarquee()

    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(PAD.left, H - PAD.bottom)
    ctx.lineTo(W - PAD.right, H - PAD.bottom)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(PAD.left, PAD.top)
    ctx.lineTo(PAD.left, H - PAD.bottom)
    ctx.stroke()
    ctx.restore()
  }

  private drawAvgLines(yMin: number, yMax: number): void {
    const { ctx, width: W } = this
    const cuts = [...this.cuts].sort((a, b) => a - b)
    const minS = this.slots[0]
    const maxS = this.slots[this.slots.length - 1]
    const bounds = [minS, ...cuts.filter(c => c >= minS && c < maxS).map(c => c + 1), maxS + 1]

    for (let i = 0; i < bounds.length - 1; i++) {
      const from = bounds[i]
      const to   = bounds[i + 1] - 1
      const all: DotCluster[] = []
      const slotsInWindow = this.slots.filter(h => h >= from && h <= to)
      for (const h of slotsInWindow) {
        const cs = this.slotClusters.get(h)
        if (cs) all.push(...cs)
      }
      const active = all.filter(c => !c.isOutlier && !c.isDisabled)
      if (active.length === 0 || slotsInWindow.length === 0) continue
      const total = active.reduce((s, c) => s + c.minutes * c.count, 0)
      const cnt   = active.reduce((s, c) => s + c.count, 0)
      const avg   = total / cnt
      const rounded = Math.round(avg)
      const y     = Math.round(this.minutesToY(avg, yMin, yMax)) + 0.5
      const x1    = Math.max(PAD.left,        this.slotToX(slotsInWindow[0])! - this.colWidth() * 0.5)
      const x2    = Math.min(W - PAD.right,   this.slotToX(slotsInWindow[slotsInWindow.length - 1])! + this.colWidth() * 0.5)

      ctx.save()
      ctx.strokeStyle = COLORS.avgLine
      ctx.lineWidth   = 2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x1, y)
      ctx.lineTo(x2, y)
      ctx.stroke()
      ctx.restore()

      const label  = `${rounded}min`
      ctx.save()
      ctx.font         = 'bold 11px Inter, system-ui, sans-serif'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      const midX  = (x1 + x2) / 2
      const tw    = ctx.measureText(label).width
      const ph    = 18
      const pw    = tw + 12
      const stripMidY = PAD.top / 2
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
      const idx = this.slots.indexOf(cut)
      if (idx < 0 || idx >= this.slots.length - 1) continue
      const x       = Math.round(PAD.left + (idx + 1) * cW) + 0.5
      const isHover = this.dragCut?.original === cut || this.dragCut?.boundary === idx + 1

      ctx.strokeStyle = isHover ? COLORS.cutHover : COLORS.cut
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(x, PAD.top)
      ctx.lineTo(x, H - PAD.bottom)
      ctx.stroke()

      ctx.setLineDash([])
      ctx.fillStyle = isHover ? COLORS.cutHover : COLORS.cut
      ctx.beginPath()
      ctx.arc(x, H - PAD.bottom + 6, 5, 0, Math.PI * 2)
      ctx.fill()
    }

    if (this.dragCut) {
      const { boundary } = this.dragCut
      if (boundary > 0 && boundary < this.slots.length) {
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
      (this.confirmedSelection ?? liveSelection ?? []).map(s => `${s.slot}:${s.idx}`),
    )

    for (const h of this.slots) {
      const clusters = this.slotClusters.get(h)
      if (!clusters) continue
      const colIdx = this.slots.indexOf(h)

      for (let i = 0; i < clusters.length; i++) {
        const c   = clusters[i]
        const cx  = this.dotX(colIdx, i, clusters.length)
        const cy  = this.minutesToY(c.minutes, yMin, yMax)
        const r   = this.dotRadius(c.count)
        const hov = this.hoveredDot?.slot === h && this.hoveredDot.idx === i
        const sel = selectedKeys.has(`${h}:${i}`)

        ctx.globalAlpha = c.isDisabled ? 0.35 : 1

        ctx.fillStyle = c.isDisabled ? COLORS.disabled
          : c.isOutlier              ? COLORS.outlier
          : COLORS.normal
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()

        if (c.hasEdited && !c.isDisabled) {
          ctx.strokeStyle = COLORS.edited
          ctx.lineWidth   = 2
          ctx.stroke()
        }

        if (hov) {
          ctx.globalAlpha = 1
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'
          ctx.lineWidth   = 2
          ctx.stroke()
        }

        if (sel) {
          ctx.globalAlpha = 1
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth   = 2.5
          ctx.beginPath()
          ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
          ctx.stroke()
        }

        ctx.globalAlpha = 1

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

  private drawSubCuts(): void {
    const { ctx, height: H } = this
    const cW = this.colWidth()
    ctx.save()
    for (const subCut of this.subCuts) {
      const idx = this.slots.indexOf(subCut)
      if (idx < 0) continue
      const x = Math.round(PAD.left + (idx + 0.5) * cW) + 0.5
      const y = H - PAD.bottom + 5
      ctx.fillStyle = COLORS.subCut
      ctx.beginPath()
      ctx.moveTo(x, y - 4)
      ctx.lineTo(x + 4, y)
      ctx.lineTo(x, y + 4)
      ctx.lineTo(x - 4, y)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  private dotX(colIdx: number, dotIdx: number, total: number): number {
    const cW      = this.colWidth()
    const colLeft = PAD.left + colIdx * cW
    if (total === 1) return colLeft + cW / 2
    const margin  = Math.max(DOT_MAX_R + 2, cW * 0.1)
    const usable  = Math.max(0, cW - 2 * margin)
    return colLeft + margin + (dotIdx / (total - 1)) * usable
  }

  private colWidth(): number {
    if (this.slots.length === 0) return 1
    return (this.width - PAD.left - PAD.right) / this.slots.length
  }

  private slotToX(h: number): number | null {
    const idx = this.slots.indexOf(h)
    if (idx < 0) return null
    return PAD.left + (idx + 0.5) * this.colWidth()
  }

  private minutesToY(m: number, yMin: number, yMax: number): number {
    const chartH = this.height - PAD.top - PAD.bottom
    return PAD.top + (1 - (m - yMin) / (yMax - yMin)) * chartH
  }

  private yRange(): { min: number; max: number } {
    let lo = Infinity, hi = -Infinity
    for (const cs of this.slotClusters.values()) {
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
      const boundary = this.slots.indexOf(cut) + 1
      this.dragCut   = { original: cut, boundary, downX: x, downY: y }
      this.canvas.style.cursor = 'ew-resize'
      e.preventDefault()
      return
    }

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

    const dot = this.hitDot(x, y)
    const prev = this.hoveredDot
    this.hoveredDot = dot ? { slot: dot.slot, idx: dot.idx } : null

    const changed = prev?.slot !== this.hoveredDot?.slot || prev?.idx !== this.hoveredDot?.idx
    if (changed) {
      this.canvas.style.cursor = dot ? 'pointer' : this.hitCut(x, y) !== null ? 'ew-resize' : ''
      this.onHoverChange?.(dot ? {
        cluster:    dot.cluster,
        slot:       dot.slot,
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
        next.delete(original)
      } else {
        const newCut = boundary > 0 && boundary < this.slots.length
          ? this.slots[boundary - 1]
          : null
        next.delete(original)
        if (newCut !== null && newCut !== original) next.add(newCut)
        else next.add(original)
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

    const dot = this.hitDot(x, y)
    if (dot) {
      this.onDotClick?.({
        cluster:    dot.cluster,
        slot:       dot.slot,
        clusterIdx: dot.idx,
        canvasX:    dot.cx,
        canvasY:    y,
      })
      return
    }

    const isInCutZone = y > H - PAD.bottom - 4
    if (isInCutZone) {
      // zona central da coluna (metade do meio) → corte de 30min; toggle
      const sub = this.xToMidpointSlot(x)
      if (sub !== null) {
        const next = new Set(this.subCuts)
        if (next.has(sub)) next.delete(sub); else next.add(sub)
        this.subCuts = next
        this.onSubCutsChange?.([...this.subCuts])
        this.requestDraw()
        return
      }

      // resto da faixa (perto das bordas da coluna) → corte cheio, como hoje
      const b = this.xToBoundary(x)
      if (b !== null && b > 0 && b < this.slots.length) {
        const cut = this.slots[b - 1]
        const next = new Set(this.cuts)
        next.add(cut)
        this.cuts = next
        this.onCutsChange?.([...this.cuts])
        this.requestDraw()
      }
    }
  }

  private hitDot(
    mx: number, my: number,
  ): { slot: number; idx: number; cluster: DotCluster; cx: number } | null {
    const { min: yMin, max: yMax } = this.yRange()
    let best: { slot: number; idx: number; cluster: DotCluster; cx: number; dist: number } | null = null

    for (const h of this.slots) {
      const cs     = this.slotClusters.get(h)
      if (!cs) continue
      const colIdx = this.slots.indexOf(h)
      for (let i = 0; i < cs.length; i++) {
        const cx   = this.dotX(colIdx, i, cs.length)
        const cy   = this.minutesToY(cs[i].minutes, yMin, yMax)
        const r    = this.dotRadius(cs[i].count) + DOT_HIT_PAD
        const dist = Math.hypot(mx - cx, my - cy)
        if (dist <= r && (!best || dist < best.dist)) {
          best = { slot: h, idx: i, cluster: cs[i], cx, dist }
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

    for (const h of this.slots) {
      const cs = this.slotClusters.get(h)
      if (!cs) continue
      const colIdx = this.slots.indexOf(h)
      for (let i = 0; i < cs.length; i++) {
        const cx = this.dotX(colIdx, i, cs.length)
        const cy = this.minutesToY(cs[i].minutes, yMin, yMax)
        if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
          found.push({ slot: h, idx: i, cluster: cs[i] })
        }
      }
    }
    return found
  }

  private hitCut(x: number, y: number): number | null {
    if (y > this.height - PAD.bottom + 14) return null
    const cW = this.colWidth()
    for (const cut of this.cuts) {
      const idx = this.slots.indexOf(cut)
      if (idx < 0) continue
      const cx = PAD.left + (idx + 1) * cW
      if (Math.abs(x - cx) <= CUT_HIT) return cut
    }
    return null
  }

  private xToBoundary(x: number): number | null {
    const cW = this.colWidth()
    const b  = Math.round((x - PAD.left) / cW)
    if (b < 0 || b > this.slots.length) return null
    return b
  }

  // retorna a hora da coluna se x cair na faixa central (SUBCUT_ZONE) dela,
  // ou null se estiver perto o bastante de uma borda para ser corte cheio
  private xToMidpointSlot(x: number): number | null {
    const cW = this.colWidth()
    const rel = (x - PAD.left) / cW
    const colIdx = Math.floor(rel)
    if (colIdx < 0 || colIdx >= this.slots.length) return null
    const fracInCol = rel - colIdx
    if (Math.abs(fracInCol - 0.5) <= SUBCUT_ZONE) return this.slots[colIdx]
    return null
  }

  private applyDpr(): void {
    const dpr            = window.devicePixelRatio ?? 1
    this.canvas.width    = this.width  * dpr
    this.canvas.height   = this.height * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  toggleDot(slot: number, clusterIdx: number): void {
    const cs = this.slotClusters.get(slot)
    if (!cs || !cs[clusterIdx]) return
    cs[clusterIdx] = { ...cs[clusterIdx], isDisabled: !cs[clusterIdx].isDisabled }
    const updated = markOutliers(cs)
    this.slotClusters.set(slot, updated)
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
