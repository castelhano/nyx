import { formatDutyNumber } from '@nyx/schemas'
import type { PrismaService } from '../../../prisma/prisma.service'
import { dayOf } from '../timetabling/plan-validity'

// The crew member's notifications come from the PUBLISHED days' DailyChangeLog: the ones naming
// him since his portal access was created become CrewNotifications the first time the portal
// reads them (whoever wrote the log — the day's edits, the generator, a repair, the férias).

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

type Log = { id: string; action: string; entityType: string; entityId: string; before: unknown; after: unknown; operation: { date: Date } }

export async function syncNotifications(prisma: PrismaService, crewMemberId: string, since: Date): Promise<void> {
  const logs = await prisma.dailyChangeLog.findMany({
    where:  { crewMemberIds: { has: crewMemberId }, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, action: true, entityType: true, entityId: true, before: true, after: true, operation: { select: { date: true } } },
  })
  if (!logs.length) return
  const known = new Set((await prisma.crewNotification.findMany({
    where:  { crewMemberId, changeLogId: { in: logs.map(l => l.id) } },
    select: { changeLogId: true },
  })).map(n => n.changeLogId))
  const fresh = logs.filter(l => !known.has(l.id))
  if (!fresh.length) return

  const dutyIds = fresh.filter(l => l.entityType === 'DailyDuty').map(l => l.entityId)
  const vehicleIds = fresh.flatMap(l => (l.action === 'ASSIGN_VEHICLE' ? [(l.after as { vehicleId?: string } | null)?.vehicleId ?? ''] : [])).filter(Boolean)
  const [duties, vehicles] = await Promise.all([
    prisma.dailyDuty.findMany({ where: { id: { in: dutyIds } }, select: { id: true, role: true, kind: true, dutyNumber: true, summary: true } }),
    prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, code: true } }),
  ])
  const dutyLabel = new Map(duties.map(d => {
    const s = d.summary as { startMinutes?: number; endMinutes?: number } | null
    const name = d.kind === 'STANDBY' ? 'plantão' : `tabela ${formatDutyNumber(d.role, d.dutyNumber)}`
    return [d.id, s?.startMinutes != null && s.endMinutes != null ? `${name} (${clock(s.startMinutes)}–${clock(s.endMinutes)})` : name]
  }))
  const vehicleCode = new Map(vehicles.map(v => [v.id, v.code]))

  await prisma.crewNotification.createMany({
    data: fresh.map(l => ({ crewMemberId, changeLogId: l.id, date: l.operation.date, message: message(l, crewMemberId, dutyLabel, vehicleCode) })),
    skipDuplicates: true,
  })
}

function message(l: Log, me: string, dutyLabel: Map<string, string>, vehicleCode: Map<string, string>): string {
  const day = ddmm(dayOf(l.operation.date))
  const before = (l.before ?? {}) as { crewMemberId?: string | null }
  const after  = (l.after ?? {}) as { crewMemberId?: string | null; vehicleId?: string | null; kind?: string | null }
  switch (l.action) {
    case 'ASSIGN_CREW':
    case 'UNASSIGN_CREW': {
      const what = dutyLabel.get(l.entityId) ?? 'uma tabela'
      if (after.crewMemberId === me) return `Você foi escalado na ${what} em ${day}.`
      if (before.crewMemberId === me) return `Você não está mais na ${what} em ${day}.`
      return `Sua escala de ${day} mudou.`
    }
    case 'SWAP_CREW':      return `Sua escala de ${day} foi trocada com a de outro operador.`
    case 'ASSIGN_VEHICLE': return after.vehicleId ? `O carro da sua escala em ${day} mudou para ${vehicleCode.get(after.vehicleId) ?? 'outro carro'}.` : `O carro da sua escala em ${day} foi retirado.`
    case 'CANCEL_TRIP':    return `Uma viagem da sua escala em ${day} foi cancelada.`
    case 'RESTORE_TRIP':   return `Uma viagem da sua escala em ${day} voltou a ser feita.`
    case 'DAY_OFF':        return after.kind ? `Você está de folga em ${day}.` : `Sua folga em ${day} foi retirada.`
    default:               return `Sua escala de ${day} mudou.`
  }
}
