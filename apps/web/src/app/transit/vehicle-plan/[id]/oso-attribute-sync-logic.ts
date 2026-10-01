// Pure computation for keeping trip attributes in sync with the pinned OSO's
// LineDeparture rows (docs/proposal/plan_oso_attribute_sync_v1.md) — trips and
// departures matched by value (routeId + departureMinutes), same key as
// oso-coverage-logic.ts / apps/api's recomputeLineDrift.
//   - computeOsoAttributeSync: "Atualizar da OSO" (OSO → plano), the patches to stage
//   - findOsoPropagation:      Salvar (plano → OSO), which pending edits would be copied

import { sameMarkings, type TripMarking } from '@nyx/schemas'
import type { GanttBlock, VehiclePlanGanttData, VehicleType } from './views/vehicles.view'
import type { StopPattern, TripPatch } from './hooks/useGanttEditor'

export type OsoAttributePatch = Pick<TripPatch, 'requiredVehicleType' | 'stopPattern' | 'markings'>

export interface OsoDeparture {
  routeId:             string
  departureMinutes:    number
  requiredVehicleType: VehicleType | null
  stopPattern:         StopPattern
  markings:            TripMarking[] | null
}

export interface OsoLineDepartures {
  lineId:         string
  lineScheduleId: string
  approvalRef:    string
  status:         string
  departures:     OsoDeparture[]
}

export interface OsoAttributeSyncLine {
  lineId:      string
  approvalRef: string
  status:      string
  // trips with at least one attribute to update
  changedTrips: number
  byField:      { requiredVehicleType: number; stopPattern: number; markings: number }
  // trips of the line with no departure at the same routeId + departureMinutes
  unmatched:    number
}

function key(x: { routeId: string; departureMinutes: number }): string {
  return `${x.routeId}:${x.departureMinutes}`
}

/** `blocks` = the Gantt as rendered (pending edits included). `skipTripIds` = trips
 *  that can't take a TripPatch (pending adds, keyed by temp id). */
export function computeOsoAttributeSync(
  lines:       OsoLineDepartures[],
  blocks:      GanttBlock[],
  skipTripIds: Set<string>,
): { lines: OsoAttributeSyncLine[]; patches: Map<string, OsoAttributePatch> } {
  const patches = new Map<string, OsoAttributePatch>()
  const result: OsoAttributeSyncLine[] = []

  for (const line of lines) {
    const departureByKey = new Map(line.departures.map(d => [key(d), d]))
    const summary: OsoAttributeSyncLine = {
      lineId: line.lineId, approvalRef: line.approvalRef, status: line.status,
      changedTrips: 0, byField: { requiredVehicleType: 0, stopPattern: 0, markings: 0 }, unmatched: 0,
    }

    for (const block of blocks) {
      for (const { trip } of block.blockTrips) {
        if (trip.route.line.id !== line.lineId || skipTripIds.has(trip.id)) continue
        const d = departureByKey.get(key(trip))
        if (!d) { summary.unmatched++; continue }

        const patch: OsoAttributePatch = {}
        if ((trip.requiredVehicleType ?? null) !== (d.requiredVehicleType ?? null)) {
          patch.requiredVehicleType = d.requiredVehicleType ?? null
          summary.byField.requiredVehicleType++
        }
        if (trip.stopPattern !== d.stopPattern) {
          patch.stopPattern = d.stopPattern
          summary.byField.stopPattern++
        }
        if (!sameMarkings(trip.markings, d.markings)) {
          patch.markings = d.markings
          summary.byField.markings++
        }
        if (Object.keys(patch).length > 0) {
          patches.set(trip.id, patch)
          summary.changedTrips++
        }
      }
    }
    result.push(summary)
  }

  return { lines: result, patches }
}

export interface OsoPropagationLine {
  lineId:          string
  lineCode:        string
  approvalRef:     string
  status:          string
  sharedPlanCount: number
  trips:           number
}

/** Pending trip edits that saving with "replicar" would copy onto the OSO: a changed
 *  stopPattern/markings on a persisted trip whose time isn't changing too, on a line
 *  pinned to a DRAFT or APPROVED schedule — and not just a value "Atualizar da OSO"
 *  staged (`osoSyncedValues`), nor one equal to what the trip already has. */
export function findOsoPropagation(
  pendingChanges:  Map<string, TripPatch>,
  osoSyncedValues: Map<string, OsoAttributePatch>,
  ganttData:       VehiclePlanGanttData,
): { lines: OsoPropagationLine[]; tripIds: string[] } {
  const tripById = new Map(ganttData.blocks.flatMap(b => b.blockTrips.map(bt => [bt.trip.id, bt.trip] as const)))
  const lineById = new Map(ganttData.plan.lines.map(l => [l.lineId, l]))
  const tripsByLine = new Map<string, number>()
  const tripIds: string[] = []

  for (const [tripId, patch] of pendingChanges) {
    const trip = tripById.get(tripId)
    if (!trip || patch.departureMinutes !== undefined) continue
    const synced = osoSyncedValues.get(tripId)

    const stopPatternChanged = patch.stopPattern !== undefined
      && patch.stopPattern !== trip.stopPattern
      && patch.stopPattern !== synced?.stopPattern
    const markingsChanged = patch.markings !== undefined
      && !sameMarkings(patch.markings, trip.markings)
      && !(synced && 'markings' in synced && sameMarkings(patch.markings, synced.markings))
    if (!stopPatternChanged && !markingsChanged) continue

    const status = lineById.get(trip.route.line.id)?.lineSchedule?.status
    if (status !== 'DRAFT' && status !== 'APPROVED') continue
    tripsByLine.set(trip.route.line.id, (tripsByLine.get(trip.route.line.id) ?? 0) + 1)
    tripIds.push(tripId)
  }

  const lines = [...tripsByLine.entries()].map(([lineId, trips]) => {
    const line = lineById.get(lineId)!
    return {
      lineId,
      lineCode:        line.line.code,
      approvalRef:     line.lineSchedule!.approvalRef ?? '',
      status:          line.lineSchedule!.status,
      sharedPlanCount: line.sharedPlanCount,
      trips,
    }
  })
  return { lines, tripIds }
}
