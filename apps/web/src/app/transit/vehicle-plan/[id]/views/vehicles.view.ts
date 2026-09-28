import type { GanttView, GanttRow, GanttSegment } from '../engine/gantt.types'
import type { VehicleBlockSummary, VehiclePlanLineSummary, TripMarking, VehicleBlockIssue } from '@nyx/schemas'
import { swatchColor, lineIndexByCode } from '@/lib/palette'

// ── API shapes ────────────────────────────────────────────────────────────────

export interface TripConstraints {
  locked?: string[]
}

export interface CycleWindow {
  from:            number
  to:              number
  minutes:         number
  intervalMinutes: number
  isDerived?:      boolean
}

export interface LineMetrics {
  extensionKm?: Record<string, number>
  // keyed by dayTypeCode first (see LineService.applyWindows / cycle-map) — then by direction
  windows?:     Record<string, Record<string, CycleWindow[]>>
}

/** Returns the full cycle window for a trip given the line metrics, dayType,
 *  direction, and departure time. Falls back to 'U' (dia útil) when the given
 *  dayType has no cycle data imported yet, then to OUTBOUND when direction has
 *  no windows. `to` marks the last half-hour slot included (whole hour → +0.5,
 *  truncated by a 30min sub-cut → bare hour), so departure time is compared at
 *  the same half-hour resolution rather than truncated to the hour. */
export function resolveCycleWindow(
  metrics:          LineMetrics | null | undefined,
  dayTypeCode:      string,
  direction:        string,
  departureMinutes: number,
): CycleWindow | null {
  const forDayType = metrics?.windows?.[dayTypeCode] ?? metrics?.windows?.['U']
  if (!forDayType) return null
  const windows = forDayType[direction] ?? forDayType['OUTBOUND'] ?? []
  const slot    = Math.floor(departureMinutes / 30) / 2 % 24
  return windows.find(w => slot >= w.from && slot <= w.to) ?? null
}

export function resolveCycleMinutes(
  metrics:          LineMetrics | null | undefined,
  dayTypeCode:      string,
  direction:        string,
  departureMinutes: number,
): number | null {
  return resolveCycleWindow(metrics, dayTypeCode, direction, departureMinutes)?.minutes ?? null
}

export const DIRECTION_LABELS: Record<string, string> = {
  OUTBOUND: 'IDA',
  INBOUND:  'VOLTA',
  CIRCULAR: 'CIRC',
}

/** Minutes since the previous departure of the same line+direction across all blocks. */
export function computeHeadway(bt: GanttBlockTrip, blocks: GanttBlock[]): number | null {
  const lineId = bt.trip.route.line.id
  const dir    = bt.trip.route.direction

  const departures = blocks
    .flatMap(b => b.blockTrips)
    .filter(t => t.trip.route?.line.id === lineId && t.trip.route.direction === dir)
    .map(t => t.trip.departureMinutes)
    .sort((a, b) => a - b)

  const dep = bt.trip.departureMinutes
  const idx = departures.indexOf(dep)
  if (idx <= 0 || departures.length < 2) return null

  return dep - departures[idx - 1]
}

export interface GanttBlockTrip {
  id:       string
  sequence: number
  trip: {
    id:               string
    routeId:          string
    departureMinutes: number
    arrivalMinutes:   number
    constraints:      TripConstraints | null
    markings:         TripMarking[] | null
    notes:            string | null
    stopPattern:      'LOCAL' | 'LIMITED' | 'EXPRESS'
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

export interface GanttIntervalType {
  id:         string
  code:       string
  name:       string
  isPaid:     boolean
  minMinutes: number | null
  maxMinutes: number | null
}

export interface GanttBlockInterval {
  id:               string
  intervalTypeId:   string
  intervalType:     GanttIntervalType
  departureMinutes: number
  arrivalMinutes:   number
}

export interface GanttBlock {
  id:             string
  blockNumber:    number
  vehicleType:    string
  branchId:       string | null
  branch:         { id: string; name: string } | null
  depotId:        string
  depot:          { id: string; name: string }
  constraints:    { locked?: true } | null
  summary:        VehicleBlockSummary | null
  // modeling errors (block-validation.ts) as of the last save — absent on unsaved blocks
  issues?:        VehicleBlockIssue[] | null
  hasIssues?:     boolean
  blockTrips:     GanttBlockTrip[]
  blockDeadruns:  GanttBlockDeadrun[]
  blockIntervals: GanttBlockInterval[]
}

// Irregularidade é sempre informativa (nunca bloqueia) — ver
// docs/proposal/vehicle-plan-block-intervals.md §5.3.
export function computeIntervalIrregularity(
  bi: GanttBlockInterval,
): { severity: 'over' | 'under'; excessFromMinute?: number } | null {
  const { minMinutes, maxMinutes } = bi.intervalType
  const duration = bi.arrivalMinutes - bi.departureMinutes
  if (maxMinutes != null && duration > maxMinutes) {
    return { severity: 'over', excessFromMinute: bi.departureMinutes + maxMinutes }
  }
  if (minMinutes != null && duration < minMinutes) {
    return { severity: 'under' }
  }
  return null
}

export interface VehiclePlanGanttData {
  plan: {
    id:      string
    status:  string
    summary: unknown
    dayType: { id: string; name: string; code: string } | null
    lines:   Array<{
      lineId:         string
      inPlan:         boolean
      lineScheduleId: string | null
      isDrifted:      boolean
      summary:      VehiclePlanLineSummary | null
      line:         { id: string; code: string; name: string; metrics: LineMetrics | null }
      lineSchedule: { id: string; status: string; approvalRef: string | null } | null
    }>
  }
  blocks: GanttBlock[]
  // Trip ids whose {routeId, departureMinutes} don't match any LineDeparture of
  // their line's pinned OSO — only populated for lines currently isDrifted (see
  // useOsoCoverage). Optional: absent while the coverage fetch hasn't resolved yet.
  offScheduleTripIds?: Set<string>
}

// ── color palette ─────────────────────────────────────────────────────────────

const DEADHEAD_COLOR = '#d1d5db'
const BREAK_COLOR    = '#64748b'

// Line colors come from the shared muted palette (lib/palette.ts), indexed by the line's
// code order among all of the Scope's lines — stable across line selection/filters and the
// same color the crew plan screen uses. Outbound = strong tone, inbound = lighter (mid).
interface LineColor { out: string; outDark: string; in: string; inDark: string }

function lineColorMap(plan: VehiclePlanGanttData['plan']): Map<string, LineColor> {
  const indexByCode = lineIndexByCode(plan.lines.map(l => l.line.code))
  return new Map(plan.lines.map(l => {
    const i = indexByCode.get(l.line.code) ?? 0
    return [l.lineId, {
      out: swatchColor(i, 'strong', 'light'), outDark: swatchColor(i, 'strong', 'dark'),
      in:  swatchColor(i, 'mid',    'light'), inDark:  swatchColor(i, 'mid',    'dark'),
    }]
  }))
}

// ── view definition ───────────────────────────────────────────────────────────

let _colorCachePlan: VehiclePlanGanttData['plan'] | null = null
let _colorCacheMap:  Map<string, LineColor> | null = null

export const vehiclesView: GanttView<VehiclePlanGanttData> = {
  getRows(data): GanttRow[] {
    // "Carro N" (position in the currently displayed set, 1-based) instead of
    // the raw blockNumber — blockNumber is a global identifier across the
    // whole plan (e.g. 99, 100…) and means nothing to the end user once a
    // line/time filter narrows the view down to a handful of vehicles. The
    // real blockNumber is still shown as a badge in BlockDetailPopover.
    // data.blocks arrives blockNumber-ascending (API orderBy), so this stays
    // a stable, sensible sequence even as the filtered set changes.
    return data.blocks.map((b, i) => ({
      id:    b.id,
      label: `Carro ${String(i + 1).padStart(2, '0')}`,
      data:  b,
    }))
  },

  getSegments(row, data): GanttSegment[] {
    const block = row.data as GanttBlock
    if (_colorCachePlan !== data.plan) {
      _colorCachePlan = data.plan
      _colorCacheMap  = lineColorMap(data.plan)
    }
    const colors = _colorCacheMap!
    const segs: GanttSegment[] = []

    for (const bt of block.blockTrips) {
      const lineColor = colors.get(bt.trip.route.line.id)
      const inbound   = bt.trip.route.direction === 'INBOUND'
      const segColor  = lineColor ? (inbound ? lineColor.in : lineColor.out) : swatchColor(0, inbound ? 'mid' : 'strong', 'light')
      const segDark   = lineColor ? (inbound ? lineColor.inDark : lineColor.outDark) : swatchColor(0, inbound ? 'mid' : 'strong', 'dark')
      const c = bt.trip.constraints
      segs.push({
        id:          bt.id,
        rowId:       row.id,
        startMinute: bt.trip.departureMinutes,
        endMinute:   bt.trip.arrivalMinutes,
        kind:        'trip',
        locked:      (c?.locked?.length ?? 0) > 0,
        offSchedule: data.offScheduleTripIds?.has(bt.trip.id) ?? false,
        marked:      (bt.trip.markings?.length ?? 0) > 0,
        stopPattern: bt.trip.stopPattern,
        label:       bt.trip.route.line.code,
        color:       segColor,
        colorDark:   segDark,
        data:        bt,
      })
    }

    for (const d of block.blockDeadruns) {
      segs.push({
        id:          `${d.id}:dr`,
        rowId:       row.id,
        startMinute: d.departureMinutes,
        endMinute:   d.arrivalMinutes,
        kind:        'deadhead',
        label:       '',
        color:       DEADHEAD_COLOR,
        data:        d,
      })
    }

    for (const bi of block.blockIntervals) {
      segs.push({
        id:          `${bi.id}:bk`,
        rowId:       row.id,
        startMinute: bi.departureMinutes,
        endMinute:   bi.arrivalMinutes,
        kind:        'break',
        label:       `${bi.arrivalMinutes - bi.departureMinutes}'`,
        color:       BREAK_COLOR,
        shape:       'pill',
        fillStyle:   bi.intervalType.isPaid ? 'solid' : 'outline',
        irregular:   computeIntervalIrregularity(bi),
        data:        bi,
      })
    }

    return segs
  },

  getRowLabel: (row) => row.label,
  segmentColor: (seg) => seg.color,
  editable: true,
}
