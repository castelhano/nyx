// Pure computation for "trocar OSO" (line-schedule switch) inside a VehiclePlan's
// Gantt — mirrors line-generator-logic.ts's separation (logic here, UI in
// SwitchLineScheduleModal.tsx). Unlike the schedule generator, trips here aren't
// generated from frequency windows: they come 1:1 from the target LineSchedule's
// approved LineDeparture rows, so departureMinutes is fixed and only
// arrivalMinutes/block placement need computing.

import { resolveCycleMinutes, type LineMetrics } from './views/vehicles.view'
import { getTravelTime } from './travel-time'
import { assignFixedTripsToBlocks, type FixedTripCandidate } from './line-generator-logic'

export interface LineDepartureForSwitch {
  id:                   string
  routeId:              string
  departureMinutes:     number
  requiredVehicleType?: string | null
  route: {
    direction:             string
    originLocalityId:      string
    destinationLocalityId: string
  }
}

export interface ScheduleSwitchTrip extends FixedTripCandidate {
  lineDepartureId: string
}

export interface ScheduleSwitchResult {
  blocks:   ScheduleSwitchTrip[][]
  warnings: string[]
}

/** Resolves arrivalMinutes for every departure of the target schedule — cycle time
 *  from TransitLine.metrics.windows first, travel-time matrix as fallback — then
 *  packs them into blocks with assignFixedTripsToBlocks. A departure with neither
 *  cycle nor matrix data gets a warning and is skipped (can't safely place a trip
 *  whose duration is unknown). */
export async function computeScheduleSwitch(
  departures:  LineDepartureForSwitch[],
  metrics:     LineMetrics | null | undefined,
  dayTypeCode: string,
): Promise<ScheduleSwitchResult> {
  const warnings:   string[]           = []
  const candidates: ScheduleSwitchTrip[] = []

  for (const d of departures) {
    const cycleMinutes = resolveCycleMinutes(metrics, dayTypeCode, d.route.direction, d.departureMinutes)
    const minutes       = cycleMinutes ?? await getTravelTime(d.route.originLocalityId, d.route.destinationLocalityId)
    if (minutes == null) {
      warnings.push(`Sem dado de ciclo/tempo de viagem para a partida de ${d.departureMinutes}min`)
      continue
    }
    candidates.push({
      _tempId:             crypto.randomUUID(),
      lineDepartureId:     d.id,
      routeId:             d.routeId,
      departureMinutes:    d.departureMinutes,
      arrivalMinutes:      d.departureMinutes + Math.round(minutes),
      requiredVehicleType: d.requiredVehicleType ?? undefined,
    })
  }

  return { blocks: assignFixedTripsToBlocks(candidates), warnings }
}
