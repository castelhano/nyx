import type { GanttActionSpec, Selection, ActionItem } from '../engine/gantt.types'
import type { LayoutSegment }                          from '../engine/layout/layout.types'
import type { VehiclePlanGanttData }                   from './vehicles.view'

export const vehiclesActionSpec: GanttActionSpec<VehiclePlanGanttData> = {

  resolveSelection(clicked, current, { allSegments }) {
    // dead-run segments are not selectable
    if (clicked.isDeadhead) return current ?? null

    // clicking the already-selected trip deselects
    if (current?.type === 'trip' && current.segment.id === clicked.id) return null

    // no prior selection, or prior selection was an interval, or different row → single trip
    if (!current || current.type === 'interval' || current.segment.rowId !== clicked.rowId) {
      return { type: 'trip', segment: clicked }
    }

    // same row, second trip → expand to interval
    return buildInterval(current.segment, clicked, allSegments)
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
