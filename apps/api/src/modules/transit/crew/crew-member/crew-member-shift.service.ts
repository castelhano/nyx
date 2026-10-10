import { BadRequestException, Injectable } from '@nestjs/common'
import { crewMemberShiftSchema, CrewMemberShift, CreateCrewMemberShiftDto, UpdateCrewMemberShiftDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { addDays, dayOf, toDbDate, type Day } from '../../timetabling/plan-validity'

// A crew member's shifts over time — no two at once. A shift starting after the open one closes
// it the day before; anything else overlapping is refused.
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

  // the crew member's shift from `from` on (CrewMember form): the open one is closed the day
  // before; the same shift already open is left as it is
  async startShift(crewMemberId: string, shiftId: string, from: Day): Promise<void> {
    const open = await this.prisma.crewMemberShift.findFirst({ where: { crewMemberId, validTo: null }, select: { shiftId: true } })
    if (open?.shiftId === shiftId) return
    await this.create({ crewMemberId, shiftId, validFrom: toDbDate(from), validTo: null })
  }

  // the shift in force on `day`
  async current(crewMemberIds: string[], day: Day): Promise<Map<string, { id: string; code: string }>> {
    const rows = await this.prisma.crewMemberShift.findMany({
      where:  { crewMemberId: { in: crewMemberIds }, validFrom: { lte: toDbDate(day) }, OR: [{ validTo: null }, { validTo: { gte: toDbDate(day) } }] },
      select: { crewMemberId: true, shift: { select: { id: true, code: true } } },
    })
    return new Map(rows.map(r => [r.crewMemberId, r.shift]))
  }

  private async closeOpenBefore(crewMemberId: string, from: Day): Promise<void> {
    const open = await this.prisma.crewMemberShift.findFirst({ where: { crewMemberId, validTo: null }, select: { id: true, validFrom: true } })
    if (!open || dayOf(open.validFrom) >= from) return
    await this.prisma.crewMemberShift.update({ where: { id: open.id }, data: { validTo: toDbDate(addDays(from, -1)) } })
  }

  private async assertNoOverlap(crewMemberId: string, id: string | null, from: Day, to: Day | null): Promise<void> {
    if (to && to < from) throw new BadRequestException('O fim não pode ser antes do início')
    const others = await this.prisma.crewMemberShift.findMany({
      where:  { crewMemberId, ...(id ? { id: { not: id } } : {}) },
      select: { validFrom: true, validTo: true },
    })
    const clash = others.find(o => (!to || dayOf(o.validFrom) <= to) && (!o.validTo || dayOf(o.validTo) >= from))
    if (clash) {
      throw new BadRequestException(`Sobrepõe o turno de ${dayOf(clash.validFrom)}${clash.validTo ? ` a ${dayOf(clash.validTo)}` : ' (vigente)'} — ajuste as datas dele`)
    }
  }

  // the shift must be one of the crew member's empresa (CrewShiftBranch)
  private async assertShiftOfBranch(crewMemberId: string, shiftId: string): Promise<void> {
    const member = await this.prisma.crewMember.findUnique({ where: { id: crewMemberId }, select: { employee: { select: { branchId: true } } } })
    if (!member) throw new BadRequestException('Condutor não encontrado')
    const link = await this.prisma.crewShiftBranch.findUnique({ where: { shiftId_branchId: { shiftId, branchId: member.employee.branchId } } })
    if (!link) throw new BadRequestException('O turno não é da empresa do condutor')
  }
}
