import { z } from 'zod'
import type { PortalPermissions, PortalQuotaPeriod } from './portal-profile.schema'

// The crew portal's API (/api/portal/*) — the crew member logs in with his matrícula and a 6-digit
// PIN; what he may do there comes from his portal profile (portal-profile.schema.ts).

const pin = z.string().regex(/^\d{6}$/, 'O PIN tem 6 dígitos')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

export const portalLoginSchema = z.object({
  code: z.string().trim().min(1, 'Informe a matrícula'),
  pin,
})
export type PortalLoginDto = z.infer<typeof portalLoginSchema>

// A PIN anyone would try first: one digit repeated (777777), a run (123456, 987654, 890123), a
// repeated pair or triple (121212, 123123), a mirror (123321) or a doubled run (112233). The
// personal ones (CPF, birth date, matrícula) are checked by the API, which has the data.
export function weakPinReason(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return null
  const d = [...pin].map(Number)
  const steps = d.slice(1).map((x, i) => (x - d[i] + 10) % 10)
  const isRun = (s: number[]) => s.every(x => x === 1) || s.every(x => x === 9)
  if (steps.every(s => s === 0)) return 'O PIN não pode ser um único número repetido'
  if (isRun(steps)) return 'O PIN não pode ser uma sequência'
  if (pin === pin.slice(0, 2).repeat(3) || pin === pin.slice(0, 3).repeat(2)) return 'O PIN não pode repetir um mesmo grupo de números'
  if (pin === [...pin].reverse().join('')) return 'O PIN não pode ser espelhado'
  if (d[0] === d[1] && d[2] === d[3] && d[4] === d[5] && isRun([(d[2] - d[0] + 10) % 10, (d[4] - d[2] + 10) % 10])) return 'O PIN não pode ser uma sequência'
  return null
}

export const portalChangePinSchema = z.object({ current: pin, next: pin })
  .refine(p => p.next !== p.current, { message: 'O PIN novo deve ser diferente do atual', path: ['next'] })
  .superRefine((p, ctx) => {
    const weak = weakPinReason(p.next)
    if (weak) ctx.addIssue({ code: 'custom', message: weak, path: ['next'] })
  })
export type PortalChangePinDto = z.infer<typeof portalChangePinSchema>

// a request is always one day
export const portalRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ABSENCE'), date: day, absenceTypeId: z.uuid('Informe o motivo'), notes: z.string().max(500).optional() }),
  z.object({
    kind: z.literal('TIME_WINDOW'), date: day,
    // minutes of the operational day — "começar depois de" / "parar até"
    startNotBefore: z.number().int().min(0).max(2880).nullable().default(null),
    endNotAfter:    z.number().int().min(0).max(2880).nullable().default(null),
    notes: z.string().max(500).optional(),
  }).refine(r => r.startNotBefore != null || r.endNotAfter != null, { message: 'Informe o horário', path: ['endNotAfter'] }),
])
export type PortalRequestDto = z.infer<typeof portalRequestSchema>

// a lasting change, with no date — CrewChangeRequest in transit.prisma
export const portalChangeRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SHIFT'), shiftId: z.uuid('Informe o turno'), notes: z.string().max(500).optional() }),
  z.object({ kind: z.literal('REST_GROUP'), restOffset: z.number().int().min(0), notes: z.string().max(500).optional() }),
])
export type PortalChangeRequestDto = z.infer<typeof portalChangeRequestSchema>

export type CrewChangeRequestKind = 'SHIFT' | 'REST_GROUP'
export type CrewChangeRequestStatus = 'REQUESTED' | 'QUEUED' | 'FULFILLED' | 'REJECTED' | 'CANCELLED'

export interface PortalChangeRequest {
  id:          string
  kind:        CrewChangeRequestKind
  status:      CrewChangeRequestStatus
  // "Manhã → Tarde", "Grupo A → Grupo B"
  change:      string
  notes:       string | null
  reviewNotes: string | null
  createdAt:   string
  // QUEUED: his place among the queued asking the same (1 = next)
  position:    number | null
}

// a rest group and its days off in the preview weeks
export interface PortalRestGroupOption {
  offset:  number
  label:   string
  current: boolean
  // the preview days he is off (YYYY-MM-DD)
  off:     string[]
}

export interface PortalChangeOptions {
  shifts: { id: string; name: string; current: boolean }[]
  // his rest pattern's groups — null: no pattern, or a single group
  restGroups: { patternName: string; from: string; to: string; options: PortalRestGroupOption[] } | null
}

// his phone — typed with or without the mask, kept masked like the HR screen keeps it
export const portalPhoneSchema = z.object({
  phone: z.string().transform(v => v.replace(/\D/g, ''))
    .refine(d => d.length === 10 || d.length === 11, 'Informe o telefone com DDD')
    .transform(d => d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`),
})

export const portalLinesSchema = z.object({
  // preferred lines in order (1st = primary)
  preferred: z.array(z.uuid()),
})

export interface PortalLoginResult { token: string; mustChangePin: boolean }

// a request quota and how much of it is used in the period holding the date asked
export interface PortalQuotaBalance {
  // "Folga solicitada", "Restrição de horário"
  label:  string
  kind:   'ABSENCE' | 'TIME_WINDOW'
  absenceTypeId: string | null
  period: PortalQuotaPeriod
  from:   string
  to:     string
  used:   number
  max:    number
}

export interface PortalMe {
  crewMemberId: string
  code:         string
  name:         string
  branch:       string
  phone:        string | null
  mustChangePin: boolean
  permissions:  PortalPermissions
  unread:       number
  // preferred lines still to pick before the portal opens (REQUIRED mode) — 0: none
  linesMissing: number
  // the types he may ask for (requestable)
  absenceTypes: { id: string; name: string }[]
}

export interface PortalRosterDay {
  date: string
  // what he has: a duty, a plantão, a day off, an absence — null: nothing published
  kind: 'DUTY' | 'STANDBY' | 'DAY_OFF' | 'COMP_OFF' | 'ABSENCE' | null
  duty: { label: string; start: number | null; end: number | null; lines: string[]; vehicles: string[] } | null
  // the day off / absence reason
  reason: string | null
  // a time window in force on the day: "até 18:00"
  window: string | null
}

// roster: a change of a published day (from the change log) — else a notice like a change request's step
export interface PortalNotification { id: string; date: string; message: string; roster: boolean; createdAt: string; readAt: string | null }

export interface PortalOccurrence {
  id: string
  kind: 'ABSENCE' | 'TIME_WINDOW'
  startDate: string
  endDate: string
  reason: string | null
  startNotBefore: number | null
  endNotAfter: number | null
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  origin: 'PORTAL' | 'STAFF_ON_BEHALF' | 'STAFF'
  reviewNotes: string | null
}

export interface PortalLines {
  // his slots — the empresa's maximum less the one his plantão preference takes
  maxPreferredLines: number
  editable: boolean
  // how many he must keep picked (REQUIRED mode, capped by the lines he may pick) — 0: optional
  required: number
  // the lines he may operate; rank: his preference; priority: the empresa's (read only)
  lines: { id: string; code: string; name: string; rank: number | null; priority: boolean }[]
}
