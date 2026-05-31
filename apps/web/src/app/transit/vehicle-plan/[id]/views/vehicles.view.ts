import type { GanttView, GanttRow, GanttSegment } from '../engine/gantt.types'

// ── API shapes ────────────────────────────────────────────────────────────────

export interface GanttBlockTrip {
  id:              string
  sequence:        number
  isDeadhead:      boolean
  deadheadMinutes: number | null
  deadheadKm:      number | null
  trip: {
    departureMinutes: number
    arrivalMinutes:   number
    route: {
      line:                { id: string; code: string; name: string }
      originLocality:      { id: string; name: string }
      destinationLocality: { id: string; name: string }
    }
  }
}

export interface GanttBlock {
  id:          string
  blockNumber: number
  vehicleType: string
  summary:     unknown
  blockTrips:  GanttBlockTrip[]
}

export interface VehiclePlanGanttData {
  plan: {
    id:      string
    status:  string
    summary: unknown
    lines:   Array<{ lineId: string; line: { id: string; code: string; name: string } }>
  }
  blocks: GanttBlock[]
}

// ── color palette ─────────────────────────────────────────────────────────────

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1',
  '#14b8a6', '#a855f7', '#f43f5e', '#0ea5e9', '#22c55e',
]
const DEADHEAD_COLOR = '#d1d5db'

function lineColorMap(blocks: GanttBlock[]): Map<string, string> {
  const lineIds = [...new Set(blocks.flatMap((b) =>
    b.blockTrips.filter((t) => !t.isDeadhead).map((t) => t.trip.route.line.id),
  ))]
  const map = new Map<string, string>()
  lineIds.forEach((id, i) => map.set(id, PALETTE[i % PALETTE.length]))
  return map
}

// ── view definition ───────────────────────────────────────────────────────────

export const vehiclesView: GanttView<VehiclePlanGanttData> = {
  getRows(data): GanttRow[] {
    return data.blocks.map((b) => ({
      id:    b.id,
      label: `Bloco ${b.blockNumber}`,
      data:  b,
    }))
  },

  getSegments(row, data): GanttSegment[] {
    const block   = row.data as GanttBlock
    const colors  = lineColorMap(data.blocks)
    const segs: GanttSegment[] = []

    for (const bt of block.blockTrips) {
      const { trip } = bt

      // dead run segment placed immediately before the trip departure
      if (bt.isDeadhead && bt.deadheadMinutes != null && bt.deadheadMinutes > 0) {
        const endMin   = trip.departureMinutes
        const startMin = endMin - bt.deadheadMinutes
        segs.push({
          id:          `${bt.id}:dead`,
          rowId:       row.id,
          startMinute: startMin,
          endMinute:   endMin,
          isDeadhead:  true,
          label:       'Dead',
          color:       DEADHEAD_COLOR,
          data:        bt,
        })
      }

      segs.push({
        id:          bt.id,
        rowId:       row.id,
        startMinute: trip.departureMinutes,
        endMinute:   trip.arrivalMinutes,
        isDeadhead:  false,
        label:       trip.route.line.code,
        color:       colors.get(trip.route.line.id) ?? PALETTE[0],
        data:        bt,
      })
    }

    return segs
  },

  getRowLabel: (row) => row.label,
  segmentColor: (seg) => seg.color,
  editable: true,
}
