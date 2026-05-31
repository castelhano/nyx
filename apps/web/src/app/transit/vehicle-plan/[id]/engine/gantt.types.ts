export interface GanttRow {
  id:    string
  label: string
  data:  unknown
}

export interface GanttSegment {
  id:          string
  rowId:       string
  startMinute: number
  endMinute:   number
  isDeadhead:  boolean
  label:       string
  color:       string
  data:        unknown
}

export interface GanttView<TData = unknown> {
  getRows:         (data: TData) => GanttRow[]
  getSegments:     (row: GanttRow, data: TData) => GanttSegment[]
  getRowLabel:     (row: GanttRow) => string
  segmentColor:    (seg: GanttSegment) => string
  onSegmentClick?: (seg: GanttSegment, pos: Point) => void
  editable?:       boolean
}

export interface Point {
  x: number
  y: number
}

export interface ViewportSnapshot {
  scrollX:         number
  scrollY:         number
  pixelsPerMinute: number
  width:           number
  dayStartMinute:  number
}
