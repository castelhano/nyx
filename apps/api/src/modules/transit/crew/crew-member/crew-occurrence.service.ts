import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { crewOccurrenceSchema, restPatternWorks, CrewOccurrence, CreateCrewOccurrenceDto, UpdateCrewOccurrenceDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { addDays, dayOf, toDbDate, type Day } from '../../timetabling/plan-validity'
import { vacationTypeId } from '../crew-absence-type/system-types'
import { VacationReleaseService } from '../vacation/vacation-release.service'

type OccurrenceRow = {
  kind: string; absenceTypeId?: string | null; startDate: Date | string; endDate: Date | string
  startNotBefore?: number | null; endNotAfter?: number | null; status?: string; origin?: string
  coverCrewMemberId?: string | null
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
  occurrences: (CrewOccurrence & { absenceType: { name: string } | null; cover: CrewRef | null })[]
  // férias of others this crew member covers (ferista), approved, newest first
  covering: { id: string; startDate: Date; endDate: Date; crewMember: CrewRef }[]
  absenceTypes: { id: string; name: string; systemKey: string | null }[]
}

type CrewRef = { id: string; code: string; name: string }
const crewRef = { id: true, employee: { select: { code: true, fullName: true, preferredName: true } } } as const
const toRef = (m: { id: string; employee: { code: string; fullName: string; preferredName: string | null } }): CrewRef =>
  ({ id: m.id, code: m.employee.code, name: m.employee.preferredName || m.employee.fullName })

// Absences and one-off time windows of a crew member, through the staff screens. A request
// (STAFF_ON_BEHALF here; PORTAL comes from the crew portal) keeps what was asked. Only the portal
// limits a request to one day — launched here it may span several.
@Injectable()
export class CrewOccurrenceService extends BaseService<CrewOccurrence, CreateCrewOccurrenceDto, UpdateCrewOccurrenceDto> {
  constructor(prisma: PrismaService, private readonly vacations: VacationReleaseService) {
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
    const [holidays, entries, occurrences, covering, absenceTypes] = await Promise.all([
      this.prisma.holiday.findMany({ where: { date: range, OR: [{ branchId: null }, { branchId: member.employee.branchId }] }, select: { date: true, name: true } }),
      this.prisma.rosterEntry.findMany({ where: { crewMemberId, date: range }, select: { date: true, kind: true } }),
      this.prisma.crewOccurrence.findMany({
        where: { crewMemberId }, orderBy: { startDate: 'desc' }, take: 300,
        include: { absenceType: { select: { name: true } }, coverCrewMember: { select: crewRef } },
      }),
      this.prisma.crewOccurrence.findMany({
        where:   { coverCrewMemberId: crewMemberId, status: 'APPROVED' }, orderBy: { startDate: 'desc' }, take: 50,
        select:  { id: true, startDate: true, endDate: true, crewMember: { select: crewRef } },
      }),
      this.prisma.crewAbsenceType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, systemKey: true } }),
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
    return {
      days, absenceTypes,
      occurrences: occurrences.map(({ coverCrewMember, ...o }) => ({ ...o, cover: coverCrewMember ? toRef(coverCrewMember) : null })) as unknown as CrewCalendar['occurrences'],
      covering:    covering.map(c => ({ ...c, crewMember: toRef(c.crewMember) })),
    }
  }

  // `release: false` — the caller releases the férias days itself
  async createAs(dto: CreateCrewOccurrenceDto, userId: string | undefined, options: { release?: boolean } = {}): Promise<CrewOccurrence> {
    const row = await this.normalized(dto)
    if (row.origin === 'PORTAL') throw new BadRequestException('Solicitações do portal só são criadas pelo próprio operador')
    CrewOccurrenceService.assertValid(row)
    await this.assertNoOverlap(null, dto.crewMemberId, row)
    await this.assertCover(null, dto.crewMemberId, row)
    const request = row.origin === 'STAFF_ON_BEHALF'
    const { requested: _r, createdByUserId: _c, reviewedByUserId: _rb, reviewedAt: _ra, ...data } = row
    const created = await super.create({
      ...data,
      createdByUserId: userId ?? null,
      requested: request ? CrewOccurrenceService.snapshot(row) : null,
      ...(REVIEWED.has(row.status ?? '') ? { reviewedByUserId: userId ?? null, reviewedAt: new Date() } : {}),
    })
    await this.syncDaysOff(created.id)
    if (options.release !== false) await this.vacations.release(created.id, userId)
    return created
  }

  async updateAs(id: string, dto: UpdateCrewOccurrenceDto, userId: string | undefined): Promise<CrewOccurrence> {
    const current = await this.findOne(id)
    // what was asked and who launched it never change; the origin is fixed at creation
    const { requested: _r, createdByUserId: _c, reviewedByUserId: _rb, reviewedAt: _ra, origin: _o, crewMemberId: _m, ...patch } = dto
    const row = await this.normalized({ ...current, ...patch })
    CrewOccurrenceService.assertValid(row)
    await this.assertNoOverlap(id, current.crewMemberId, row)
    await this.assertCover(id, current.crewMemberId, row)
    const statusChanged = patch.status !== undefined && patch.status !== current.status
    const updated = await super.update(id, {
      ...patch,
      kind: row.kind, absenceTypeId: row.absenceTypeId, startNotBefore: row.startNotBefore, endNotAfter: row.endNotAfter,
      coverCrewMemberId: row.coverCrewMemberId ?? null,
      ...(statusChanged && REVIEWED.has(patch.status!) ? { reviewedByUserId: userId ?? null, reviewedAt: new Date() } : {}),
    })
    await this.syncDaysOff(id)
    // approved now, or its period / ferista changed: the days in it are released (again)
    const moved = row.status === 'APPROVED' && (statusChanged || patch.startDate !== undefined || patch.endDate !== undefined || patch.coverCrewMemberId !== undefined)
    if (moved || (row.status === 'APPROVED' && patch.absenceTypeId !== undefined)) await this.vacations.release(id, userId)
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
    // no compensatory day off on a holiday (hour bank)
    if (effect === 'COMP_OFF') for (const h of await holidaysOf(this.prisma, o.crewMemberId, days)) taken.add(h)
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

  // A ferista covers one crew member at a time: never two férias with overlapping periods. He
  // can't be the crew member himself.
  private async assertCover(id: string | null, crewMemberId: string, row: OccurrenceRow): Promise<void> {
    const cover = row.coverCrewMemberId
    if (!cover || !LIVE.includes((row.status ?? 'APPROVED') as typeof LIVE[number])) return
    if (cover === crewMemberId) throw new BadRequestException('O ferista não pode ser o próprio operador')
    const clash = await this.prisma.crewOccurrence.findFirst({
      where: {
        coverCrewMemberId: cover, status: { in: [...LIVE] }, ...(id ? { id: { not: id } } : {}),
        startDate: { lte: new Date(row.endDate) }, endDate: { gte: new Date(row.startDate) },
      },
      select: { startDate: true, endDate: true, crewMember: { select: { employee: { select: { code: true } } } } },
    })
    if (clash) {
      throw new BadRequestException(`O ferista já cobre as férias de ${clash.crewMember.employee.code} (${fmt(clash.startDate)} a ${fmt(clash.endDate)})`)
    }
  }

  // an absence has a reason and no window; a time window has a window and no reason; only férias
  // name a ferista
  private async normalized<D extends OccurrenceRow>(dto: D): Promise<D> {
    const blank = (v: unknown) => v === '' || v == null
    if (dto.kind === 'TIME_WINDOW') {
      return {
        ...dto, absenceTypeId: null, coverCrewMemberId: null,
        startNotBefore: blank(dto.startNotBefore) ? null : Number(dto.startNotBefore),
        endNotAfter:    blank(dto.endNotAfter) ? null : Number(dto.endNotAfter),
      }
    }
    const absenceTypeId = blank(dto.absenceTypeId) ? null : dto.absenceTypeId
    const vacation = !!absenceTypeId && absenceTypeId === await vacationTypeId(this.prisma)
    return {
      ...dto, absenceTypeId, startNotBefore: null, endNotAfter: null,
      coverCrewMemberId: vacation && !blank(dto.coverCrewMemberId) ? dto.coverCrewMemberId : null,
    }
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

const fmt = (d: Date) => dayOf(d).split('-').reverse().join('/')

// the days among `days` that are holidays for the crew member's empresa
async function holidaysOf(prisma: PrismaService, crewMemberId: string, days: string[]): Promise<string[]> {
  const m = await prisma.crewMember.findUnique({ where: { id: crewMemberId }, select: { employee: { select: { branchId: true } } } })
  const rows = await prisma.holiday.findMany({
    where:  { date: { in: days.map(toDbDate) }, OR: [{ branchId: null }, ...(m ? [{ branchId: m.employee.branchId }] : [])] },
    select: { date: true },
  })
  return rows.map(h => dayOf(h.date))
}
