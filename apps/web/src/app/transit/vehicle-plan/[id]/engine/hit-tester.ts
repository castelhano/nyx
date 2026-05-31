import type { Point } from './gantt.types'
import type { LayoutRow, LayoutSegment } from './layout/layout.types'
import type { Viewport } from './viewport'

interface IndexedRect {
  segId: string
  x:     number
  y:     number
  w:     number
  h:     number
}

export class HitTester {
  private rects: IndexedRect[] = []

  build(segments: LayoutSegment[], viewport: Viewport, rows: LayoutRow[]): void {
    const rowMap = new Map(rows.map((r) => [r.id, r]))
    this.rects   = []

    for (const seg of segments) {
      if (!viewport.isTimeVisible(seg.startMinute, seg.endMinute)) continue
      const row = rowMap.get(seg.rowId)
      if (!row || !viewport.isRowVisible(row.y, row.height)) continue

      const x = viewport.minuteToX(seg.startMinute)
      const w = Math.max(2, (seg.endMinute - seg.startMinute) * viewport.pixelsPerMinute)
      const y = viewport.contentToCanvasY(row.y)
      const h = row.height

      this.rects.push({ segId: seg.id, x, y, w, h })
    }
  }

  hitTest(point: Point): string | null {
    // iterate in reverse so top-rendered segments win
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const { segId, x, y, w, h } = this.rects[i]
      if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) {
        return segId
      }
    }
    return null
  }
}
