// Data shaping for the "Viagens" running-schedule table (TripsTable.tsx) — an
// alternate view of the same VehiclePlanGanttData the Gantt reads, grouped by
// line then direction instead of by vehicle block. Columns are trip order,
// not clock time, so there's deliberately no time axis here (see
// TripsTable.tsx for why this isn't built on GanttEngine).

import {
  computeHeadway, DIRECTION_LABELS,
  type VehiclePlanGanttData, type GanttBlockTrip,
} from './vehicles.view'

const DIR_ORDER = ['OUTBOUND', 'INBOUND', 'CIRCULAR']

export interface TripCell {
  id:      string // GanttBlockTrip.id — unique across the whole plan
  dep:     number
  headway: number | null
}

export interface LineDirectionTrips {
  direction: string
  label:     string
  trips:     TripCell[]
}

export interface LineTripsGroup {
  lineId:     string
  lineCode:   string
  lineName:   string
  directions: LineDirectionTrips[]
}

/** Groups every trip across every block by line, then by direction, sorted by
 *  departure within each direction. Headway rows sandwich the first/last
 *  direction (matches the 2-direction Ida/Volta case exactly); a rare 3rd
 *  direction on the same line doesn't get its own dedicated headway row —
 *  not something the current route model exercises beyond OUTBOUND/INBOUND. */
export function groupTripsByLine(data: VehiclePlanGanttData): LineTripsGroup[] {
  const byLine = new Map<string, { code: string; name: string; byDir: Map<string, GanttBlockTrip[]> }>()

  for (const bt of data.blocks.flatMap((b) => b.blockTrips)) {
    const line = bt.trip.route.line
    let entry = byLine.get(line.id)
    if (!entry) {
      entry = { code: line.code, name: line.name, byDir: new Map() }
      byLine.set(line.id, entry)
    }
    const dir = bt.trip.route.direction
    if (!entry.byDir.has(dir)) entry.byDir.set(dir, [])
    entry.byDir.get(dir)!.push(bt)
  }

  return [...byLine.entries()]
    .sort((a, b) => a[1].code.localeCompare(b[1].code))
    .map(([lineId, entry]) => ({
      lineId,
      lineCode:   entry.code,
      lineName:   entry.name,
      directions: DIR_ORDER
        .filter((d) => entry.byDir.has(d))
        .map((dir) => {
          const trips = entry.byDir.get(dir)!
            .slice()
            .sort((a, b) => a.trip.departureMinutes - b.trip.departureMinutes)
          return {
            direction: dir,
            label:     DIRECTION_LABELS[dir] ?? dir,
            trips:     trips.map((bt) => ({
              id:      bt.id,
              dep:     bt.trip.departureMinutes,
              headway: computeHeadway(bt, data.blocks),
            })),
          }
        }),
    }))
}
