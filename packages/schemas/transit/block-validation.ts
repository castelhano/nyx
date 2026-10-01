import { z } from 'zod'

// Checks a vehicle block's sequence for modeling errors — things the vehicle can't physically do
// (leave the depot without an ACCESS, jump between places) or that look like a missing interval.
// Written to VehicleBlock.issues by VehiclePlanService.recalculate; only flags, never blocks —
// shown on the vehicle plan and on the crew plan, whose duties inherit them (a piece over an
// unmodeled stand counts as work, etc.).

export const VEHICLE_BLOCK_ISSUE_CODES = [
  'NO_COMPANY',            // no empresa (VehicleBlock.branchId) assigned
  'NO_START_ACCESS',       // the first movement isn't an ACCESS
  'NO_END_RETURN',         // the last movement isn't a RETURN
  'MISSING_ACCESS',        // after a RETURN, the vehicle moves again without an ACCESS
  'ACCESS_WITHOUT_RETURN', // an ACCESS mid-day whose previous movement isn't a RETURN
  'DEPOT_MISMATCH',        // ACCESS from / RETURN to a place other than the block's depot
  'CHAINED_DEADRUNS',      // two deadruns in a row (other than RETURN → ACCESS or a round trip A → B → A)
  'LOCATION_JUMP',         // a movement starts somewhere other than where the previous one ended
  'LONG_STAND',            // stands still longer than the default interval type's max, no interval
  'OVERLAP',               // two events at the same time
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
  OVERLAP:               'Eventos sobrepostos',
}

export const vehicleBlockIssueSchema = z.object({
  code:    z.enum(VEHICLE_BLOCK_ISSUE_CODES),
  // when it happens: the event it points at, or the stand's start (LONG_STAND)
  minutes: z.number(),
  // stand length (LONG_STAND)
  value:   z.number().optional(),
})
export type VehicleBlockIssue = z.infer<typeof vehicleBlockIssueSchema>

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const duration = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`

// "12:19 — Parado além do intervalo máximo, sem intervalo lançado (3h23)"
export function vehicleBlockIssueText(issue: VehicleBlockIssue): string {
  return `${clock(issue.minutes)} — ${VEHICLE_BLOCK_ISSUE_LABEL[issue.code]}${issue.value != null ? ` (${duration(issue.value)})` : ''}`
}

export interface BlockValidationInput {
  depotId:   string
  branchId:  string | null
  trips:     { departureMinutes: number; arrivalMinutes: number; originLocalityId: string; destinationLocalityId: string }[]
  deadruns:  { type: string; departureMinutes: number; arrivalMinutes: number; originLocalityId: string; destinationLocalityId: string }[]
  intervals: { departureMinutes: number; arrivalMinutes: number }[]
  // the default IntervalType's maxMinutes (general settings) — null skips LONG_STAND
  maxStandMinutes: number | null
}

type Move = { kind: string; departureMinutes: number; arrivalMinutes: number; originLocalityId: string; destinationLocalityId: string }

export function validateBlock(input: BlockValidationInput): VehicleBlockIssue[] {
  const issues: VehicleBlockIssue[] = []
  const moves: Move[] = [
    ...input.trips.map(t => ({ kind: 'TRIP', ...t })),
    ...input.deadruns.map(d => ({ kind: d.type, ...d })),
  ].sort((a, b) => a.departureMinutes - b.departureMinutes || a.arrivalMinutes - b.arrivalMinutes)
  if (!moves.length) return issues

  const first = moves[0], last = moves[moves.length - 1]
  if (!input.branchId) issues.push({ code: 'NO_COMPANY', minutes: first.departureMinutes })
  if (first.kind !== 'ACCESS') issues.push({ code: 'NO_START_ACCESS', minutes: first.departureMinutes })
  if (last.kind !== 'RETURN')  issues.push({ code: 'NO_END_RETURN',   minutes: last.arrivalMinutes })

  for (const m of moves) {
    if ((m.kind === 'ACCESS' && m.originLocalityId !== input.depotId) || (m.kind === 'RETURN' && m.destinationLocalityId !== input.depotId)) {
      issues.push({ code: 'DEPOT_MISMATCH', minutes: m.departureMinutes })
    }
  }

  for (let i = 1; i < moves.length; i++) {
    const prev = moves[i - 1], cur = moves[i]
    if (cur.departureMinutes < prev.arrivalMinutes) { issues.push({ code: 'OVERLAP', minutes: cur.departureMinutes }); continue }
    // parked at the depot in between: only an ACCESS may follow (a different depot is DEPOT_MISMATCH)
    if (prev.kind === 'RETURN') {
      if (cur.kind !== 'ACCESS') issues.push({ code: 'MISSING_ACCESS', minutes: cur.departureMinutes })
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
  }
  for (const iv of input.intervals) {
    if (moves.some(m => m.departureMinutes < iv.arrivalMinutes && m.arrivalMinutes > iv.departureMinutes)) {
      issues.push({ code: 'OVERLAP', minutes: iv.departureMinutes })
    }
  }
  return issues.sort((a, b) => a.minutes - b.minutes)
}
