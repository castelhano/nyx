import type { GanttActionSpec, Selection, ActionItem, SplitMenuItem } from '../engine/gantt.types'
import type { LayoutSegment }                                          from '../engine/layout/layout.types'
import type { VehiclePlanGanttData, GanttBlock, GanttBlockTrip, TripConstraints } from './vehicles.view'

const ALL_LOCKED_FIELDS = ['departureMinutes', 'arrivalMinutes', 'cycleTime']

export interface VehiclesActionDeps {
  onUpdateConstraints: (tripIds: string[], patches: TripConstraints | null | TripConstraints[]) => void
  onDeleteTrips:       (tripIds: string[]) => void
  onAddAccess:         (blockTripId: string, blockId: string) => void
  onAddReturn:         (blockTripId: string, blockId: string) => void
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

    getActions(selection, data, onClose): ActionItem[] {
      if (selection.type === 'trip') {
        const bt      = selection.segment.data as GanttBlockTrip
        const block   = data.blocks.find(b => b.id === selection.segment.rowId)
        const tripIds = [bt.trip.id]

        if (block) {
          const sorted = sortedTrips(block)
          console.group(`[Gantt] trip seq=${bt.sequence} | ${bt.trip.route?.line?.code ?? '?'}`)
          console.log('selected:', { id: bt.id, seq: bt.sequence, deadrunType: bt.trip.deadrunType, dep: bt.trip.departureMinutes, arr: bt.trip.arrivalMinutes })
          console.log('block trips:', sorted.map(t => ({ id: t.id, seq: t.sequence, deadrunType: t.trip.deadrunType, dep: t.trip.departureMinutes, arr: t.trip.arrivalMinutes })))
          console.log('canAddAccess:', canAddAccess(bt, block), '| canAddReturn:', canAddReturn(bt, block))
          console.groupEnd()
        }

        return [
          makeLockAction([selection.segment], selection.segment.rowId, deps, onClose),
          ...(block && canAddAccess(bt, block)      ? [makeAccessAction(bt.id, block.id, deps)]     : []),
          ...(block && canAddReturn(bt, block)       ? [makeReturnAction(bt.id, block.id, deps)]     : []),
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

// ── access / collection buttons ───────────────────────────────────────────────

// gap ≤ this between two productive trips → considered back-to-back (no room to insert deadrun)
const BACK_TO_BACK_THRESHOLD = 15 // minutes

function sortedTrips(block: GanttBlock): GanttBlockTrip[] {
  return [...block.blockTrips].sort((a, b) => a.sequence - b.sequence)
}

function canAddAccess(bt: GanttBlockTrip, block: GanttBlock): boolean {
  if (bt.trip.deadrunType != null) return false
  const sorted = sortedTrips(block)
  const idx    = sorted.findIndex(t => t.id === bt.id)
  if (idx < 0) return false
  const prev = sorted[idx - 1]
  if (!prev) return true
  if (prev.trip.deadrunType == null) {
    return (bt.trip.departureMinutes - prev.trip.arrivalMinutes) > BACK_TO_BACK_THRESHOLD
  }
  return prev.trip.deadrunType === 'RETURN'
}

function makeAccessAction(blockTripId: string, blockId: string, deps: VehiclesActionDeps): ActionItem {
  return {
    id:      'access',
    label:   'Acesso',
    icon:    'Warehouse',
    variant: 'both',
    onClick: () => deps.onAddAccess(blockTripId, blockId),
  }
}

function canAddReturn(bt: GanttBlockTrip, block: GanttBlock): boolean {
  if (bt.trip.deadrunType != null) return false
  const sorted = sortedTrips(block)
  const idx    = sorted.findIndex(t => t.id === bt.id)
  if (idx < 0) return false
  const next = sorted[idx + 1]
  if (!next) return true
  if (next.trip.deadrunType == null) {
    return (next.trip.departureMinutes - bt.trip.arrivalMinutes) > BACK_TO_BACK_THRESHOLD
  }
  return next.trip.deadrunType === 'ACCESS'
}

function makeReturnAction(blockTripId: string, blockId: string, deps: VehiclesActionDeps): ActionItem {
  return {
    id:      'return',
    label:   'Recolhida',
    icon:    'Warehouse',
    variant: 'both',
    onClick: () => deps.onAddReturn(blockTripId, blockId),
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
