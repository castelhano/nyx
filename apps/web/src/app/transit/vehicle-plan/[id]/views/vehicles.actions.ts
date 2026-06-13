import type { GanttActionSpec, Selection, ActionItem } from '../engine/gantt.types'
import type { LayoutSegment }                          from '../engine/layout/layout.types'
import type { VehiclePlanGanttData }                   from './vehicles.view'

export const vehiclesActionSpec: GanttActionSpec<VehiclePlanGanttData> = {

  resolveSelection(clicked, current, { allSegments }) {
    if (clicked.isDeadhead) return current ?? null

    if (!current) return { type: 'trip', segment: clicked }

    const currentRowId = current.type === 'trip' ? current.segment.rowId : current.rowId

    // different row → new single trip
    if (currentRowId !== clicked.rowId) return { type: 'trip', segment: clicked }

    // same row: anchor is the 'from' for intervals, or the trip for single selection
    const anchor = current.type === 'trip' ? current.segment : current.from

    // clicking the anchor → deselect
    if (anchor.id === clicked.id) return null

    // same row, any direction → build/resize interval anchored at 'from'
    return buildInterval(anchor, clicked, allSegments)
  },

  getActions(selection, _data, onClose): ActionItem[] {
    if (selection.type === 'trip') return tripActions(onClose)
    return intervalActions(onClose)
  },
}

function buildInterval(
  a:           LayoutSegment,
  b:           LayoutSegment,
  allSegments: LayoutSegment[],
): Selection {
  const from = a.startMinute <= b.startMinute ? a : b
  const to   = a.startMinute <= b.startMinute ? b : a

  const rowSegs = allSegments
    .filter(s => s.rowId === a.rowId && !s.isDeadhead)
    .sort((x, y) => x.startMinute - y.startMinute)

  const segments = rowSegs.filter(
    s => s.startMinute >= from.startMinute && s.startMinute <= to.startMinute,
  )

  return { type: 'interval', rowId: a.rowId, segments, from, to }
}

function tripActions(onClose: () => void): ActionItem[] {
  return [
    {
      id:      'remove-trip',
      icon:    'Trash2',
      variant: 'icon',
      danger:  true,
      onClick: () => { onClose() },
    },
    {
      id:      'move-trip',
      label:   'Mover viagem',
      variant: 'text',
      onClick: () => { onClose() },
    },
    {
      id:      'swap-line',
      icon:    'ArrowRightLeft',
      label:   'Trocar linha',
      variant: 'both',
      onClick: () => { onClose() },
    },
  ]
}

function intervalActions(onClose: () => void): ActionItem[] {
  return [
    {
      id:      'split-block',
      icon:    'Scissors',
      variant: 'icon',
      onClick: () => { onClose() },
    },
    {
      id:      'move-interval',
      label:   'Mover intervalo',
      variant: 'text',
      onClick: () => { onClose() },
    },
    {
      id:      'reassign-driver',
      icon:    'Users',
      label:   'Reassinar condutor',
      variant: 'both',
      onClick: () => { onClose() },
    },
  ]
}
