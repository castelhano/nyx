import type { LayoutRow, LayoutSegment } from './layout/layout.types'

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

// ── selection ──────────────────────────────────────────────────────────────────

export type Selection =
  | { type: 'trip';     segment: LayoutSegment }
  | { type: 'interval'; rowId: string; segments: LayoutSegment[]; from: LayoutSegment; to: LayoutSegment }

// ── action bar ─────────────────────────────────────────────────────────────────

export interface SplitMenuItem {
  id:       string
  label:    string
  checked:  boolean
  onToggle: () => void
}

export interface ActionItem {
  id:         string
  label?:     string
  icon?:      string
  variant:    'icon' | 'text' | 'both'
  disabled?:  boolean
  danger?:    boolean
  active?:    boolean
  splitMenu?: SplitMenuItem[]
  onClick:    () => void
}

export interface SelectionContext {
  allSegments: LayoutSegment[]
  allRows:     LayoutRow[]
}

export interface GanttActionSpec<TData = unknown> {
  resolveSelection(
    clicked: LayoutSegment,
    current: Selection | null,
    ctx:     SelectionContext,
  ): Selection | null
  getActions(
    selection: Selection,
    data:      TData,
    onClose:   () => void,
  ): ActionItem[]
}
