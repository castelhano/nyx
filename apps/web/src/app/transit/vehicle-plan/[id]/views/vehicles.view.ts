import type { GanttView, GanttRow, GanttSegment } from '../engine/gantt.types'
import type { VehicleBlockSummary } from '@nyx/schemas'

// ── API shapes ────────────────────────────────────────────────────────────────

export interface TripConstraints {
  locked?:      string[]
  pinnedBlock?: string
}

export interface GanttBlockTrip {
  id:       string
  sequence: number
  trip: {
    id:               string
    departureMinutes: number
    arrivalMinutes:   number
    deadrunType:      string | null
    deadrunKm:        number | null
    constraints:      TripConstraints | null
    route: {
      direction:           string
      line:                { id: string; code: string; name: string }
      originLocality:      { id: string; name: string }
      destinationLocality: { id: string; name: string }
    } | null
  }
}

export interface GanttBlock {
  id:          string
  blockNumber: number
  vehicleType: string
  summary:     VehicleBlockSummary | null
  blockTrips:  GanttBlockTrip[]
}

export interface VehiclePlanGanttData {
  plan: {
    id:      string
    status:  string
    summary: unknown
    dayType: { id: string; name: string; code: string } | null
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

// Blend hex color with white to produce a lighter variant for INBOUND trips
function lightenHex(hex: string, amount = 0.45): string {
  const r  = parseInt(hex.slice(1, 3), 16)
  const g  = parseInt(hex.slice(3, 5), 16)
  const b  = parseInt(hex.slice(5, 7), 16)
  const lr = Math.round(r + (255 - r) * amount)
  const lg = Math.round(g + (255 - g) * amount)
  const lb = Math.round(b + (255 - b) * amount)
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`
}

function lineColorMap(blocks: GanttBlock[]): Map<string, string> {
  const lineIds = [...new Set(blocks.flatMap((b) =>
    b.blockTrips.filter((t) => t.trip.deadrunType == null).map((t) => t.trip.route!.line.id),
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
      const isDeadrun = bt.trip.deadrunType != null

      const baseColor = !isDeadrun && trip.route ? (colors.get(trip.route.line.id) ?? PALETTE[0]) : DEADHEAD_COLOR
      const segColor  = !isDeadrun && trip.route?.direction === 'INBOUND' ? lightenHex(baseColor) : baseColor

      segs.push({
        id:          bt.id,
        rowId:       row.id,
        startMinute: trip.departureMinutes,
        endMinute:   trip.arrivalMinutes,
        isDeadhead:  isDeadrun,
        label:       trip.route?.line.code ?? '',
        color:       isDeadrun ? DEADHEAD_COLOR : segColor,
        data:        bt,
      })
    }

    return segs
  },

  getRowLabel: (row) => row.label,
  segmentColor: (seg) => seg.color,
  editable: true,
}
