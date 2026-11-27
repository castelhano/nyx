import { z } from 'zod'

// Checks a vehicle block's sequence for modeling errors — things the vehicle can't physically do
// (leave the depot without an ACCESS, jump between places) or that look like a missing interval.
// Written to VehicleBlock.issues by VehiclePlanService.recalculate; only flags, never blocks —
// shown on the vehicle plan and on the crew plan, whose duties inherit them (a piece over an
// unmodeled stand counts as work, etc.).

export const VEHICLE_BLOCK_ISSUE_CODES = [
  'NO_COMPANY',            // no empresa (VehicleBlock.branchId) assigned
  'NO_START_ACCESS',       // the first movement doesn't leave the depot (ACCESS, or a trip from it)
  'NO_END_RETURN',         // the last movement doesn't reach the depot (RETURN, or a trip to it)
  'MISSING_ACCESS',        // after a RETURN, the vehicle moves again without an ACCESS
  'ACCESS_WITHOUT_RETURN', // an ACCESS mid-day whose previous movement isn't a RETURN
  'DEPOT_MISMATCH',        // ACCESS from / RETURN to a place other than the block's depot
  'CHAINED_DEADRUNS',      // two deadruns in a row (other than RETURN → ACCESS or a round trip A → B → A)
  'LOCATION_JUMP',         // a movement starts somewhere other than where the previous one ended
  'LONG_STAND',            // stands still longer than the default interval type's max, no interval
  'DEADRUN_TOO_SHORT',     // a deadrun faster than the travel matrix allows
  'STAND_NOT_ALLOWED',     // stands at least the interval threshold where the vehicle may not stand
  'OVERLAP',               // two events at the same time
  'BUNDLE_BROKEN',         // a trip group split across blocks, or another trip between its trips
  'LINE_NOT_OPERATED',     // a trip of a line the block's empresa doesn't operate (LineOperator)
] as const
export type VehicleBlockIssueCode = typeof VEHICLE_BLOCK_ISSUE_CODES[number]

export const VEHICLE_BLOCK_ISSUE_LABEL: Record<VehicleBlockIssueCode, string> = {
  NO_COMPANY:            'Bloco sem empresa',
  NO_START_ACCESS:       'Começa sem acesso',
  NO_END_RETURN:         'Termina sem recolhida',
  MISSING_ACCESS:        'Recolhe e volta a operar sem acesso',
  ACCESS_WITHOUT_RETURN: 'Acesso no meio do dia sem recolhida antes',
  DEPOT_MISMATCH:        'Acesso/recolhida em depósito diferente do do carro',
  CHAINED_DEADRUNS:      'Deslocamentos seguidos, sem viagem entre eles',
  LOCATION_JUMP:         'Parte de local diferente de onde o carro estava',
  LONG_STAND:            'Parado além do intervalo máximo, sem intervalo lançado',
  DEADRUN_TOO_SHORT:     'Ocioso mais rápido que a matriz de tempos',
  STAND_NOT_ALLOWED:     'Parado em ponto que não permite estacionar',
  OVERLAP:               'Eventos sobrepostos',
  BUNDLE_BROKEN:         'Grupo de viagens dividido ou intercalado',
  LINE_NOT_OPERATED:     'Viagem de linha não operada pela empresa do carro',
}

// 'info' issues are kept in VehicleBlock.issues and shown on the block, but are not pending:
// they don't set hasIssues nor count in the plan's pendências indicator
export const VEHICLE_BLOCK_ISSUE_SEVERITY: Partial<Record<VehicleBlockIssueCode, 'info'>> = {
  DEADRUN_TOO_SHORT: 'info',
}
export const isVehicleBlockIssuePending = (issue: { code: VehicleBlockIssueCode }) => VEHICLE_BLOCK_ISSUE_SEVERITY[issue.code] !== 'info'

export const vehicleBlockIssueSchema = z.object({
  code:    z.enum(VEHICLE_BLOCK_ISSUE_CODES),
  // when it happens: the event it points at, or the stand's start (LONG_STAND, STAND_NOT_ALLOWED)
  minutes: z.number(),
  // stand length (LONG_STAND, STAND_NOT_ALLOWED), minutes missing (DEADRUN_TOO_SHORT)
  value:   z.number().optional(),
})
export type VehicleBlockIssue = z.infer<typeof vehicleBlockIssueSchema>

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const duration = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`

// "12:19 — Parado além do intervalo máximo, sem intervalo lançado (3h23)",
// "16:21 — Ocioso mais rápido que a matriz de tempos (faltam 5 min)"
export function vehicleBlockIssueText(issue: VehicleBlockIssue): string {
  const value = issue.value == null ? '' : issue.code === 'DEADRUN_TOO_SHORT' ? ` (faltam ${issue.value} min)` : ` (${duration(issue.value)})`
  return `${clock(issue.minutes)} — ${VEHICLE_BLOCK_ISSUE_LABEL[issue.code]}${value}`
}

export interface BlockValidationInput {
  depotId:   string
  branchId:  string | null
  trips:     { departureMinutes: number; arrivalMinutes: number; originLocalityId: string; destinationLocalityId: string; bundleId?: string | null; lineId?: string; routeId?: string }[]
  deadruns:  { type: string; departureMinutes: number; arrivalMinutes: number; originLocalityId: string; destinationLocalityId: string; bundleId?: string | null }[]
  intervals: { departureMinutes: number; arrivalMinutes: number; bundleId?: string | null }[]
  // the default IntervalType's maxMinutes (general settings) — null skips LONG_STAND
  maxStandMinutes: number | null
  // members per group (trips, deadruns and intervals sharing a bundleId) in the whole plan —
  // absent skips BUNDLE_BROKEN
  bundleSizes?: Map<string, number>
  // lineId → branchIds operating it (LineOperator); a line absent or with none is operated by
  // any empresa — absent map skips LINE_NOT_OPERATED
  lineOperators?: Map<string, string[]>
  // minutes between two localities in the travel matrix, rounded as the plan editor builds its
  // deadruns — absent skips DEADRUN_TOO_SHORT
  travelMinutes?: (originId: string, destinationId: string) => number | undefined
  // a stop of minMinutes or more (the default interval type's min) stays only where the vehicle
  // may stand: the arriving trip's destination point or the next trip's origin point
  // (RouteLocality.allowsVehicleStand) — the vehicle solver's rule; absent skips STAND_NOT_ALLOWED
  stand?: { minMinutes: number; allowed: (routeId: string, localityId: string) => boolean }
}

type Move = { kind: string; departureMinutes: number; arrivalMinutes: number; originLocalityId: string; destinationLocalityId: string; routeId?: string }

export function validateBlock(input: BlockValidationInput): VehicleBlockIssue[] {
  const issues: VehicleBlockIssue[] = []
  const moves: Move[] = [
    ...input.trips.map(t => ({ kind: 'TRIP', ...t })),
    ...input.deadruns.map(d => ({ kind: d.type, ...d })),
  ].sort((a, b) => a.departureMinutes - b.departureMinutes || a.arrivalMinutes - b.arrivalMinutes)
  if (!moves.length) return issues

  // a trip whose terminal is the depot itself leaves/reaches it directly — it plays the role of
  // the ACCESS/RETURN, there's no deadrun to model
  const leavesDepot  = (m: Move) => m.kind === 'ACCESS' || (m.kind === 'TRIP' && m.originLocalityId === input.depotId)
  const reachesDepot = (m: Move) => m.kind === 'RETURN' || (m.kind === 'TRIP' && m.destinationLocalityId === input.depotId)

  const first = moves[0], last = moves[moves.length - 1]
  if (!input.branchId) issues.push({ code: 'NO_COMPANY', minutes: first.departureMinutes })
  if (!leavesDepot(first)) issues.push({ code: 'NO_START_ACCESS', minutes: first.departureMinutes })
  if (!reachesDepot(last)) issues.push({ code: 'NO_END_RETURN',   minutes: last.arrivalMinutes })

  for (const m of moves) {
    if ((m.kind === 'ACCESS' && m.originLocalityId !== input.depotId) || (m.kind === 'RETURN' && m.destinationLocalityId !== input.depotId)) {
      issues.push({ code: 'DEPOT_MISMATCH', minutes: m.departureMinutes })
    }
    const need = m.kind !== 'TRIP' && m.originLocalityId !== m.destinationLocalityId ? input.travelMinutes?.(m.originLocalityId, m.destinationLocalityId) : undefined
    const took = m.arrivalMinutes - m.departureMinutes
    if (need != null && took < need) issues.push({ code: 'DEADRUN_TOO_SHORT', minutes: m.departureMinutes, value: need - took })
  }

  for (let i = 1; i < moves.length; i++) {
    const prev = moves[i - 1], cur = moves[i]
    if (cur.departureMinutes < prev.arrivalMinutes) { issues.push({ code: 'OVERLAP', minutes: cur.departureMinutes }); continue }
    // parked at the depot in between: only a way out of it may follow (a different depot is DEPOT_MISMATCH)
    if (reachesDepot(prev)) {
      if (!leavesDepot(cur)) issues.push({ code: 'MISSING_ACCESS', minutes: cur.departureMinutes })
      continue
    }
    if (cur.kind === 'ACCESS') { issues.push({ code: 'ACCESS_WITHOUT_RETURN', minutes: cur.departureMinutes }); continue }
    // a round trip (A → B, then B → A) is a legit trip out to a point — relief, meal, fueling
    const roundTrip = cur.originLocalityId === prev.destinationLocalityId && cur.destinationLocalityId === prev.originLocalityId
    if (prev.kind !== 'TRIP' && cur.kind !== 'TRIP' && !roundTrip) issues.push({ code: 'CHAINED_DEADRUNS', minutes: cur.departureMinutes })
    if (cur.originLocalityId !== prev.destinationLocalityId) issues.push({ code: 'LOCATION_JUMP', minutes: cur.departureMinutes })
    const stand = cur.departureMinutes - prev.arrivalMinutes
    if (input.maxStandMinutes != null && stand > input.maxStandMinutes
      && !input.intervals.some(iv => iv.departureMinutes < cur.departureMinutes && iv.arrivalMinutes > prev.arrivalMinutes)) {
      issues.push({ code: 'LONG_STAND', minutes: prev.arrivalMinutes, value: stand })
    }
    if (input.stand && stand >= input.stand.minMinutes) {
      const allowed = (prev.kind === 'TRIP' && !!prev.routeId && input.stand.allowed(prev.routeId, prev.destinationLocalityId))
        || (cur.kind === 'TRIP' && !!cur.routeId && input.stand.allowed(cur.routeId, cur.originLocalityId))
      if (!allowed) issues.push({ code: 'STAND_NOT_ALLOWED', minutes: prev.arrivalMinutes, value: stand })
    }
  }
  if (input.lineOperators && input.branchId) {
    for (const t of input.trips) {
      const ops = t.lineId ? input.lineOperators.get(t.lineId) : undefined
      if (ops?.length && !ops.includes(input.branchId)) issues.push({ code: 'LINE_NOT_OPERATED', minutes: t.departureMinutes })
    }
  }
  if (input.bundleSizes) issues.push(...bundleIssues([...input.trips, ...input.deadruns, ...input.intervals], input.bundleSizes))
  for (const iv of input.intervals) {
    if (moves.some(m => m.departureMinutes < iv.arrivalMinutes && m.arrivalMinutes > iv.departureMinutes)) {
      issues.push({ code: 'OVERLAP', minutes: iv.departureMinutes })
    }
  }
  return issues.sort((a, b) => a.minutes - b.minutes)
}

// A group must sit whole in one block, its members one right after the other
function bundleIssues(events: { departureMinutes: number; arrivalMinutes: number; bundleId?: string | null }[], sizes: Map<string, number>): VehicleBlockIssue[] {
  const sorted = [...events].sort((a, b) => a.departureMinutes - b.departureMinutes || a.arrivalMinutes - b.arrivalMinutes)
  const at = new Map<string, number[]>()
  sorted.forEach((t, i) => { if (t.bundleId) at.set(t.bundleId, [...(at.get(t.bundleId) ?? []), i]) })
  const issues: VehicleBlockIssue[] = []
  for (const [bundleId, idx] of at) {
    const contiguous = idx[idx.length - 1] - idx[0] === idx.length - 1
    if (idx.length !== (sizes.get(bundleId) ?? idx.length) || !contiguous) {
      issues.push({ code: 'BUNDLE_BROKEN', minutes: sorted[idx[0]].departureMinutes })
    }
  }
  return issues
}
