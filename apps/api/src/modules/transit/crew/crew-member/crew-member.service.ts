import { BadRequestException, Injectable } from '@nestjs/common'
import { crewMemberSchema, CrewMember, CreateCrewMemberDto, UpdateCrewMemberDto } from '@nyx/schemas'
import type { PaginatedResult, PaginationQuery } from '@nyx/types'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import { localToday } from '../../timetabling/plan-validity'
import { CrewMemberShiftService } from './crew-member-shift.service'

// displayName, branchId (with `branch`) and shiftId (with `shift`) are computed — see
// crew-member.schema.ts; shiftId written here starts a new CrewMemberShift today.
@Injectable()
export class CrewMemberService extends BaseService<CrewMember, CreateCrewMemberDto, UpdateCrewMemberDto> {
  constructor(
    prisma: PrismaService,
    private readonly shifts: CrewMemberShiftService,
  ) {
    super(prisma, 'crewMember', crewMemberSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { employee: { OR: [{ fullName: stringContains(search) }, { code: stringContains(search) }] } }
  }

  private async withComputed(rows: CrewMember[]): Promise<CrewMember[]> {
    if (!rows.length) return rows
    const [employees, shifts] = await Promise.all([
      this.prisma.employee.findMany({
        where:  { id: { in: rows.map(r => r.employeeId) } },
        select: { id: true, code: true, fullName: true, branch: { select: { id: true, name: true } } },
      }),
      this.shifts.current(rows.map(r => r.id), localToday()),
    ])
    const byId = new Map(employees.map(e => [e.id, e]))
    return rows.map(r => {
      const e = byId.get(r.employeeId)
      const shift = shifts.get(r.id) ?? null
      return {
        ...r,
        displayName: e ? `${e.code} — ${e.fullName}` : undefined,
        branchId:    e?.branch.id,
        branch:      e?.branch,
        shiftId:     shift?.id,
        shift,
      } as CrewMember
    })
  }

  override async findAll(query: PaginationQuery): Promise<PaginatedResult<CrewMember>> {
    const result = await super.findAll(query)
    return { ...result, data: await this.withComputed(result.data) }
  }

  override async findOne(id: string): Promise<CrewMember> {
    const [row] = await this.withComputed([await super.findOne(id)])
    return row
  }

  override async create(dto: CreateCrewMemberDto): Promise<CrewMember> {
    if (!dto.shiftId) throw new BadRequestException('Informe o turno do condutor')
    const taken = await this.prisma.crewMember.findUnique({ where: { employeeId: dto.employeeId }, select: { id: true } })
    if (taken) throw new BadRequestException('Este funcionário já tem cadastro de condutor')
    const created = await super.create(dto)
    try {
      await this.shifts.startShift(created.id, dto.shiftId, localToday())
    } catch (e) {
      // the shift is part of the creation — no crew member left behind without one
      await this.prisma.crewMember.delete({ where: { id: created.id } })
      throw e
    }
    return this.findOne(created.id)
  }

  override async update(id: string, dto: UpdateCrewMemberDto): Promise<CrewMember> {
    const { employeeId: _employee, ...rest } = dto
    await super.update(id, rest)
    if (dto.shiftId) await this.shifts.startShift(id, dto.shiftId, localToday())
    return this.findOne(id)
  }
}
