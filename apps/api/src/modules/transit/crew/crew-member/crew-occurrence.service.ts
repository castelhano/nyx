import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { crewOccurrenceSchema, restPatternWorks, CrewOccurrence, CreateCrewOccurrenceDto, UpdateCrewOccurrenceDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { addDays, dayOf, toDbDate, type Day } from '../../timetabling/plan-validity'

type OccurrenceRow = {
  kind: string; absenceTypeId?: string | null; startDate: Date | string; endDate: Date | string
  startNotBefore?: number | null; endNotAfter?: number | null; status?: string; origin?: string
}

const REVIEWED = new Set(['APPROVED', 'REJECTED'])
const LIVE     = ['REQUESTED', 'APPROVED'] as const

// the operator's occurrences screen: what each day of the range means for him, his occurrences
// (all of them, newest first) and the absence reasons
export interface CrewCalendar {
  days: {
    date:       Day
    // the rest pattern's day off (his own or his shift's on that date)
    patternOff: boolean
    holiday:    string | null
    // the roster on the date (a launched day off, or working)
    entry:      'DUTY' | 'STANDBY' | 'DAY_OFF' | 'COMP_OFF' | null
  }[]
  occurrences: (CrewOccurrence & { absenceType: { name: string } | null })[]
  absenceTypes: { id: string; name: string }[]
}

// Absences and one-off time windows of a crew member, through the staff screens. A request
// (STAFF_ON_BEHALF here; PORTAL comes from the crew portal) keeps what was asked. Only the portal
// limits a request to one day — launched here it may span several.
@Injectable()
export class CrewOccurrenceService extends BaseService<CrewOccurrence, CreateCrewOccurrenceDto, UpdateCrewOccurrenceDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'crewOccurrence', crewOccurrenceSchema, 'transit')
  }

  async calendar(crewMemberId: string, from: Day, to: Day): Promise<CrewCalendar> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BadRequestException('Período inválido')
    const range = { gte: toDbDate(from), lte: toDbDate(to) }
    const pattern = { select: { pattern: true, anchorDate: true, offOnHolidays: true } }
    const member = await this.prisma.crewMember.findUnique({
      where:  { id: crewMemberId },
      select: {
        restOffset: true, restPattern: pattern, employee: { select: { branchId: true } },
        shifts: {
          where:  { validFrom: { lte: toDbDate(to) }, OR: [{ validTo: null }, { validTo: { gte: toDbDate(from) } }] },
          select: { validFrom: true, validTo: true, shift: { select: { restPattern: pattern } } },
        },
      },
    })
    if (!member) throw new NotFoundException('Operador não encontrado')
    const [holidays, entries, occurrences, absenceTypes] = await Promise.all([
      this.prisma.holiday.findMany({ where: { date: range, OR: [{ branchId: null }, { branchId: member.employee.branchId }] }, select: { date: true, name: true } }),
      this.prisma.rosterEntry.findMany({ where: { crewMemberId, date: range }, select: { date: true, kind: true } }),
      this.prisma.crewOccurrence.findMany({ where: { crewMemberId }, orderBy: { startDate: 'desc' }, take: 300, include: { absenceType: { select: { name: true } } } }),
      this.prisma.crewAbsenceType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ])

    const days: CrewCalendar['days'] = []
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const holiday = holidays.find(h => dayOf(h.date) === date)?.name ?? null
      const bound = member.shifts.find(s => dayOf(s.validFrom) <= date && (!s.validTo || dayOf(s.validTo) >= date))
      const p = member.restPattern ?? bound?.shift.restPattern ?? null
      const kinds = entries.filter(e => dayOf(e.date) === date).map(e => e.kind)
      days.push({
        date, holiday,
        patternOff: !!p && !restPatternWorks(p, member.restOffset, date, !!holiday),
        entry: (['COMP_OFF', 'DAY_OFF', 'DUTY', 'STANDBY'] as const).find(k => kinds.includes(k)) ?? null,
      })
    }
    return { days, occurrences: occurrences as unknown as CrewCalendar['occurrences'], absenceTypes }
  }

  async createAs(dto: CreateCrewOccurrenceDto, userId: string | undefined): Promise<CrewOccurrence> {
    const row = CrewOccurrenceService.normalized(dto)
    if (row.origin === 'PORTAL') throw new BadRequestException('Solicitações do portal só são criadas pelo próprio operador')
    CrewOccurrenceService.assertValid(row)
    await this.assertNoOverlap(null, dto.crewMemberId, row)
    const request = row.origin === 'STAFF_ON_BEHALF'
    const { requested: _r, createdByUserId: _c, reviewedByUserId: _rb, reviewedAt: _ra, ...data } = row
    const created = await super.create({
      ...data,
      createdByUserId: userId ?? null,
      requested: request ? CrewOccurrenceService.snapshot(row) : null,
      ...(REVIEWED.has(row.status ?? '') ? { reviewedByUserId: userId ?? null, reviewedAt: new Date() } : {}),
    })
    await this.syncDaysOff(created.id)
    return created
  }

  async updateAs(id: string, dto: UpdateCrewOccurrenceDto, userId: string | undefined): Promise<CrewOccurrence> {
    const current = await this.findOne(id)
    // what was asked and who launched it never change; the origin is fixed at creation
    const { requested: _r, createdByUserId: _c, reviewedByUserId: _rb, reviewedAt: _ra, origin: _o, crewMemberId: _m, ...patch } = dto
    const row = CrewOccurrenceService.normalized({ ...current, ...patch })
    CrewOccurrenceService.assertValid(row)
    await this.assertNoOverlap(id, current.crewMemberId, row)
    const statusChanged = patch.status !== undefined && patch.status !== current.status
    const updated = await super.update(id, {
      ...patch,
      kind: row.kind, absenceTypeId: row.absenceTypeId, startNotBefore: row.startNotBefore, endNotAfter: row.endNotAfter,
      ...(statusChanged && REVIEWED.has(patch.status!) ? { reviewedByUserId: userId ?? null, reviewedAt: new Date() } : {}),
    })
    await this.syncDaysOff(id)
    return updated
  }

  // An approved absence whose type becomes a day off (effect DAY_OFF / COMP_OFF) puts it on the
  // roster, on each of its days the crew member has nothing else (a day with a duty keeps it and
  // shows the absence as a pendência). Rebuilt on every change — not approved: none.
  private async syncDaysOff(id: string): Promise<void> {
    await this.prisma.rosterEntry.deleteMany({ where: { crewOccurrenceId: id } })
    const o = await this.prisma.crewOccurrence.findUnique({
      where:  { id },
      select: { crewMemberId: true, kind: true, status: true, startDate: true, endDate: true, absenceType: { select: { id: true, effect: true } } },
    })
    const effect = o?.absenceType?.effect
    if (!o || o.kind !== 'ABSENCE' || o.status !== 'APPROVED' || (effect !== 'DAY_OFF' && effect !== 'COMP_OFF')) return
    const days: string[] = []
    for (let d = dayOf(o.startDate); d <= dayOf(o.endDate); d = addDays(d, 1)) days.push(d)
    const taken = new Set((await this.prisma.rosterEntry.findMany({
      where:  { crewMemberId: o.crewMemberId, date: { in: days.map(toDbDate) } },
      select: { date: true },
    })).map(e => dayOf(e.date)))
    await this.prisma.rosterEntry.createMany({
      data: days.filter(d => !taken.has(d)).map(d => ({
        crewMemberId: o.crewMemberId, date: toDbDate(d), kind: effect, absenceTypeId: o.absenceType!.id, crewOccurrenceId: id, source: 'REQUEST',
      })),
    })
  }

  // An absence takes the whole day: it can't share a day with another absence or a time window
  // (requested or approved). Time windows may share a day — they add up (the latest start, the
  // earliest end).
  private async assertNoOverlap(id: string | null, crewMemberId: string, row: OccurrenceRow): Promise<void> {
    if (!LIVE.includes((row.status ?? 'APPROVED') as typeof LIVE[number])) return
    const clash = await this.prisma.crewOccurrence.findFirst({
      where: {
        crewMemberId, status: { in: [...LIVE] }, ...(id ? { id: { not: id } } : {}),
        startDate: { lte: new Date(row.endDate) }, endDate: { gte: new Date(row.startDate) },
        ...(row.kind === 'TIME_WINDOW' ? { kind: 'ABSENCE' as const } : {}),
      },
      select:  { kind: true, startDate: true, endDate: true, absenceType: { select: { name: true } } },
    })
    if (!clash) return
    const span = `${dayOf(clash.startDate).split('-').reverse().slice(0, 2).join('/')}${dayOf(clash.startDate) === dayOf(clash.endDate) ? '' : ` a ${dayOf(clash.endDate).split('-').reverse().slice(0, 2).join('/')}`}`
    throw new BadRequestException(clash.kind === 'ABSENCE'
      ? `Já há ausência (${clash.absenceType?.name ?? 'ausência'}) em ${span}`
      : `Já há restrição de horário em ${span} — uma ausência ocupa o dia todo`)
  }

  // an absence has a reason and no window; a time window has a window and no reason
  private static normalized<D extends OccurrenceRow>(dto: D): D {
    const blank = (v: unknown) => v === '' || v == null
    if (dto.kind === 'TIME_WINDOW') {
      return {
        ...dto, absenceTypeId: null,
        startNotBefore: blank(dto.startNotBefore) ? null : Number(dto.startNotBefore),
        endNotAfter:    blank(dto.endNotAfter) ? null : Number(dto.endNotAfter),
      }
    }
    return { ...dto, absenceTypeId: blank(dto.absenceTypeId) ? null : dto.absenceTypeId, startNotBefore: null, endNotAfter: null }
  }

  private static assertValid(row: OccurrenceRow): void {
    if (dayOf(new Date(row.endDate)) < dayOf(new Date(row.startDate))) throw new BadRequestException('O fim não pode ser antes do início')
    if (row.kind === 'ABSENCE' && !row.absenceTypeId) throw new BadRequestException('Informe o motivo da ausência')
    if (row.kind === 'TIME_WINDOW') {
      if (row.startNotBefore == null && row.endNotAfter == null) throw new BadRequestException('Informe o horário da restrição')
      if (row.startNotBefore != null && row.endNotAfter != null && row.endNotAfter <= row.startNotBefore) {
        throw new BadRequestException('O horário final precisa ser depois do inicial')
      }
    }
  }

  private static snapshot(row: OccurrenceRow): Record<string, unknown> {
    return {
      startDate: dayOf(new Date(row.startDate)), endDate: dayOf(new Date(row.endDate)),
      ...(row.kind === 'ABSENCE' ? { absenceTypeId: row.absenceTypeId } : { startNotBefore: row.startNotBefore, endNotAfter: row.endNotAfter }),
    }
  }
}
