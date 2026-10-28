import { BadRequestException, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  crewMemberSchema, CrewMember, CreateCrewMemberDto, UpdateCrewMemberDto,
  restGroupFromLabel, restGroupLabel, restGroupOffsets,
} from '@nyx/schemas'
import type { PaginatedResult, PaginationQuery } from '@nyx/types'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import type { ImportOp } from '../../../../core/import/import.engine'
import { localToday } from '../../timetabling/plan-validity'
import { CrewMemberShiftService } from './crew-member-shift.service'

// code, displayName, branchId (with `branch`) and shiftId (with `shift`) are computed — see
// crew-member.schema.ts; shiftId written here starts a new CrewMemberShift today.
@Injectable()
export class CrewMemberService extends BaseService<CrewMember, CreateCrewMemberDto, UpdateCrewMemberDto> {
  constructor(
    prisma: PrismaService,
    private readonly shifts: CrewMemberShiftService,
  ) {
    super(prisma, 'crewMember', crewMemberSchema, 'transit')
  }

  // the role its current contract's job title maps to (CrewRoleJobTitle) — prefills the create form
  async suggestRole(employeeId: string) {
    const contract = await this.prisma.contract.findFirst({
      where:   { employeeId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
      select:  { jobTitle: { select: { crewRole: { select: { role: true } } } } },
    })
    return contract?.jobTitle.crewRole?.role
  }

  protected buildSearchWhere(search: string) {
    return { employee: { OR: [{ fullName: stringContains(search) }, { code: stringContains(search) }] } }
  }

  // code, fullName, preferredName and branchId are the Employee's — AND keeps them clear of the search's `employee`
  protected override buildFilterWhere(query: Record<string, unknown>) {
    const { f_code, f_fullName, f_preferredName, f_branchId, ...rest } = query as Record<string, string | undefined>
    const employee = {
      ...(f_branchId      ? { branchId:      f_branchId }                      : {}),
      ...(f_code          ? { code:          stringContains(f_code) }          : {}),
      ...(f_fullName      ? { fullName:      stringContains(f_fullName) }      : {}),
      ...(f_preferredName ? { preferredName: stringContains(f_preferredName) } : {}),
    }
    return {
      ...super.buildFilterWhere(rest),
      ...(Object.keys(employee).length ? { AND: [{ employee }] } : {}),
    }
  }

  private async withComputed(rows: CrewMember[]): Promise<CrewMember[]> {
    if (!rows.length) return rows
    const [employees, shifts] = await Promise.all([
      this.prisma.employee.findMany({
        where:  { id: { in: rows.map(r => r.employeeId) } },
        select: { id: true, code: true, fullName: true, preferredName: true, branch: { select: { id: true, name: true } } },
      }),
      this.shifts.current(rows.map(r => r.id), localToday()),
    ])
    const byId = new Map(employees.map(e => [e.id, e]))
    return rows.map(r => {
      const e = byId.get(r.employeeId)
      const shift = shifts.get(r.id) ?? null
      return {
        ...r,
        code:          e?.code,
        fullName:      e?.fullName,
        preferredName: e?.preferredName,
        displayName:   e ? `${e.code} — ${e.fullName}` : undefined,
        branchId:      e?.branch.id,
        branch:        e?.branch,
        shiftId:       shift?.id,
        shift,
      } as CrewMember
    })
  }

  override async findAll(query: PaginationQuery): Promise<PaginatedResult<CrewMember>> {
    const result = await super.findAll(query)
    return { ...result, data: await this.withComputed(result.data) }
  }

  // the reference is the Employee's code (not a column here)
  override async lookupByNameField(value: string): Promise<CrewMember | null> {
    const row = await this.prisma.crewMember.findFirst({ where: { employee: { code: value.trim() } }, select: { id: true } })
    return row ? this.findOne(row.id) : null
  }

  override async findOne(id: string): Promise<CrewMember> {
    const [row] = await this.withComputed([await super.findOne(id)])
    return row
  }

  override async create(dto: CreateCrewMemberDto): Promise<CrewMember> {
    if (!dto.shiftId) throw new BadRequestException('Informe o turno do operador')
    const taken = await this.prisma.crewMember.findUnique({ where: { employeeId: dto.employeeId }, select: { id: true } })
    if (taken) throw new BadRequestException('Este funcionário já tem cadastro de operador')
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

  // the import's shift starts today, as in the form; restGroup is the group's letter in the rest
  // pattern — the row's, the crew member's own, or else his shift's
  protected override async importWrite(tx: Prisma.TransactionClient, op: ImportOp): Promise<void> {
    const { shift, restGroup } = op.extra as { shift?: string; restGroup?: string }
    const data    = op.data as Prisma.CrewMemberUncheckedCreateInput
    const current = op.id
      ? await tx.crewMember.findUniqueOrThrow({ where: { id: op.id }, select: { employeeId: true, restPatternId: true } })
      : null

    // the form only offers the empresa's vehicles
    if (data.preferredVehicleId) {
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: current?.employeeId ?? data.employeeId }, select: { branchId: true } })
      const vehicle  = await tx.vehicle.findUniqueOrThrow({ where: { id: data.preferredVehicleId }, select: { branchId: true } })
      if (vehicle.branchId !== employee.branchId) throw new BadRequestException('O carro fixo não é da empresa do operador')
    }
    if (restGroup) {
      const shiftId = shift ?? (op.id ? (await this.shifts.current([op.id], localToday(), tx)).get(op.id)?.id : undefined)
      data.restOffset = await this.restOffsetOf(tx, restGroup, data.restPatternId ?? current?.restPatternId ?? null, shiftId)
    }

    const id = op.id ?? (await tx.crewMember.create({ data, select: { id: true } })).id
    if (op.id) await tx.crewMember.update({ where: { id }, data })
    if (shift) await this.shifts.startShift(id, shift, localToday(), tx)
  }

  private async restOffsetOf(tx: Prisma.TransactionClient, label: string, restPatternId: string | null, shiftId?: string): Promise<number> {
    const patternId = restPatternId
      ?? (shiftId ? (await tx.crewShift.findUnique({ where: { id: shiftId }, select: { restPatternId: true } }))?.restPatternId : null)
    if (!patternId) throw new BadRequestException('Grupo sem regime de folga — informe restPattern ou um turno com regime')
    const pattern = await tx.restPattern.findUniqueOrThrow({ where: { id: patternId }, select: { name: true, pattern: true, staggered: true } })
    const offsets = restGroupOffsets(pattern)
    const index   = restGroupFromLabel(label)
    if (index == null || index >= offsets.length) {
      const range = offsets.length > 1 ? `grupos ${restGroupLabel(0)} a ${restGroupLabel(offsets.length - 1)}` : `só o grupo ${restGroupLabel(0)}`
      throw new BadRequestException(`O regime ${pattern.name} não tem o grupo ${label.toUpperCase()} (${range})`)
    }
    return offsets[index]
  }
}
