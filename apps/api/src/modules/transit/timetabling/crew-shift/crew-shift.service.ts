import { BadRequestException, Injectable } from '@nestjs/common'
import { crewShiftSchema, SHIFT_BAND_KEYS, CrewShift, CreateCrewShiftDto, UpdateCrewShiftDto } from '@nyx/schemas'
import type { PaginatedResult, PaginationQuery } from '@nyx/types'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class CrewShiftService extends BaseService<CrewShift, CreateCrewShiftDto, UpdateCrewShiftDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'crewShift', crewShiftSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ code: stringContains(search) }, { name: stringContains(search) }] }
  }

  private async branchesByShift(shiftIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    if (!shiftIds.length) return map
    const rows = await this.prisma.crewShiftBranch.findMany({ where: { shiftId: { in: shiftIds } }, select: { shiftId: true, branchId: true } })
    for (const r of rows) map.set(r.shiftId, [...(map.get(r.shiftId) ?? []), r.branchId])
    return map
  }

  override async findAll(query: PaginationQuery): Promise<PaginatedResult<CrewShift>> {
    const result = await super.findAll(query)
    const map = await this.branchesByShift(result.data.map(s => s.id))
    return { ...result, data: result.data.map(s => ({ ...s, branchIds: map.get(s.id) ?? [] })) }
  }

  override async findOne(id: string): Promise<CrewShift> {
    const shift = await super.findOne(id)
    const map = await this.branchesByShift([id])
    return { ...shift, branchIds: map.get(id) ?? [] }
  }

  override async create(input: CreateCrewShiftDto): Promise<CrewShift> {
    const { branchIds, ...dto } = input
    this.assertBands(dto)
    this.assertBranches(branchIds)
    const created = await super.create(dto as CreateCrewShiftDto)
    await this.setBranches(created.id, branchIds)
    return this.findOne(created.id)
  }

  override async update(id: string, input: UpdateCrewShiftDto): Promise<CrewShift> {
    const { branchIds, ...dto } = input
    const current = await this.findOne(id)
    this.assertBands({ ...current, ...dto })
    if (branchIds !== undefined) this.assertBranches(branchIds)
    await super.update(id, dto)
    if (branchIds !== undefined) await this.setBranches(id, branchIds)
    return this.findOne(id)
  }

  private async setBranches(shiftId: string, branchIds: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.crewShiftBranch.deleteMany({ where: { shiftId } }),
      this.prisma.crewShiftBranch.createMany({ data: [...new Set(branchIds)].map(branchId => ({ shiftId, branchId })) }),
    ])
  }

  private assertBranches(branchIds: string[] | undefined): void {
    if (!branchIds?.length) throw new BadRequestException('Selecione ao menos uma empresa')
  }

  // floor ≤ idealMin ≤ idealMax ≤ ceiling, for the start and the end windows
  private assertBands(s: Record<string, unknown>): void {
    for (const [label, keys] of [['início', SHIFT_BAND_KEYS[0]], ['término', SHIFT_BAND_KEYS[1]]] as const) {
      const v = keys.map(k => Number(s[k]))
      if (v.some(n => Number.isNaN(n))) throw new BadRequestException(`Preencha todos os horários de ${label}`)
      if (v[0] > v[1] || v[1] > v[2] || v[2] > v[3]) {
        throw new BadRequestException(`Horários de ${label} fora de ordem — mínimo ≤ ideal de ≤ ideal até ≤ máximo`)
      }
    }
  }
}
