import { BadRequestException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common'
import {
  PORTAL_QUOTA_PERIOD_LABEL, effectivePortalPermissions, formatDutyNumber, portalLinesSchema, portalRequestSchema,
  type PortalLines, type PortalMe, type PortalNotification, type PortalOccurrence, type PortalPermissions,
  type PortalQuota, type PortalQuotaBalance, type PortalRosterDay,
} from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { TransitRosterConfigService } from '../settings/transit-roster-config.service'
import { CrewOccurrenceService } from '../crew/crew-member/crew-occurrence.service'
import { CrewMemberLineService } from '../crew/crew-member/crew-member-line.service'
import { addDays, dayOf, toDbDate, type Day } from '../timetabling/plan-validity'
import { loadPeriodStart } from '../daily/roster/roster-generator.input'
import { syncNotifications } from './portal-notifications'
import type { PortalCrew } from './portal.guard'

// What the crew member sees and does in the portal: his roster (only published days), his
// requests (one day each, within his profile's quotas), the changes to confirm and his preferred
// lines — all scoped to himself.

const MAX_ROSTER_DAYS = 62
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma:       PrismaService,
    private readonly rosterConfig: TransitRosterConfigService,
    private readonly occurrences:  CrewOccurrenceService,
    private readonly lines:        CrewMemberLineService,
  ) {}

  async permissions(crew: PortalCrew): Promise<PortalPermissions> {
    const m = await this.prisma.crewMember.findUnique({
      where:  { id: crew.id },
      select: { portalOverride: true, portalProfile: { select: { permissions: true } } },
    })
    const profile = m?.portalProfile?.permissions
      ?? (await this.prisma.portalProfile.findFirst({ where: { branchId: crew.branchId, isDefault: true }, select: { permissions: true } }))?.permissions
    return effectivePortalPermissions(profile ?? null, m?.portalOverride ?? null)
  }

  async me(crew: PortalCrew): Promise<PortalMe> {
    const [m, permissions, access] = await Promise.all([
      this.prisma.crewMember.findUniqueOrThrow({
        where:  { id: crew.id },
        select: { employee: { select: { code: true, fullName: true, branch: { select: { name: true } } } } },
      }),
      this.permissions(crew),
      this.prisma.crewAccess.findUniqueOrThrow({ where: { crewMemberId: crew.id }, select: { createdAt: true } }),
    ])
    if (!crew.mustChangePin) await syncNotifications(this.prisma, crew.id, access.createdAt)
    const [unread, types] = await Promise.all([
      this.prisma.crewNotification.count({ where: { crewMemberId: crew.id, readAt: null } }),
      permissions.requestAbsence
        ? this.prisma.crewAbsenceType.findMany({ where: { requestable: true, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ])
    return {
      crewMemberId: crew.id, code: m.employee.code, name: m.employee.fullName, branch: m.employee.branch.name,
      mustChangePin: crew.mustChangePin, permissions, unread, absenceTypes: types,
    }
  }

  // ── notifications ─────────────────────────────────────────────────────────

  async notifications(crew: PortalCrew): Promise<PortalNotification[]> {
    const access = await this.prisma.crewAccess.findUniqueOrThrow({ where: { crewMemberId: crew.id }, select: { createdAt: true } })
    await syncNotifications(this.prisma, crew.id, access.createdAt)
    const rows = await this.prisma.crewNotification.findMany({ where: { crewMemberId: crew.id }, orderBy: [{ readAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], take: 100 })
    return rows.map(n => ({ id: n.id, date: dayOf(n.date), message: n.message, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null }))
  }

  // "Li e confirmo" — the given ones, or every unread one
  async ack(crew: PortalCrew, ids?: string[]): Promise<{ read: number }> {
    const { count } = await this.prisma.crewNotification.updateMany({
      where: { crewMemberId: crew.id, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data:  { readAt: new Date() },
    })
    return { read: count }
  }

  // ── roster ────────────────────────────────────────────────────────────────

  async roster(crew: PortalCrew, from: Day, to: Day): Promise<PortalRosterDay[]> {
    if (!(await this.permissions(crew)).viewRoster) throw new ForbiddenException('Sem permissão para ver a escala')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BadRequestException('Período inválido')
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_ROSTER_DAYS) throw new BadRequestException(`No máximo ${MAX_ROSTER_DAYS} dias`)
    const range = { gte: toDbDate(from), lte: toDbDate(to) }
    const scopes = (await this.prisma.scopeOperator.findMany({ where: { branchId: crew.branchId }, select: { scopeId: true } })).map(s => s.scopeId)
    const [published, entries, occurrences] = await Promise.all([
      // only the published (or closed) days are his roster
      this.prisma.dailyOperation.findMany({ where: { scopeId: { in: scopes }, date: range, status: { in: ['PUBLISHED', 'CLOSED'] } }, select: { date: true } }),
      this.prisma.rosterEntry.findMany({
        where:  { crewMemberId: crew.id, date: range },
        select: {
          date: true, kind: true, absenceType: { select: { name: true } },
          dailyDuty: {
            select: {
              role: true, dutyNumber: true, kind: true, summary: true,
              pieces: {
                where:  { isStale: false },
                select: {
                  startMinutes: true, endMinutes: true,
                  block: { select: { vehicle: { select: { code: true } }, events: { where: { kind: 'TRIP', isCancelled: false }, select: { startMinutes: true, endMinutes: true, lineId: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.crewOccurrence.findMany({
        where:  { crewMemberId: crew.id, status: 'APPROVED', startDate: { lte: range.lte }, endDate: { gte: range.gte } },
        select: { kind: true, startDate: true, endDate: true, startNotBefore: true, endNotAfter: true, absenceType: { select: { name: true } } },
      }),
    ])
    const open = new Set(published.map(p => dayOf(p.date)))
    const lineIds = [...new Set(entries.flatMap(e => e.dailyDuty?.pieces.flatMap(p => p.block?.events.flatMap(ev => ev.lineId ?? []) ?? []) ?? []))]
    const lineCode = new Map((await this.prisma.transitLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, code: true } })).map(l => [l.id, l.code]))

    const out: PortalRosterDay[] = []
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const on = (o: { startDate: Date; endDate: Date }) => dayOf(o.startDate) <= date && dayOf(o.endDate) >= date
      const absence = occurrences.find(o => o.kind === 'ABSENCE' && on(o))
      const windows = occurrences.filter(o => o.kind === 'TIME_WINDOW' && on(o))
      const window = windows.length ? [
        windows.some(w => w.startNotBefore != null) ? `a partir de ${clock(Math.max(...windows.flatMap(w => w.startNotBefore ?? [])))}` : null,
        windows.some(w => w.endNotAfter != null) ? `até ${clock(Math.min(...windows.flatMap(w => w.endNotAfter ?? [])))}` : null,
      ].filter(Boolean).join(' ') : null
      const day: PortalRosterDay = { date, kind: null, duty: null, reason: null, window }
      const mine = open.has(date) ? entries.filter(e => dayOf(e.date) === date) : []
      const work = mine.find(e => e.dailyDuty)
      const off = mine.find(e => e.kind === 'DAY_OFF' || e.kind === 'COMP_OFF')
      if (work?.dailyDuty) {
        const d = work.dailyDuty
        const s = d.summary as { startMinutes?: number; endMinutes?: number } | null
        const lines = new Set<string>(), vehicles = new Set<string>()
        for (const p of d.pieces) {
          if (p.block?.vehicle) vehicles.add(p.block.vehicle.code)
          for (const ev of p.block?.events ?? []) if (ev.lineId && ev.startMinutes < p.endMinutes && ev.endMinutes > p.startMinutes) lines.add(lineCode.get(ev.lineId) ?? '?')
        }
        day.kind = d.kind === 'STANDBY' ? 'STANDBY' : 'DUTY'
        day.duty = {
          label: d.kind === 'STANDBY' ? 'Plantão' : formatDutyNumber(d.role, d.dutyNumber),
          start: s?.startMinutes ?? null, end: s?.endMinutes ?? null, lines: [...lines].sort(), vehicles: [...vehicles].sort(),
        }
      } else if (off) {
        day.kind = off.kind
        day.reason = off.absenceType?.name ?? (off.kind === 'COMP_OFF' ? 'Folga compensada' : 'Folga')
      } else if (absence) {
        day.kind = 'ABSENCE'
        day.reason = absence.absenceType?.name ?? 'Ausência'
      }
      out.push(day)
    }
    return out
  }

  // ── requests ──────────────────────────────────────────────────────────────

  async requests(crew: PortalCrew): Promise<PortalOccurrence[]> {
    const rows = await this.prisma.crewOccurrence.findMany({
      where:  { crewMemberId: crew.id },
      orderBy: { startDate: 'desc' }, take: 100,
      select: { id: true, kind: true, startDate: true, endDate: true, startNotBefore: true, endNotAfter: true, status: true, origin: true, reviewNotes: true, absenceType: { select: { name: true } } },
    })
    return rows.map(o => ({
      id: o.id, kind: o.kind, startDate: dayOf(o.startDate), endDate: dayOf(o.endDate), reason: o.absenceType?.name ?? null,
      startNotBefore: o.startNotBefore, endNotAfter: o.endNotAfter, status: o.status, origin: o.origin, reviewNotes: o.reviewNotes,
    }))
  }

  async request(crew: PortalCrew, raw: unknown): Promise<PortalOccurrence> {
    const req = portalRequestSchema.parse(raw)
    const permissions = await this.permissions(crew)
    if (req.kind === 'ABSENCE' && !permissions.requestAbsence) throw new ForbiddenException('Sem permissão para pedir ausência')
    if (req.kind === 'TIME_WINDOW' && !permissions.requestTimeWindow) throw new ForbiddenException('Sem permissão para pedir restrição de horário')
    if (req.date < dayOf(new Date())) throw new BadRequestException('O pedido não pode ser para um dia que já passou')
    if (req.kind === 'ABSENCE') {
      const type = await this.prisma.crewAbsenceType.findUnique({ where: { id: req.absenceTypeId }, select: { requestable: true, isActive: true } })
      if (!type?.requestable || !type.isActive) throw new BadRequestException('Esse motivo não pode ser pedido pelo portal')
    }
    const balance = (await this.balances(crew, permissions, req.date)).find(b => b.kind === req.kind && (req.kind === 'TIME_WINDOW' || b.absenceTypeId === req.absenceTypeId))
    if (balance && balance.used >= balance.max) {
      throw new UnprocessableEntityException(`Cota esgotada: ${balance.label} — ${balance.used} de ${balance.max} na ${PORTAL_QUOTA_PERIOD_LABEL[balance.period].toLowerCase()}`)
    }
    const created = await this.occurrences.createFromPortal(crew.id, req)
    return (await this.requests(crew)).find(r => r.id === created.id)!
  }

  // the quotas of his profile in the period holding `date` (today without one)
  async quotas(crew: PortalCrew, date?: string): Promise<PortalQuotaBalance[]> {
    return this.balances(crew, await this.permissions(crew), date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dayOf(new Date()))
  }

  private async balances(crew: PortalCrew, permissions: PortalPermissions, date: Day): Promise<PortalQuotaBalance[]> {
    const codes = Object.keys(permissions.absenceLimits)
    const types = codes.length
      ? await this.prisma.crewAbsenceType.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, name: true } })
      : []
    const wanted: { label: string; kind: 'ABSENCE' | 'TIME_WINDOW'; absenceTypeId: string | null; quota: PortalQuota }[] = [
      ...types.map(t => ({ label: t.name, kind: 'ABSENCE' as const, absenceTypeId: t.id, quota: permissions.absenceLimits[t.code] })),
      ...(permissions.timeWindowLimit ? [{ label: 'Restrição de horário', kind: 'TIME_WINDOW' as const, absenceTypeId: null, quota: permissions.timeWindowLimit }] : []),
    ].filter(w => w.quota.maxRequests != null)
    if (!wanted.length) return []
    const { loadPeriodStartDay } = await this.rosterConfig.get(crew.branchId)
    const out: PortalQuotaBalance[] = []
    for (const w of wanted) {
      const { from, to } = periodOf(w.quota.period, date, loadPeriodStartDay)
      const used = await this.prisma.crewOccurrence.count({
        where: {
          crewMemberId: crew.id, kind: w.kind, ...(w.absenceTypeId ? { absenceTypeId: w.absenceTypeId } : {}),
          origin: { in: ['PORTAL', 'STAFF_ON_BEHALF'] }, status: { in: ['REQUESTED', 'APPROVED'] },
          startDate: { gte: toDbDate(from), lte: toDbDate(to) },
        },
      })
      out.push({ label: w.label, kind: w.kind, absenceTypeId: w.absenceTypeId, period: w.quota.period, from, to, used, max: w.quota.maxRequests! })
    }
    return out
  }

  // ── preferred lines ───────────────────────────────────────────────────────

  async preferredLines(crew: PortalCrew): Promise<PortalLines> {
    const [board, permissions] = await Promise.all([this.lines.board(crew.id), this.permissions(crew)])
    const entry = new Map(board.entries.map(e => [e.lineId, e]))
    const operable = (lineId: string) => (board.lineAccessMode === 'WHITELIST' ? entry.get(lineId)?.access === 'ENABLED' : entry.get(lineId)?.access !== 'BLOCKED')
    return {
      maxPreferredLines: board.maxPreferredLines, editable: permissions.editPreferredLines,
      lines: board.lines.filter(l => operable(l.id)).map(l => ({ id: l.id, code: l.code, name: l.name, rank: entry.get(l.id)?.rank ?? null, priority: !!entry.get(l.id)?.priority })),
    }
  }

  // his preferences in order — access and the empresa's priority lines stay as they are
  async setPreferredLines(crew: PortalCrew, raw: unknown): Promise<PortalLines> {
    if (!(await this.permissions(crew)).editPreferredLines) throw new ForbiddenException('Sem permissão para editar as linhas preferidas')
    const { preferred } = portalLinesSchema.parse(raw)
    if (new Set(preferred).size !== preferred.length) throw new BadRequestException('Linha repetida')
    const board = await this.lines.board(crew.id)
    const rank = new Map(preferred.map((id, i) => [id, i + 1]))
    const rows = [
      ...board.entries.map(e => ({ lineId: e.lineId, access: e.access, priority: e.priority, rank: rank.get(e.lineId) ?? null })),
      ...preferred.filter(id => !board.entries.some(e => e.lineId === id)).map(id => ({ lineId: id, access: null, priority: false, rank: rank.get(id)! })),
    ]
    await this.lines.replaceAll(crew.id, rows, board.standby)
    return this.preferredLines(crew)
  }
}

// the quota period holding `date`
function periodOf(period: PortalQuota['period'], date: Day, loadPeriodStartDay: number): { from: Day; to: Day } {
  if (period === 'YEAR') return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` }
  if (period === 'WEEK') {
    const monday = addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))
    return { from: monday, to: addDays(monday, 6) }
  }
  const from = loadPeriodStart(date, loadPeriodStartDay)
  return { from, to: addDays(loadPeriodStart(addDays(from, 32), loadPeriodStartDay), -1) }
}
