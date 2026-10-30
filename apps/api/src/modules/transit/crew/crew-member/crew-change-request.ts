import type { Prisma } from '@prisma/client'
import { restGroupIndex, restGroupLabel } from '@nyx/schemas'
import type { PrismaService } from '../../../../prisma/prisma.service'
import { localToday, toDbDate } from '../../timetabling/plan-validity'

// CrewChangeRequest — a crew member's lasting change (shift / rest group) asked in the portal and
// reviewed in the Painel de Escala. Shared by both: what he has now, when an open request is met,
// and the portal notices of each step.

type Db = PrismaService | Prisma.TransactionClient

export const OPEN_CHANGE = ['REQUESTED', 'QUEUED'] as const

export const changeRequestSelect = {
  id: true, crewMemberId: true, kind: true, status: true, shiftId: true, restPatternId: true, restOffset: true, fromShiftId: true, fromOffset: true,
  notes: true, reviewNotes: true, createdAt: true,
  shift: { select: { name: true } }, fromShift: { select: { name: true } }, restPattern: { select: { pattern: true, staggered: true } },
} as const
export type ChangeRequestRow = Prisma.CrewChangeRequestGetPayload<{ select: typeof changeRequestSelect }>

const patternSelect = { id: true, name: true, pattern: true, anchorDate: true, offOnHolidays: true, staggered: true } as const

export const restGroupName = (p: { pattern: string; staggered: boolean }, offset: number | null) => {
  const g = offset == null ? null : restGroupIndex(p, offset)
  return g == null ? 'Grupo avulso' : `Grupo ${restGroupLabel(g)}`
}

// "Manhã → Tarde", "Grupo A → Grupo B"
export function changeText(r: Pick<ChangeRequestRow, 'kind' | 'fromOffset' | 'restOffset' | 'shift' | 'fromShift' | 'restPattern'>): string {
  if (r.kind === 'SHIFT') return `${r.fromShift?.name ?? 'Sem turno'} → ${r.shift?.name ?? '?'}`
  return r.restPattern ? `${restGroupName(r.restPattern, r.fromOffset)} → ${restGroupName(r.restPattern, r.restOffset)}` : 'Grupo de folga'
}
const what = (r: Parameters<typeof changeText>[0]) => `${r.kind === 'SHIFT' ? 'troca de turno' : 'troca de grupo de folga'} (${changeText(r)})`

// what he has now: the open shift link and the rest pattern in force (his own, else the shift's)
export async function currentOf(db: Db, crewMemberIds: string[]) {
  const rows = await db.crewMember.findMany({
    where:  { id: { in: crewMemberIds } },
    select: {
      id: true, restOffset: true, restPattern: { select: patternSelect },
      shifts: { where: { validTo: null }, select: { shift: { select: { id: true, restPattern: { select: patternSelect } } } } },
    },
  })
  return new Map(rows.map(m => [m.id, {
    shiftId: m.shifts[0]?.shift.id ?? null,
    pattern: m.restPattern ?? m.shifts[0]?.shift.restPattern ?? null,
    offset:  m.restOffset,
  }]))
}

// the portal notices — CrewNotification of today, with no change log
export async function notifyChange(db: Db, list: { crewMemberId: string; message: string }[]): Promise<void> {
  if (!list.length) return
  const date = toDbDate(localToday())
  await db.crewNotification.createMany({ data: list.map(n => ({ ...n, date })) })
}

export const reviewMessage = (r: Parameters<typeof changeText>[0], decision: 'QUEUED' | 'REJECTED', notes: string | null) => (decision === 'QUEUED'
  ? `Seu pedido de ${what(r)} foi aprovado e está na fila — você será atendido quando abrir vaga.`
  : `Seu pedido de ${what(r)} foi recusado${notes ? `: ${notes}` : '.'}`)

// Open requests already met — his shift or group changed to the one asked, by whatever path — become
// FULFILLED (with the adjustment that did it, when one did) and he is told
export async function settleChangeRequests(db: Db, crewMemberIds: string[], adjustmentId: string | null = null): Promise<void> {
  const open = await db.crewChangeRequest.findMany({
    where:  { crewMemberId: { in: crewMemberIds }, status: { in: [...OPEN_CHANGE] } },
    select: changeRequestSelect,
  })
  if (!open.length) return
  const now = await currentOf(db, [...new Set(open.map(r => r.crewMemberId))])
  const met = open.filter(r => {
    const c = now.get(r.crewMemberId)
    if (!c) return false
    if (r.kind === 'SHIFT') return c.shiftId === r.shiftId
    return !!c.pattern && c.pattern.id === r.restPatternId && r.restOffset != null
      && restGroupIndex(c.pattern, c.offset) === restGroupIndex(c.pattern, r.restOffset)
  })
  if (!met.length) return
  await db.crewChangeRequest.updateMany({ where: { id: { in: met.map(r => r.id) } }, data: { status: 'FULFILLED', fulfilledAt: new Date(), adjustmentId } })
  await notifyChange(db, met.map(r => ({
    crewMemberId: r.crewMemberId,
    message: `Seu pedido de ${what(r)} foi atendido${r.kind === 'REST_GROUP' ? ' — vale a partir da próxima escala gerada.' : '.'}`,
  })))
}
