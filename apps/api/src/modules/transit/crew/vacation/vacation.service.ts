import { BadRequestException, Injectable } from '@nestjs/common'
import { vacationSchema, type VacationCheck, type VacationLaunch, type VacationRelease, type VacationRow } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { resourceRegistry } from '../../../../core/resource-registry'
import { dayOf, toDbDate } from '../../timetabling/plan-validity'
import { vacationTypeId } from '../crew-absence-type/system-types'
import { CrewOccurrenceService } from '../crew-member/crew-occurrence.service'
import { VacationReleaseService } from './vacation-release.service'

const LIVE = ['REQUESTED', 'APPROVED'] as const
const fmt = (d: Date | string) => dayOf(new Date(d)).split('-').reverse().join('/')
const crewRef = { id: true, employee: { select: { code: true, fullName: true, preferredName: true, branchId: true } } } as const

// Férias: CrewOccurrences of the system type VACATION. Launched several crew members at once
// (the same period, no ferista) or one with his ferista; the list across the empresa.
@Injectable()
export class VacationService {
  constructor(
    private readonly prisma:      PrismaService,
    private readonly occurrences: CrewOccurrenceService,
    private readonly release:     VacationReleaseService,
  ) {
    resourceRegistry.push({ domain: 'transit', resource: 'vacation', schema: vacationSchema })
  }

  async list(q: { branchId?: string; from?: string; to?: string; cover?: string; search?: string }): Promise<VacationRow[]> {
    const typeId = await this.typeId()
    const day = /^\d{4}-\d{2}-\d{2}$/
    const search = q.search?.trim()
    const rows = await this.prisma.crewOccurrence.findMany({
      where: {
        absenceTypeId: typeId, status: { in: [...LIVE] },
        ...(q.to && day.test(q.to) ? { startDate: { lte: toDbDate(q.to) } } : {}),
        ...(q.from && day.test(q.from) ? { endDate: { gte: toDbDate(q.from) } } : {}),
        ...(q.cover === 'with' ? { coverCrewMemberId: { not: null } } : q.cover === 'without' ? { coverCrewMemberId: null } : {}),
        crewMember: {
          employee: {
            ...(q.branchId ? { branchId: q.branchId } : {}),
            ...(search ? { OR: [{ code: { contains: search } }, { fullName: { contains: search, mode: 'insensitive' as const } }, { preferredName: { contains: search, mode: 'insensitive' as const } }] } : {}),
          },
        },
      },
      orderBy: [{ startDate: 'asc' }],
      take:    1000,
      select:  { id: true, startDate: true, endDate: true, status: true, notes: true, crewMember: { select: crewRef }, coverCrewMember: { select: crewRef } },
    })
    return rows.map(r => ({
      id: r.id, startDate: dayOf(r.startDate), endDate: dayOf(r.endDate), status: r.status, notes: r.notes,
      crewMember: { ...ref(r.crewMember), branchId: r.crewMember.employee.branchId },
      cover:      r.coverCrewMember ? ref(r.coverCrewMember) : null,
    }))
  }

  // Alerts: a ferista of another shift than the titular, or absent in the period. Blocks: an
  // absence already in the period (the titular), the ferista covering someone else then.
  async check(dto: Pick<VacationLaunch, 'crewMemberIds' | 'startDate' | 'endDate' | 'coverCrewMemberId'>): Promise<VacationCheck> {
    const warnings: string[] = [], blocked: string[] = []
    const { crewMemberIds, startDate, endDate } = dto
    const cover = dto.coverCrewMemberId || null
    if (!crewMemberIds?.length || !startDate || !endDate) return { warnings, blocked }
    if (endDate < startDate) return { warnings, blocked: ['O fim não pode ser antes do início'] }
    if (cover && crewMemberIds.length > 1) blocked.push('Ferista só com um operador por lançamento')
    if (cover && crewMemberIds.includes(cover)) blocked.push('O ferista não pode ser o próprio operador')
    const overlap = { startDate: { lte: toDbDate(endDate) }, endDate: { gte: toDbDate(startDate) } }

    const clashes = await this.prisma.crewOccurrence.findMany({
      where:  { crewMemberId: { in: crewMemberIds }, kind: 'ABSENCE', status: { in: [...LIVE] }, ...overlap },
      select: { startDate: true, endDate: true, absenceType: { select: { name: true } }, crewMember: { select: crewRef } },
    })
    for (const c of clashes) blocked.push(`${c.crewMember.employee.code}: já há ${c.absenceType?.name ?? 'ausência'} em ${fmt(c.startDate)} a ${fmt(c.endDate)}`)

    if (cover) {
      const [covering, away, shifts] = await Promise.all([
        this.prisma.crewOccurrence.findFirst({
          where:  { coverCrewMemberId: cover, status: { in: [...LIVE] }, ...overlap },
          select: { startDate: true, endDate: true, crewMember: { select: crewRef } },
        }),
        this.prisma.crewOccurrence.findMany({
          where:  { crewMemberId: cover, kind: 'ABSENCE', status: { in: [...LIVE] }, ...overlap },
          select: { startDate: true, endDate: true, absenceType: { select: { name: true } } },
        }),
        this.prisma.crewMemberShift.findMany({
          where:  { crewMemberId: { in: [cover, crewMemberIds[0]] }, validFrom: { lte: toDbDate(startDate) }, OR: [{ validTo: null }, { validTo: { gte: toDbDate(startDate) } }] },
          select: { crewMemberId: true, shift: { select: { id: true, code: true } } },
        }),
      ])
      if (covering) blocked.push(`O ferista já cobre as férias de ${covering.crewMember.employee.code} (${fmt(covering.startDate)} a ${fmt(covering.endDate)})`)
      for (const a of away) warnings.push(`Ferista ausente (${a.absenceType?.name ?? 'ausência'}) em ${fmt(a.startDate)} a ${fmt(a.endDate)}`)
      const titular = shifts.find(s => s.crewMemberId === crewMemberIds[0])?.shift
      const mine    = shifts.find(s => s.crewMemberId === cover)?.shift
      if (titular && mine && titular.id !== mine.id) warnings.push(`Ferista de outro turno (${mine.code}; o operador é do ${titular.code})`)
      if (titular && !mine) warnings.push('Ferista sem turno na data')
    }
    return { warnings, blocked }
  }

  // one occurrence per crew member, approved; the days already generated are released (to the
  // ferista when he can take them)
  async launch(dto: VacationLaunch, userId?: string): Promise<{ created: number } & VacationRelease> {
    const { blocked } = await this.check(dto)
    if (blocked.length) throw new BadRequestException(blocked.join(' · '))
    const absenceTypeId = await this.typeId()
    let released = 0, covered = 0
    for (const crewMemberId of dto.crewMemberIds) {
      const created = await this.occurrences.createAs({
        crewMemberId, kind: 'ABSENCE', absenceTypeId,
        startDate: new Date(dto.startDate), endDate: new Date(dto.endDate),
        status: 'APPROVED', origin: 'STAFF', notes: dto.notes,
        coverCrewMemberId: dto.crewMemberIds.length === 1 ? dto.coverCrewMemberId ?? null : null,
      }, userId, { release: false })
      const r = await this.release.release(created.id, userId)
      released += r.released
      covered  += r.covered
    }
    return { created: dto.crewMemberIds.length, released, covered }
  }

  private async typeId(): Promise<string> {
    const id = await vacationTypeId(this.prisma)
    if (!id) throw new BadRequestException('Tipo de ausência "Férias" não encontrado — rode as migrations')
    return id
  }
}

const ref = (m: { id: string; employee: { code: string; fullName: string; preferredName: string | null } }) =>
  ({ id: m.id, code: m.employee.code, name: m.employee.preferredName || m.employee.fullName })
