import type { GanttActionSpec, Selection, ActionItem, SplitMenuItem } from '../engine/gantt.types'
import type { LayoutSegment }                                          from '../engine/layout/layout.types'
import type { VehiclePlanGanttData, GanttBlock, GanttBlockTrip, GanttBlockDeadrun, TripConstraints } from './vehicles.view'

const ALL_LOCKED_FIELDS = ['departureMinutes', 'arrivalMinutes', 'cycleTime']

export interface VehiclesActionDeps {
  onUpdateConstraints: (tripIds: string[], patches: TripConstraints | null | TripConstraints[]) => void
  onDeleteTrips:       (tripIds: string[]) => void
  onDeleteDeadruns:    (deadrunIds: string[], blockId: string) => void
  onDeleteInterval:    (tripIds: string[], deadrunIds: string[], blockId: string) => void
  onAddAccess:         (blockTripId: string, blockId: string) => void
  onAddReturn:         (blockTripId: string, blockId: string) => void
}

export function createVehiclesActionSpec(
  deps: VehiclesActionDeps,
): GanttActionSpec<VehiclePlanGanttData> {
  return {

    resolveSelection(clicked, current, { allSegments }) {
      if (clicked.id.endsWith(':dead')) return current ?? null
      // deadrun segments are selectable (single click only — excluded from intervals by buildInterval)
      if (clicked.id.endsWith(':dr')) return { type: 'trip', segment: clicked }

      if (!current) return { type: 'trip', segment: clicked }

      const currentRowId = current.type === 'trip' ? current.segment.rowId : current.rowId

      if (currentRowId !== clicked.rowId) return { type: 'trip', segment: clicked }

      const anchor = current.type === 'trip' ? current.segment : current.from

      if (anchor.id === clicked.id) return null

      return buildInterval(anchor, clicked, allSegments)
    },

    getActions(selection, data, onClose): ActionItem[] {
      if (selection.type === 'trip') {
        // deadrun segment selected (single click only)
        if (selection.segment.id.endsWith(':dr')) {
          const d     = selection.segment.data as GanttBlockDeadrun
          const block = data.blocks.find(b => b.id === selection.segment.rowId)
          return block ? [makeDeleteDeadrunsAction([d.id], block.id, deps)] : []
        }

        const bt    = selection.segment.data as GanttBlockTrip
        const block = data.blocks.find(b => b.id === selection.segment.rowId)

        return [
          makeLockAction([selection.segment], selection.segment.rowId, deps, onClose),
          ...(block && canAddAccess(bt, block) ? [makeAccessAction(bt.id, block.id, deps)] : []),
          ...(block && canAddReturn(bt, block)  ? [makeReturnAction(bt.id, block.id, deps)] : []),
          makeDeleteAction([bt.trip.id], deps),
        ]
      }

      // interval selection — may include both trips and deadruns
      const tripSegs   = selection.segments.filter(s => !s.id.endsWith(':dr'))
      const drSegs     = selection.segments.filter(s =>  s.id.endsWith(':dr'))
      const tripIds    = tripSegs.map(s => (s.data as GanttBlockTrip).trip.id)
      const deadrunIds = drSegs.map(s => (s.data as GanttBlockDeadrun).id)

      console.log('[getActions interval]', { tripIds, deadrunIds, blockId: selection.rowId })

      return [
        makeLockAction(tripSegs, selection.rowId, deps, onClose),
        makeDeleteIntervalAction(tripIds, deadrunIds, selection.rowId, deps),
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
  const trips   = segments.filter(s => !s.id.endsWith(':dr')).map(s => (s.data as GanttBlockTrip).trip)
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

// ── access / return buttons ───────────────────────────────────────────────────

// gap ≤ this between two items → no room to insert a deadrun
const BACK_TO_BACK_THRESHOLD = 15 // minutes

function canAddAccess(bt: GanttBlockTrip, block: GanttBlock): boolean {
  const btDep = bt.trip.departureMinutes

  // already has an ACCESS deadrun arriving right before this trip
  if (block.blockDeadruns.some(
    (d: GanttBlockDeadrun) => d.type === 'ACCESS' && d.arrivalMinutes <= btDep && btDep - d.arrivalMinutes <= BACK_TO_BACK_THRESHOLD,
  )) return false

  // previous productive trip is back-to-back
  const prevTrip = block.blockTrips
    .filter(t => t.id !== bt.id && t.trip.arrivalMinutes <= btDep)
    .sort((a, b) => b.trip.arrivalMinutes - a.trip.arrivalMinutes)[0]
  if (prevTrip && btDep - prevTrip.trip.arrivalMinutes <= BACK_TO_BACK_THRESHOLD) return false

  return true
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
  const btArr = bt.trip.arrivalMinutes

  // already has a RETURN deadrun departing right after this trip
  if (block.blockDeadruns.some(
    (d: GanttBlockDeadrun) => d.type === 'RETURN' && d.departureMinutes >= btArr && d.departureMinutes - btArr <= BACK_TO_BACK_THRESHOLD,
  )) return false

  // next productive trip is back-to-back
  const nextTrip = block.blockTrips
    .filter(t => t.id !== bt.id && t.trip.departureMinutes >= btArr)
    .sort((a, b) => a.trip.departureMinutes - b.trip.departureMinutes)[0]
  if (nextTrip && nextTrip.trip.departureMinutes - btArr <= BACK_TO_BACK_THRESHOLD) return false

  return true
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

// ── delete buttons ────────────────────────────────────────────────────────────

function makeDeleteDeadrunsAction(deadrunIds: string[], blockId: string, deps: VehiclesActionDeps): ActionItem {
  return {
    id:      'delete-deadrun',
    label:   'Excluir vazio',
    icon:    'Trash2',
    variant: 'both',
    danger:  true,
    onClick: () => deps.onDeleteDeadruns(deadrunIds, blockId),
  }
}

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

function makeDeleteIntervalAction(
  tripIds:    string[],
  deadrunIds: string[],
  blockId:    string,
  deps:       VehiclesActionDeps,
): ActionItem {
  return {
    id:      'delete',
    label:   'Excluir',
    icon:    'Trash2',
    variant: 'both',
    danger:  true,
    onClick: () => deps.onDeleteInterval(tripIds, deadrunIds, blockId),
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
