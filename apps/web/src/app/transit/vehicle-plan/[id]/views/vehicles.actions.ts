import type { GanttActionSpec, Selection, ActionItem, SplitMenuItem } from '../engine/gantt.types'
import type { LayoutSegment }                                          from '../engine/layout/layout.types'
import type { VehiclePlanGanttData, GanttBlockTrip, TripConstraints } from './vehicles.view'

const ALL_LOCKED_FIELDS = ['departureMinutes', 'arrivalMinutes', 'cycleTime']

export interface VehiclesActionDeps {
  onUpdateConstraints: (tripIds: string[], patches: TripConstraints | null | TripConstraints[]) => void
  onDeleteTrips:       (tripIds: string[]) => void
}

export function createVehiclesActionSpec(
  deps: VehiclesActionDeps,
): GanttActionSpec<VehiclePlanGanttData> {
  return {

    resolveSelection(clicked, current, { allSegments }) {
      // skip positioning micro-segments (${bt.id}:dead) — not actual trips
      if (clicked.id.endsWith(':dead')) return current ?? null

      if (!current) return { type: 'trip', segment: clicked }

      const currentRowId = current.type === 'trip' ? current.segment.rowId : current.rowId

      if (currentRowId !== clicked.rowId) return { type: 'trip', segment: clicked }

      const anchor = current.type === 'trip' ? current.segment : current.from

      if (anchor.id === clicked.id) return null

      return buildInterval(anchor, clicked, allSegments)
    },

    getActions(selection, _data, onClose): ActionItem[] {
      if (selection.type === 'trip') {
        const tripIds = [(selection.segment.data as GanttBlockTrip).trip.id]
        return [
          makeLockAction([selection.segment], selection.segment.rowId, deps, onClose),
          makeDeleteAction(tripIds, deps),
        ]
      }

      const tripIds = selection.segments.map(s => (s.data as GanttBlockTrip).trip.id)
      return [
        makeLockAction(selection.segments, selection.rowId, deps, onClose),
        makeDeleteAction(tripIds, deps),
      ]
    },
  }
}

// ── lock split-button ─────────────────────────────────────────────────────────

function makeLockAction(
  segments: LayoutSegment[],
  blockId:  string,
  deps:     VehiclesActionDeps,
  onClose:  () => void,
): ActionItem {
  const trips = segments.map(s => (s.data as GanttBlockTrip).trip)
  const tripIds = trips.map(t => t.id)

  const hasAnyLock = trips.some(t => hasConstraints(t.constraints))
  const allFullyLocked = trips.every(t => isFullyLocked(t.constraints))

  // per-field checked state: true only if ALL trips have that field/flag
  const allHaveField = (field: string) =>
    trips.every(t => t.constraints?.locked?.includes(field))
  const allPinned = trips.every(t => !!t.constraints?.pinnedBlock)

  const splitMenu: SplitMenuItem[] = [
    {
      id:       'lock-departure',
      label:    'Horário inicial',
      checked:  allHaveField('departureMinutes'),
      onToggle: () => {
        const add = !allHaveField('departureMinutes')
        deps.onUpdateConstraints(tripIds, trips.map(t => toggleField(t.constraints, 'departureMinutes', add)))
      },
    },
    {
      id:       'lock-arrival',
      label:    'Horário final',
      checked:  allHaveField('arrivalMinutes'),
      onToggle: () => {
        const add = !allHaveField('arrivalMinutes')
        deps.onUpdateConstraints(tripIds, trips.map(t => toggleField(t.constraints, 'arrivalMinutes', add)))
      },
    },
    {
      id:       'lock-cycle',
      label:    'Tempo de ciclo',
      checked:  allHaveField('cycleTime'),
      onToggle: () => {
        const add = !allHaveField('cycleTime')
        deps.onUpdateConstraints(tripIds, trips.map(t => toggleField(t.constraints, 'cycleTime', add)))
      },
    },
    {
      id:       'pin-block',
      label:    'Fixar ao Bloco',
      checked:  allPinned,
      onToggle: () => {
        const add = !allPinned
        deps.onUpdateConstraints(tripIds, trips.map(t => togglePinned(t.constraints, add, blockId)))
      },
    },
  ]

  return {
    id:        'lock',
    icon:      hasAnyLock ? 'Lock' : 'LockOpen',
    variant:   'icon',
    active:    hasAnyLock,
    splitMenu,
    onClick: () => {
      if (hasAnyLock) {
        // unlock all — clear constraints entirely
        deps.onUpdateConstraints(tripIds, null)
      } else {
        // lock all time fields (not pinnedBlock — only via dropdown)
        deps.onUpdateConstraints(tripIds, trips.map(() => ({
          locked: [...ALL_LOCKED_FIELDS],
        })))
      }
      onClose()
    },
  }
}

// ── delete button ─────────────────────────────────────────────────────────────

function makeDeleteAction(tripIds: string[], deps: VehiclesActionDeps): ActionItem {
  return {
    id:      'delete',
    label:   'Excluir',
    icon:    'Trash2',
    variant: 'both',
    danger:  true,
    onClick: () => deps.onDeleteTrips(tripIds),
  }
}

// ── constraint helpers ────────────────────────────────────────────────────────

function hasConstraints(c: TripConstraints | null | undefined): boolean {
  if (!c) return false
  return (c.locked?.length ?? 0) > 0 || !!c.pinnedBlock
}

function isFullyLocked(c: TripConstraints | null | undefined): boolean {
  if (!c) return false
  return ALL_LOCKED_FIELDS.every(f => c.locked?.includes(f)) && !!c.pinnedBlock
}

function toggleField(
  current: TripConstraints | null | undefined,
  field:   string,
  add:     boolean,
): TripConstraints {
  const locked = current?.locked ? [...current.locked] : []
  const next   = add
    ? locked.includes(field) ? locked : [...locked, field]
    : locked.filter(f => f !== field)
  return { ...current, locked: next.length > 0 ? next : undefined }
}

function togglePinned(
  current: TripConstraints | null | undefined,
  add:     boolean,
  blockId: string,
): TripConstraints {
  if (!add) {
    const { pinnedBlock: _, ...rest } = current ?? {}
    return rest
  }
  return { ...current, pinnedBlock: blockId }
}

// ── interval builder ──────────────────────────────────────────────────────────

function buildInterval(
  a:           LayoutSegment,
  b:           LayoutSegment,
  allSegments: LayoutSegment[],
): Selection {
  const from = a.startMinute <= b.startMinute ? a : b
  const to   = a.startMinute <= b.startMinute ? b : a

  const rowSegs = allSegments
    .filter(s => s.rowId === a.rowId && !s.id.endsWith(':dead'))
    .sort((x, y) => x.startMinute - y.startMinute)

  const segments = rowSegs.filter(
    s => s.startMinute >= from.startMinute && s.startMinute <= to.startMinute,
  )

  return { type: 'interval', rowId: a.rowId, segments, from, to }
}
