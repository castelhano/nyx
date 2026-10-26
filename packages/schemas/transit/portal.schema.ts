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

export const portalChangePinSchema = z.object({ current: pin, next: pin })
  .refine(p => p.next !== p.current, { message: 'O PIN novo deve ser diferente do atual', path: ['next'] })
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

export interface PortalNotification { id: string; date: string; message: string; createdAt: string; readAt: string | null }

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
