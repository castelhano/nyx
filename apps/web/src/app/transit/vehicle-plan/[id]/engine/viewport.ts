import type { ViewportSnapshot } from './gantt.types'

export class Viewport {
  width           = 0
  height          = 0
  pixelsPerMinute = 1.2
  scrollY         = 0
  scrollX         = 0
  totalHeight     = 0
  dayStartMinute  = 0
  dayEndMinute    = 1440

  resize(width: number, height: number): void {
    this.width  = width
    this.height = height
  }

  minuteToX(minute: number): number {
    return (minute - this.dayStartMinute) * this.pixelsPerMinute - this.scrollX
  }

  xToMinute(x: number): number {
    return (x + this.scrollX) / this.pixelsPerMinute + this.dayStartMinute
  }

  contentToCanvasY(contentY: number): number {
    return contentY - this.scrollY
  }

  get visibleStartMinute(): number {
    return this.xToMinute(0)
  }

  get visibleEndMinute(): number {
    return this.xToMinute(this.width)
  }

  isTimeVisible(startMinute: number, endMinute: number): boolean {
    return endMinute > this.visibleStartMinute && startMinute < this.visibleEndMinute
  }

  isRowVisible(contentY: number, height: number): boolean {
    const canvasY = this.contentToCanvasY(contentY)
    return canvasY + height > 0 && canvasY < this.height
  }

  zoom(factor: number, centerX: number): void {
    const minuteAtCenter     = this.xToMinute(centerX)
    this.pixelsPerMinute     = Math.max(0.3, Math.min(10, this.pixelsPerMinute * factor))
    this.scrollX             = (minuteAtCenter - this.dayStartMinute) * this.pixelsPerMinute - centerX
    this.scrollX             = Math.max(0, this.scrollX)
  }

  scrollTo(y: number): void {
    const maxScroll = Math.max(0, this.totalHeight - this.height)
    this.scrollY    = Math.max(0, Math.min(maxScroll, y))
  }

  scrollXTo(x: number): void {
    const maxScroll = Math.max(0, (this.dayEndMinute - this.dayStartMinute) * this.pixelsPerMinute - this.width)
    this.scrollX    = Math.max(0, Math.min(maxScroll, x))
  }

  snapshot(): ViewportSnapshot {
    return {
      scrollX:         this.scrollX,
      scrollY:         this.scrollY,
      pixelsPerMinute: this.pixelsPerMinute,
      width:           this.width,
      dayStartMinute:  this.dayStartMinute,
    }
  }
}
