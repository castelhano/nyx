import type { LayoutRow, LayoutSegment } from './layout/layout.types'

export interface GanttRow {
  id:    string
  label: string
  data:  unknown
}

// 'break' = intervalo (parada) — ver docs/proposal/vehicle-plan-block-intervals.md.
// Nome escolhido para não colidir com Selection.type === 'interval' (seleção em
// faixa), que é um conceito de UI sem relação com este domínio.
export type SegmentKind = 'trip' | 'deadhead' | 'break'

// Irregularity is computed by the view (duration vs. IntervalType min/max — always
// informative, never blocking, see docs/proposal/vehicle-plan-block-intervals.md
// §5.3). 'over' highlights only the excess tail via excessFromMinute; 'under' has
// no spatial excess to point at, so the renderer outlines the whole segment instead.
export interface SegmentIrregularity {
  severity:         'over' | 'under'
  excessFromMinute?: number
}

export interface GanttSegment {
  id:          string
  rowId:       string
  startMinute: number
  endMinute:   number
  kind:        SegmentKind
  locked?:     boolean
  label:       string
  color:       string
  data:        unknown
  // rendering hints for kind === 'break' — the engine stays display-agnostic
  // (per docs/architecture/transit/gantt-canvas.md), the view decides these.
  shape?:       'block' | 'pill'
  fillStyle?:   'solid' | 'outline'
  irregular?:   SegmentIrregularity | null
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

// ── row-targeted shortcut hints (e.g. move-target row) ──────────────────────────

export interface RowHintEntry {
  keys:  string[]
  label: string
}
