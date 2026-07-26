import type { GanttRow, GanttSegment, SegmentKind, SegmentIrregularity } from '../gantt.types'

export interface LayoutRow {
  id:     string
  label:  string
  y:      number   // CSS pixels from top of content area
  height: number   // CSS pixels
  lanes:  number   // parallel lanes (1 for sequential)
  data:   unknown
}

export interface LayoutSegment {
  id:          string
  rowId:       string
  laneIndex:   number
  startMinute: number
  endMinute:   number
  kind:        SegmentKind
  locked?:     boolean
  label:       string
  color:       string
  data:        unknown
  shape?:      'block' | 'pill'
  fillStyle?:  'solid' | 'outline'
  irregular?:  SegmentIrregularity | null
}

export interface LayoutResult {
  rows:        LayoutRow[]
  segments:    LayoutSegment[]
  totalHeight: number
}

export interface LayoutStrategy {
  compute(rows: GanttRow[], segments: GanttSegment[]): LayoutResult
}
