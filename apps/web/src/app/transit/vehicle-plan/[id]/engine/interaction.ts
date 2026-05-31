import type { GanttEngine } from './gantt-engine'

type Handler = { el: EventTarget; type: string; fn: EventListenerOrEventListenerObject }

export class Interaction {
  private engine!:  GanttEngine
  private canvas!:  HTMLCanvasElement
  private handlers: Handler[]  = []
  private dragging  = false
  private lastDragY = 0

  init(engine: GanttEngine, canvas: HTMLCanvasElement): void {
    this.engine = engine
    this.canvas = canvas
    this.attach()
  }

  dispose(): void {
    for (const { el, type, fn } of this.handlers) {
      el.removeEventListener(type, fn)
    }
    this.handlers = []
  }

  private on(el: EventTarget, type: string, fn: EventListenerOrEventListenerObject): void {
    el.addEventListener(type, fn, { passive: false } as AddEventListenerOptions)
    this.handlers.push({ el, type, fn })
  }

  private attach(): void {
    this.on(this.canvas, 'wheel',      this.onWheel)
    this.on(this.canvas, 'mousedown',  this.onMouseDown)
    this.on(this.canvas, 'mousemove',  this.onMouseMove)
    this.on(this.canvas, 'mouseup',    this.onMouseUp)
    this.on(this.canvas, 'mouseleave', this.onMouseLeave)
    this.on(this.canvas, 'click',      this.onClick)
  }

  private onWheel = (e: Event): void => {
    const we = e as WheelEvent
    we.preventDefault()
    if (we.ctrlKey || we.metaKey) {
      const factor = we.deltaY < 0 ? 1.15 : 1 / 1.15
      this.engine.viewport.zoom(factor, we.offsetX)
    } else {
      this.engine.viewport.scrollTo(this.engine.viewport.scrollY + we.deltaY)
    }
    this.engine.requestDraw()
  }

  private onMouseDown = (e: Event): void => {
    const me = e as MouseEvent
    if (me.button !== 1) return  // middle button drag only
    this.dragging  = true
    this.lastDragY = me.clientY
    this.canvas.style.cursor = 'grabbing'
  }

  private onMouseMove = (e: Event): void => {
    const me = e as MouseEvent
    if (this.dragging) {
      const dy = this.lastDragY - me.clientY
      this.engine.viewport.scrollTo(this.engine.viewport.scrollY + dy)
      this.lastDragY = me.clientY
      this.engine.requestDraw()
    } else {
      const seg = this.engine.hitTester.hitTest({ x: me.offsetX, y: me.offsetY })
      this.engine.setHovered(seg)
    }
  }

  private onMouseUp = (): void => {
    this.dragging = false
    this.canvas.style.cursor = ''
  }

  private onMouseLeave = (): void => {
    this.dragging = false
    this.canvas.style.cursor = ''
    this.engine.setHovered(null)
  }

  private onClick = (e: Event): void => {
    const me  = e as MouseEvent
    const seg = this.engine.hitTester.hitTest({ x: me.offsetX, y: me.offsetY })
    if (seg) this.engine.handleSegmentClick(seg, { x: me.offsetX, y: me.offsetY })
  }
}
