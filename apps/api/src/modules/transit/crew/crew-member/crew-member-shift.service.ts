import { BadRequestException, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { crewMemberShiftSchema, CrewMemberShift, CreateCrewMemberShiftDto, UpdateCrewMemberShiftDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { addDays, dayOf, toDbDate, type Day } from '../../timetabling/plan-validity'

// A crew member's shifts over time — no two at once. A shift starting after the open one closes
// it the day before; anything else overlapping is refused. `db` is the Prisma client or, from the
// crew member import, its transaction's.
type Db = Prisma.TransactionClient

@Injectable()
export class CrewMemberShiftService extends BaseService<CrewMemberShift, CreateCrewMemberShiftDto, UpdateCrewMemberShiftDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'crewMemberShift', crewMemberShiftSchema, 'transit')
  }

  override async create(dto: CreateCrewMemberShiftDto): Promise<CrewMemberShift> {
    const from = dayOf(new Date(dto.validFrom))
    const to   = dto.validTo ? dayOf(new Date(dto.validTo)) : null
    await this.assertShiftOfBranch(dto.crewMemberId, dto.shiftId)
    await this.closeOpenBefore(dto.crewMemberId, from)
    await this.assertNoOverlap(dto.crewMemberId, null, from, to)
    return super.create(dto)
  }

  override async update(id: string, dto: UpdateCrewMemberShiftDto): Promise<CrewMemberShift> {
    const current = await this.findOne(id)
    const from = dayOf(new Date(dto.validFrom ?? current.validFrom))
    const validTo = dto.validTo !== undefined ? dto.validTo : current.validTo
    if (dto.shiftId) await this.assertShiftOfBranch(current.crewMemberId, dto.shiftId)
    await this.assertNoOverlap(current.crewMemberId, id, from, validTo ? dayOf(new Date(validTo)) : null)
    return super.update(id, dto)
  }

  // the crew member's shift from `from` on (CrewMember form, import, Painel de Escala): links
  // starting on/after `from` (one scheduled earlier) are replaced, the open one is closed the day
  // before; the same shift already open is left as it is
  async startShift(crewMemberId: string, shiftId: string, from: Day, db: Db = this.prisma): Promise<void> {
    const open = await db.crewMemberShift.findFirst({ where: { crewMemberId, validTo: null }, select: { shiftId: true, validFrom: true } })
    if (open?.shiftId === shiftId && dayOf(open.validFrom) <= from) return
    await this.assertShiftOfBranch(crewMemberId, shiftId, db)
    await db.crewMemberShift.deleteMany({ where: { crewMemberId, validFrom: { gte: toDbDate(from) } } })
    // the last link left runs up to the day before — open, or closed when a later one was scheduled
    const last = await db.crewMemberShift.findFirst({ where: { crewMemberId }, orderBy: { validFrom: 'desc' }, select: { id: true, validTo: true } })
    if (last && (!last.validTo || dayOf(last.validTo) >= from)) {
      await db.crewMemberShift.update({ where: { id: last.id }, data: { validTo: toDbDate(addDays(from, -1)) } })
    }
    await this.assertNoOverlap(crewMemberId, null, from, null, db)
    await db.crewMemberShift.create({ data: { crewMemberId, shiftId, validFrom: toDbDate(from), validTo: null } })
  }

  // the shift in force on `day`
  async current(crewMemberIds: string[], day: Day, db: Db = this.prisma): Promise<Map<string, { id: string; code: string }>> {
    const rows = await db.crewMemberShift.findMany({
      where:  { crewMemberId: { in: crewMemberIds }, validFrom: { lte: toDbDate(day) }, OR: [{ validTo: null }, { validTo: { gte: toDbDate(day) } }] },
      select: { crewMemberId: true, shift: { select: { id: true, code: true } } },
    })
    return new Map(rows.map(r => [r.crewMemberId, r.shift]))
  }

  private async closeOpenBefore(crewMemberId: string, from: Day, db: Db = this.prisma): Promise<void> {
    const open = await db.crewMemberShift.findFirst({ where: { crewMemberId, validTo: null }, select: { id: true, validFrom: true } })
    if (!open || dayOf(open.validFrom) >= from) return
    await db.crewMemberShift.update({ where: { id: open.id }, data: { validTo: toDbDate(addDays(from, -1)) } })
  }

  private async assertNoOverlap(crewMemberId: string, id: string | null, from: Day, to: Day | null, db: Db = this.prisma): Promise<void> {
    if (to && to < from) throw new BadRequestException('O fim não pode ser antes do início')
    const others = await db.crewMemberShift.findMany({
      where:  { crewMemberId, ...(id ? { id: { not: id } } : {}) },
      select: { validFrom: true, validTo: true },
    })
    const clash = others.find(o => (!to || dayOf(o.validFrom) <= to) && (!o.validTo || dayOf(o.validTo) >= from))
    if (clash) {
      throw new BadRequestException(`Sobrepõe o turno de ${dayOf(clash.validFrom)}${clash.validTo ? ` a ${dayOf(clash.validTo)}` : ' (vigente)'} — ajuste as datas dele`)
    }
  }

  // the shift must be one of the crew member's empresa (CrewShiftBranch)
  private async assertShiftOfBranch(crewMemberId: string, shiftId: string, db: Db = this.prisma): Promise<void> {
    const member = await db.crewMember.findUnique({ where: { id: crewMemberId }, select: { employee: { select: { branchId: true } } } })
    if (!member) throw new BadRequestException('Operador não encontrado')
    const link = await db.crewShiftBranch.findUnique({ where: { shiftId_branchId: { shiftId, branchId: member.employee.branchId } } })
    if (!link) throw new BadRequestException('O turno não é da empresa do operador')
  }
}
