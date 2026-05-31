import type { GanttRow, GanttSegment } from '../gantt.types'
import type { LayoutResult, LayoutStrategy } from './layout.types'

const ROW_HEIGHT = 44
const ROW_GAP    = 2

export class SequentialLayout implements LayoutStrategy {
  compute(rows: GanttRow[], segments: GanttSegment[]): LayoutResult {
    let y = 0
    const layoutRows = rows.map((row) => {
      const lr = { id: row.id, label: row.label, y, height: ROW_HEIGHT, lanes: 1, data: row.data }
      y += ROW_HEIGHT + ROW_GAP
      return lr
    })

    const layoutSegments = segments.map((seg) => ({ ...seg, laneIndex: 0 }))

    return { rows: layoutRows, segments: layoutSegments, totalHeight: y }
  }
}
