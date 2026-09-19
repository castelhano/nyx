// Attributes a VehicleBlock's idle (deadrun) km to the lines it serves that day —
// needed because BlockDeadrun has no lineId (it belongs to the block as a whole),
// but a block can legitimately serve more than one line (aproveitamento). Rule
// (docs/proposal/plan_dop_v1.md, "Percentual de ociosidade"):
//
//   ACCESS/RETURN  — proportional to each line's share of the block's productive
//                    km. They're the cost of positioning the vehicle for the block
//                    as a whole (garage -> first trip / last trip -> garage), not
//                    any single trip.
//   DISPLACEMENT   — 100% to the line of the two trips it connects when they're
//                    the same line, 50/50 when they differ. The connected trips
//                    are found via the same anchor rule as
//                    block-deadrun.utils.ts's findDeadrunIdsAnchoredToTrips
//                    (nearest preceding trip: latest arrival <= the deadrun's
//                    departure) — its immediate successor by departure order is
//                    the "next" trip. Not matched by exact time equality: deadrun
//                    timing can be offset by a minute or more from the adjacent
//                    trip (see useGanttEditor.ts's buildFakeAccessReturn).

export interface IdleTripInput {
  lineId:           string
  departureMinutes: number
  arrivalMinutes:   number
}

export interface IdleDeadrunInput {
  type:             'ACCESS' | 'RETURN' | 'DISPLACEMENT'
  departureMinutes: number
  km:               number
}

export function attributeIdleKmByLine(
  trips:              IdleTripInput[],
  deadruns:           IdleDeadrunInput[],
  productiveKmByLine: Map<string, number>,
): Map<string, number> {
  const idleByLine = new Map<string, number>()
  const add = (lineId: string, km: number) => idleByLine.set(lineId, (idleByLine.get(lineId) ?? 0) + km)

  const totalProductive = Array.from(productiveKmByLine.values()).reduce((s, v) => s + v, 0)
  const byDeparture      = trips.slice().sort((a, b) => a.departureMinutes - b.departureMinutes)

  for (const dr of deadruns) {
    if (dr.km <= 0) continue

    if (dr.type === 'ACCESS' || dr.type === 'RETURN') {
      if (totalProductive <= 0) continue
      for (const [lineId, km] of productiveKmByLine) add(lineId, dr.km * (km / totalProductive))
      continue
    }

    let precedingIdx = -1
    for (let i = 0; i < byDeparture.length; i++) {
      if (byDeparture[i].arrivalMinutes <= dr.departureMinutes) precedingIdx = i
      else break
    }
    const beforeLine = precedingIdx >= 0 ? byDeparture[precedingIdx].lineId : null
    const afterLine  = precedingIdx >= 0 && precedingIdx + 1 < byDeparture.length
      ? byDeparture[precedingIdx + 1].lineId
      : null

    if (beforeLine && afterLine && beforeLine !== afterLine) {
      add(beforeLine, dr.km / 2)
      add(afterLine,  dr.km / 2)
    } else if (beforeLine) {
      add(beforeLine, dr.km)
    } else if (afterLine) {
      add(afterLine, dr.km)
    }
  }

  return idleByLine
}
