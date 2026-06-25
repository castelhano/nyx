import type { GanttView, GanttRow, GanttSegment } from '../engine/gantt.types'
import type { VehicleBlockSummary } from '@nyx/schemas'

// ── API shapes ────────────────────────────────────────────────────────────────

export interface TripConstraints {
  locked?: string[]
}

export interface CycleWindow {
  from:            number
  to:              number
  minutes:         number
  intervalMinutes: number
}

export interface LineMetrics {
  extensionKm?: Record<string, number>
  windows?:     Record<string, CycleWindow[]>
}

/** Returns the full cycle window for a trip given the line metrics, direction,
 *  and departure time. Falls back to OUTBOUND when direction has no windows. */
export function resolveCycleWindow(
  metrics:          LineMetrics | null | undefined,
  direction:        string,
  departureMinutes: number,
): CycleWindow | null {
  if (!metrics?.windows) return null
  const windows = metrics.windows[direction] ?? metrics.windows['OUTBOUND'] ?? []
  const hour    = Math.floor(departureMinutes / 60) % 24
  return windows.find(w => hour >= w.from && hour <= w.to) ?? null
}

export function resolveCycleMinutes(
  metrics:          LineMetrics | null | undefined,
  direction:        string,
  departureMinutes: number,
): number | null {
  return resolveCycleWindow(metrics, direction, departureMinutes)?.minutes ?? null
}

export interface GanttBlockTrip {
  id:       string
  sequence: number
  trip: {
    id:               string
    departureMinutes: number
    arrivalMinutes:   number
    constraints:      TripConstraints | null
    route: {
      direction:           string
      line:                { id: string; code: string; name: string; metrics: LineMetrics | null }
      originLocality:      { id: string; name: string }
      destinationLocality: { id: string; name: string }
    }
  }
}

export interface GanttBlockDeadrun {
  id:                    string
  type:                  'ACCESS' | 'RETURN' | 'DISPLACEMENT'
  originLocalityId:      string
  destinationLocalityId: string
  originLocality:        { id: string; name: string }
  destinationLocality:   { id: string; name: string }
  departureMinutes:      number
  arrivalMinutes:        number
}

export interface GanttBlock {
  id:            string
  blockNumber:   number
  vehicleType:   string
  branchId:      string | null
  branch:        { id: string; name: string } | null
  depotId:       string
  depot:         { id: string; name: string }
  constraints:   { locked?: true } | null
  summary:       VehicleBlockSummary | null
  blockTrips:    GanttBlockTrip[]
  blockDeadruns: GanttBlockDeadrun[]
}

export interface VehiclePlanGanttData {
  plan: {
    id:      string
    status:  string
    summary: unknown
    dayType: { id: string; name: string; code: string } | null
    lines:   Array<{ lineId: string; line: { id: string; code: string; name: string; metrics: LineMetrics | null } }>
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
  const lineIds = [...new Set(blocks.flatMap(b => b.blockTrips.map(bt => bt.trip.route.line.id)))]
  const map = new Map<string, string>()
  lineIds.forEach((id, i) => map.set(id, PALETTE[i % PALETTE.length]))
  return map
}

// ── view definition ───────────────────────────────────────────────────────────

let _colorCacheBlocks: GanttBlock[] | null = null
let _colorCacheMap:    Map<string, string> | null = null

export const vehiclesView: GanttView<VehiclePlanGanttData> = {
  getRows(data): GanttRow[] {
    return data.blocks.map((b) => ({
      id:    b.id,
      label: `Bloco ${b.blockNumber}`,
      data:  b,
    }))
  },

  getSegments(row, data): GanttSegment[] {
    const block = row.data as GanttBlock
    if (_colorCacheBlocks !== data.blocks) {
      _colorCacheBlocks = data.blocks
      _colorCacheMap    = lineColorMap(data.blocks)
    }
    const colors = _colorCacheMap!
    const segs: GanttSegment[] = []

    for (const bt of block.blockTrips) {
      const baseColor = colors.get(bt.trip.route.line.id) ?? PALETTE[0]
      const segColor  = bt.trip.route.direction === 'INBOUND' ? lightenHex(baseColor) : baseColor
      const c = bt.trip.constraints
      segs.push({
        id:          bt.id,
        rowId:       row.id,
        startMinute: bt.trip.departureMinutes,
        endMinute:   bt.trip.arrivalMinutes,
        isDeadhead:  false,
        locked:      (c?.locked?.length ?? 0) > 0,
        label:       bt.trip.route.line.code,
        color:       segColor,
        data:        bt,
      })
    }

    for (const d of block.blockDeadruns) {
      segs.push({
        id:          `${d.id}:dr`,
        rowId:       row.id,
        startMinute: d.departureMinutes,
        endMinute:   d.arrivalMinutes,
        isDeadhead:  true,
        label:       '',
        color:       DEADHEAD_COLOR,
        data:        d,
      })
    }

    return segs
  },

  getRowLabel: (row) => row.label,
  segmentColor: (seg) => seg.color,
  editable: true,
}
