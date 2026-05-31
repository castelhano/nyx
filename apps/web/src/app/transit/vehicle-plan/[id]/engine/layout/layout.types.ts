import type { GanttRow, GanttSegment } from '../gantt.types'

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
  isDeadhead:  boolean
  label:       string
  color:       string
  data:        unknown
}

export interface LayoutResult {
  rows:        LayoutRow[]
  segments:    LayoutSegment[]
  totalHeight: number
}

export interface LayoutStrategy {
  compute(rows: GanttRow[], segments: GanttSegment[]): LayoutResult
}
