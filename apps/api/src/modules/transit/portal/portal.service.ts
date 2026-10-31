import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  PORTAL_QUOTA_PERIOD_LABEL, effectivePortalPermissions, formatDutyNumber, portalLinesSchema, portalPhoneSchema, portalRequestSchema,
  type PortalLines, type PortalMe, type PortalNotification, type PortalOccurrence, type PortalPermissions,
  type PortalQuota, type PortalQuotaBalance, type PortalRosterDay, type PortalRosterDayDetail, type PortalDutyDetail, type PortalTripMap, type PortalMapPoint,
  type PortalDutyItem, type PortalDutyEvent, type DutySummary, type TripMarking,
} from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { TransitRosterConfigService } from '../settings/transit-roster-config.service'
import { CrewOccurrenceService } from '../crew/crew-member/crew-occurrence.service'
import { CrewMemberLineService } from '../crew/crew-member/crew-member-line.service'
import { addDays, dayOf, toDbDate, type Day } from '../timetabling/plan-validity'
import { loadPeriodStart } from '../daily/roster/roster-generator.input'
import { logEmployeeChanges } from '../../hr/employee/employee-change'
import { syncNotifications } from './portal-notifications'
import type { PortalCrew } from './portal.guard'

// What the crew member sees and does in the portal: his roster (only published days), his
// requests (one day each, within his profile's quotas), the changes to confirm and his preferred
// lines and his phone — all scoped to himself.

const MAX_ROSTER_DAYS = 62
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// where he shows up: the sign-on's place, else where his first piece starts
type SignOnSource = { activities: { type: string; originLocalityId: string | null; destinationLocalityId: string | null }[]; pieces: { startLocalityId: string }[] }
function signOnPlace(d: SignOnSource): string | null {
  const a = d.activities.find(x => x.type === 'SIGN_ON')
  return a?.originLocalityId ?? a?.destinationLocalityId ?? d.pieces[0]?.startLocalityId ?? null
}

type Occurrence = { kind: string; startDate: Date; endDate: Date; startNotBefore: number | null; endNotAfter: number | null }
const onDay = (o: { startDate: Date; endDate: Date }, date: Day) => dayOf(o.startDate) <= date && dayOf(o.endDate) >= date
// the approved time windows in force on the day, as one text: "a partir de 08:00 até 18:00"
function windowOn(occurrences: Occurrence[], date: Day): string | null {
  const windows = occurrences.filter(o => o.kind === 'TIME_WINDOW' && onDay(o, date))
  return windows.length ? [
    windows.some(w => w.startNotBefore != null) ? `a partir de ${clock(Math.max(...windows.flatMap(w => w.startNotBefore ?? [])))}` : null,
    windows.some(w => w.endNotAfter != null) ? `até ${clock(Math.min(...windows.flatMap(w => w.endNotAfter ?? [])))}` : null,
  ].filter(Boolean).join(' ') : null
}

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
        select: { employee: { select: { code: true, fullName: true, phone: true, branch: { select: { name: true } } } } },
      }),
      this.permissions(crew),
      this.prisma.crewAccess.findUniqueOrThrow({ where: { crewMemberId: crew.id }, select: { createdAt: true } }),
    ])
    if (!crew.mustChangePin) await syncNotifications(this.prisma, crew.id, access.createdAt)
    const [unread, types, linesMissing] = await Promise.all([
      this.prisma.crewNotification.count({ where: { crewMemberId: crew.id, readAt: null } }),
      permissions.requestAbsence
        ? this.prisma.crewAbsenceType.findMany({ where: { requestable: true, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
        : Promise.resolve([]),
      crew.mustChangePin ? Promise.resolve(0) : this.linesMissing(crew),
    ])
    return {
      crewMemberId: crew.id, code: m.employee.code, name: m.employee.fullName, branch: m.employee.branch.name, phone: m.employee.phone,
      mustChangePin: crew.mustChangePin, permissions, unread, linesMissing, absenceTypes: types,
    }
  }

  // ── phone ───────────────────────────────────────────────────────────────────

  // straight to his Employee — no review; the change is kept in EmployeeChange
  async setPhone(crew: PortalCrew, raw: unknown): Promise<{ phone: string }> {
    if (!(await this.permissions(crew)).editContact) throw new ForbiddenException('Seu perfil não permite atualizar os dados de contato')
    const { phone } = portalPhoneSchema.parse(raw)
    await this.prisma.$transaction(async tx => {
      const { employeeId, employee } = await tx.crewMember.findUniqueOrThrow({ where: { id: crew.id }, select: { employeeId: true, employee: { select: { phone: true } } } })
      if (employee.phone === phone) return
      await tx.employee.update({ where: { id: employeeId }, data: { phone } })
      await logEmployeeChanges(tx, employeeId, employee, { phone }, 'PORTAL')
    })
    return { phone }
  }

  // ── notifications ─────────────────────────────────────────────────────────

  async notifications(crew: PortalCrew): Promise<PortalNotification[]> {
    const access = await this.prisma.crewAccess.findUniqueOrThrow({ where: { crewMemberId: crew.id }, select: { createdAt: true } })
    await syncNotifications(this.prisma, crew.id, access.createdAt)
    const rows = await this.prisma.crewNotification.findMany({ where: { crewMemberId: crew.id }, orderBy: [{ readAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], take: 100 })
    return rows.map(n => ({ id: n.id, date: dayOf(n.date), message: n.message, roster: n.changeLogId != null, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null }))
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
              activities: { where: { type: 'SIGN_ON' }, select: { type: true, originLocalityId: true, destinationLocalityId: true } },
              pieces: {
                where:   { isStale: false },
                orderBy: { sequence: 'asc' },
                select: {
                  startMinutes: true, endMinutes: true, startLocalityId: true,
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
    const placeIds = [...new Set(entries.flatMap(e => (e.dailyDuty ? signOnPlace(e.dailyDuty) ?? [] : [])))]
    const placeName = new Map((await this.prisma.transitLocality.findMany({ where: { id: { in: placeIds } }, select: { id: true, name: true } })).map(l => [l.id, l.name]))

    const out: PortalRosterDay[] = []
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const absence = occurrences.find(o => o.kind === 'ABSENCE' && onDay(o, date))
      const day: PortalRosterDay = { date, kind: null, duty: null, reason: null, window: windowOn(occurrences, date) }
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
          start: s?.startMinutes ?? null, end: s?.endMinutes ?? null, place: placeName.get(signOnPlace(d) ?? '') ?? null,
          lines: [...lines].sort(), vehicles: [...vehicles].sort(),
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

  // A published day's duties in detail: sign-on/off, the pieces (where and when he takes and
  // hands over the vehicle) with their trips, deadruns and intervals, and the off-vehicle time
  async rosterDay(crew: PortalCrew, date: Day): Promise<PortalRosterDayDetail> {
    const day = await this.publishedDay(crew, date)
    const [entries, occurrences] = await Promise.all([
      this.prisma.rosterEntry.findMany({
        where:  { crewMemberId: crew.id, date: day, dailyDuty: { operation: { status: { in: ['PUBLISHED', 'CLOSED'] } } } },
        select: {
          dailyDuty: {
            select: {
              role: true, dutyNumber: true, kind: true, summary: true,
              activities: { select: { type: true, intervalTypeId: true, startMinutes: true, endMinutes: true, originLocalityId: true, destinationLocalityId: true } },
              pieces: {
                where:   { isStale: false },
                orderBy: { sequence: 'asc' },
                select: {
                  startMinutes: true, endMinutes: true, startLocalityId: true, endLocalityId: true,
                  block: {
                    select: {
                      vehicle: { select: { code: true } },
                      events: {
                        orderBy: { startMinutes: 'asc' },
                        select: {
                          id: true, kind: true, startMinutes: true, endMinutes: true, lineId: true, intervalTypeId: true,
                          originLocalityId: true, destinationLocalityId: true, isCancelled: true, markings: true, stopPattern: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.crewOccurrence.findMany({
        where:  { crewMemberId: crew.id, status: 'APPROVED', kind: 'TIME_WINDOW', startDate: { lte: day }, endDate: { gte: day } },
        select: { kind: true, startDate: true, endDate: true, startNotBefore: true, endNotAfter: true },
      }),
    ])
    const duties = entries.flatMap(e => e.dailyDuty ?? [])
    const events = duties.flatMap(d => d.pieces.flatMap(p => p.block?.events ?? []))
    const localityIds = new Set<string>()
    for (const d of duties) {
      for (const a of d.activities) for (const id of [a.originLocalityId, a.destinationLocalityId]) if (id) localityIds.add(id)
      for (const p of d.pieces) localityIds.add(p.startLocalityId).add(p.endLocalityId)
    }
    for (const ev of events) for (const id of [ev.originLocalityId, ev.destinationLocalityId]) if (id) localityIds.add(id)
    const intervalIds = [...new Set([...duties.flatMap(d => d.activities.flatMap(a => a.intervalTypeId ?? [])), ...events.flatMap(ev => ev.intervalTypeId ?? [])])]
    const lineIds = [...new Set(events.flatMap(ev => ev.lineId ?? []))]
    const [localities, intervals, lines] = await Promise.all([
      this.prisma.transitLocality.findMany({ where: { id: { in: [...localityIds] } }, select: { id: true, name: true, isDepot: true } }),
      this.prisma.intervalType.findMany({ where: { id: { in: intervalIds } }, select: { id: true, name: true } }),
      this.prisma.transitLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, code: true } }),
    ])
    const placeName = new Map(localities.map(l => [l.id, l.name]))
    const depots = new Set(localities.filter(l => l.isDepot).map(l => l.id))
    const intervalName = new Map(intervals.map(i => [i.id, i.name]))
    const lineCode = new Map(lines.map(l => [l.id, l.code]))
    const place = (id: string | null) => (id ? placeName.get(id) ?? '?' : null)
    const legends = (m: unknown) => ((m ?? []) as TripMarking[]).map(t => t.legendText.trim()).filter(Boolean)

    const detail = duties.map((d): PortalDutyDetail => {
      const s = d.summary as DutySummary | null
      const items: PortalDutyItem[] = []
      const notes = new Set<string>()
      for (const p of d.pieces) {
        const own = (p.block?.events ?? []).filter(ev => ev.startMinutes < p.endMinutes && ev.endMinutes > p.startMinutes)
        items.push({
          type: 'PIECE', start: p.startMinutes, end: p.endMinutes, from: place(p.startLocalityId)!, to: place(p.endLocalityId)!,
          fromDepot: depots.has(p.startLocalityId), toDepot: depots.has(p.endLocalityId),
          vehicle: p.block?.vehicle?.code ?? null,
          events: own.map((ev): PortalDutyEvent => {
            if (ev.kind === 'TRIP') {
              const trip = legends(ev.markings)
              if (!ev.isCancelled) for (const n of trip) notes.add(n)
              return {
                type: 'TRIP', id: ev.id, start: ev.startMinutes, end: ev.endMinutes, line: lineCode.get(ev.lineId ?? '') ?? '?',
                from: place(ev.originLocalityId) ?? '?', to: place(ev.destinationLocalityId) ?? '?',
                stopPattern: ev.stopPattern, cancelled: ev.isCancelled,
                joinsAt: ev.startMinutes < p.startMinutes ? p.startMinutes : null, leavesAt: ev.endMinutes > p.endMinutes ? p.endMinutes : null,
                notes: trip,
              }
            }
            if (ev.kind === 'DEADRUN') return { type: 'DEADRUN', start: ev.startMinutes, end: ev.endMinutes, from: place(ev.originLocalityId) ?? '?', to: place(ev.destinationLocalityId) ?? '?' }
            return { type: 'INTERVAL', start: ev.startMinutes, end: ev.endMinutes, label: intervalName.get(ev.intervalTypeId ?? '') ?? 'Intervalo' }
          }),
        })
      }
      for (const a of d.activities) {
        if (a.type === 'BREAK') items.push({ type: 'BREAK', start: a.startMinutes, end: a.endMinutes, label: intervalName.get(a.intervalTypeId ?? '') ?? 'Intervalo', locality: place(a.originLocalityId ?? a.destinationLocalityId) })
        else if (a.type === 'TRAVEL' || a.type === 'STANDBY') items.push({ type: a.type, start: a.startMinutes, end: a.endMinutes, from: place(a.originLocalityId), to: place(a.destinationLocalityId) })
      }
      items.sort((a, b) => ('start' in a ? a.start : 0) - ('start' in b ? b.start : 0))
      // sign-on/off: the summary's effective times (explicit activity or the settings' minutes);
      // the place is the activity's, else where the first piece starts / the last one ends
      const signOn  = d.activities.find(a => a.type === 'SIGN_ON')
      const signOff = d.activities.find(a => a.type === 'SIGN_OFF')
      const start = s?.startMinutes ?? signOn?.startMinutes ?? null
      const end   = s?.endMinutes ?? signOff?.endMinutes ?? null
      if (start != null) items.unshift({ type: 'SIGN_ON', minutes: start, locality: place(signOnPlace(d)) })
      if (end != null) items.push({ type: 'SIGN_OFF', minutes: end, locality: place(signOff?.destinationLocalityId ?? signOff?.originLocalityId ?? d.pieces.at(-1)?.endLocalityId ?? null) })
      return {
        label: d.kind === 'STANDBY' ? 'Plantão' : formatDutyNumber(d.role, d.dutyNumber),
        kind: d.kind === 'STANDBY' ? 'STANDBY' : 'DUTY', start, end,
        totals: s ? { spreadMinutes: s.spreadMinutes, workMinutes: s.workMinutes, breakMinutes: s.breakMinutes } : null,
        notes: [...notes], items,
      }
    })
    detail.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    return { date, duties: detail, window: windowOn(occurrences, date) }
  }

  // A trip of one of his duties on the day, on the map: the route's trajectory (its legs joined),
  // its stops and where he takes / hands over the vehicle when that falls inside the trip
  async tripMap(crew: PortalCrew, date: Day, eventId: string): Promise<PortalTripMap> {
    const day = await this.publishedDay(crew, date)
    const event = await this.prisma.dailyBlockEvent.findFirst({
      where:  { id: eventId, kind: 'TRIP', operation: { date: day, status: { in: ['PUBLISHED', 'CLOSED'] } } },
      select: { startMinutes: true, endMinutes: true, routeId: true, dailyBlockId: true },
    })
    // his own trips only: on a block one of his duties of the day runs, inside the piece
    const piece = event?.dailyBlockId ? await this.prisma.dailyDutyPiece.findFirst({
      where: {
        dailyBlockId: event.dailyBlockId, isStale: false, startMinutes: { lt: event.endMinutes }, endMinutes: { gt: event.startMinutes },
        duty: { rosterEntries: { some: { crewMemberId: crew.id, date: day } } },
      },
      select: { startMinutes: true, endMinutes: true, startLocalityId: true, endLocalityId: true },
    }) : null
    if (!event?.routeId || !piece) throw new NotFoundException('Viagem não encontrada na sua escala')
    const route = await this.prisma.transitRoute.findUniqueOrThrow({
      where:  { id: event.routeId },
      select: {
        name: true, line: { select: { code: true } },
        localities: { orderBy: { sequence: 'asc' }, select: { lat: true, lng: true, geometry: true, locality: { select: { name: true, lat: true, lng: true } } } },
      },
    })
    const path: [number, number][] = []
    let approximate = false
    let prev: [number, number] | null = null
    for (const [i, rl] of route.localities.entries()) {
      const lat = rl.locality?.lat ?? rl.lat, lng = rl.locality?.lng ?? rl.lng
      const point: [number, number] | null = lat != null && lng != null ? [lng, lat] : null
      const leg = (rl.geometry as { coordinates?: [number, number][] } | null)?.coordinates
      if (i > 0 && leg?.length) path.push(...(path.length ? leg.slice(1) : leg))
      else if (i > 0 && point) {
        // no trajectory for the leg: straight from the previous point
        approximate = true
        if (!path.length && prev) path.push(prev)
        path.push(point)
      }
      if (point) prev = point
    }
    const named = route.localities.filter(rl => rl.locality?.lat != null && rl.locality.lng != null)
    const stops = named.map((rl, i): PortalTripMap['stops'][number] => ({
      name: rl.locality!.name, lat: rl.locality!.lat!, lng: rl.locality!.lng!,
      kind: i === 0 ? 'ORIGIN' : i === named.length - 1 ? 'DESTINATION' : 'STOP',
    }))
    const edges = [piece.startMinutes > event.startMinutes ? piece.startLocalityId : null, piece.endMinutes < event.endMinutes ? piece.endLocalityId : null]
    const places = new Map((await this.prisma.transitLocality.findMany({
      where: { id: { in: edges.filter((id): id is string => !!id) } }, select: { id: true, name: true, lat: true, lng: true },
    })).map(l => [l.id, l]))
    const point = (id: string | null, minutes: number): PortalMapPoint | null => {
      const l = id ? places.get(id) : null
      return l ? { name: l.name, lat: l.lat, lng: l.lng, minutes } : null
    }
    return {
      line: route.line.code, route: route.name, start: event.startMinutes, end: event.endMinutes, path, approximate, stops,
      joins: point(edges[0], piece.startMinutes), leaves: point(edges[1], piece.endMinutes),
    }
  }

  // the date, once it's a published (or closed) day of his empresa's scopes he may see
  private async publishedDay(crew: PortalCrew, date: Day): Promise<Date> {
    if (!(await this.permissions(crew)).viewRoster) throw new ForbiddenException('Sem permissão para ver a escala')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Data inválida')
    const day = toDbDate(date)
    const scopes = (await this.prisma.scopeOperator.findMany({ where: { branchId: crew.branchId }, select: { scopeId: true } })).map(s => s.scopeId)
    const published = await this.prisma.dailyOperation.count({ where: { scopeId: { in: scopes }, date: day, status: { in: ['PUBLISHED', 'CLOSED'] } } })
    if (!published) throw new NotFoundException('Escala do dia ainda não publicada')
    return day
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

  // staff side: a crew member's quotas, to warn a request launched on his behalf over them
  async quotasOf(crewMemberId: string, date?: string): Promise<PortalQuotaBalance[]> {
    const m = await this.prisma.crewMember.findUnique({ where: { id: crewMemberId }, select: { id: true, role: true, employee: { select: { branchId: true } } } })
    if (!m) throw new NotFoundException('Operador não encontrado')
    return this.quotas({ id: m.id, branchId: m.employee.branchId, role: m.role, mustChangePin: false }, date)
  }

  private async balances(crew: PortalCrew, permissions: PortalPermissions, date: Day): Promise<PortalQuotaBalance[]> {
    const codes = Object.keys(permissions.absenceLimits)
    const types = codes.length
      ? await this.prisma.crewAbsenceType.findMany({ where: { code: { in: codes }, requestable: true, isActive: true }, select: { id: true, code: true, name: true } })
      : []
    // only what he can ask for — a quota on a type closed to the portal would never move
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
    const [board, permissions, { portalPreferredLines }] = await Promise.all([this.lines.board(crew.id), this.permissions(crew), this.rosterConfig.get(crew.branchId)])
    const entry = new Map(board.entries.map(e => [e.lineId, e]))
    const operable = (lineId: string) => (board.lineAccessMode === 'WHITELIST' ? entry.get(lineId)?.access === 'ENABLED' : entry.get(lineId)?.access !== 'BLOCKED')
    const lines = board.lines.filter(l => operable(l.id)).map(l => ({ id: l.id, code: l.code, name: l.name, rank: entry.get(l.id)?.rank ?? null, priority: !!entry.get(l.id)?.priority }))
    // his plantão preference (set by staff) takes one of the slots
    const slots = Math.max(0, board.maxPreferredLines - (board.standby.rank != null ? 1 : 0))
    const editable = permissions.editPreferredLines
    // never more than he can pick — fewer lines open to him than slots must not lock him out
    const required = editable && portalPreferredLines === 'REQUIRED' ? Math.min(slots, lines.length) : 0
    return { maxPreferredLines: slots, editable, required, lines }
  }

  // REQUIRED mode: how many preferred lines he still has to pick before using the portal
  async linesMissing(crew: PortalCrew): Promise<number> {
    const { required, lines } = await this.preferredLines(crew)
    return Math.max(0, required - lines.filter(l => l.rank != null).length)
  }

  // his preferences in order — access, the empresa's priority lines and his plantão rank stay
  async setPreferredLines(crew: PortalCrew, raw: unknown): Promise<PortalLines> {
    const { preferred } = portalLinesSchema.parse(raw)
    const current = await this.preferredLines(crew)
    if (!current.editable) throw new ForbiddenException('Sem permissão para editar as linhas preferidas')
    if (new Set(preferred).size !== preferred.length) throw new BadRequestException('Linha repetida')
    if (preferred.length > current.maxPreferredLines) throw new BadRequestException(`No máximo ${current.maxPreferredLines} linhas`)
    if (preferred.length < current.required) throw new BadRequestException(`Escolha ${current.required} linhas`)
    const board = await this.lines.board(crew.id)
    // the ranks left free by the plantão, in order
    const free = Array.from({ length: board.maxPreferredLines }, (_, i) => i + 1).filter(r => r !== board.standby.rank)
    const rank = new Map(preferred.map((id, i) => [id, free[i]]))
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
