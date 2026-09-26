import { BadRequestException, Injectable } from '@nestjs/common'
import { dutySchema, Duty, CreateDutyDto, UpdateDutyDto, CrewRole } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { CrewPlanService } from './crew-plan.service'

@Injectable()
export class DutyService extends BaseService<Duty, CreateDutyDto, UpdateDutyDto> {
  constructor(
    prisma: PrismaService,
    private readonly crewPlans: CrewPlanService,
  ) {
    super(prisma, 'duty', dutySchema, 'transit')
  }

  // summary/isStale/issues/hasIssues are derived (scoring + VehiclePlan integration);
  // constraints belongs to the solver — none of them come from the client.
  private static stripManaged(dto: Record<string, unknown>) {
    const { summary: _s, isStale: _st, issues: _i, hasIssues: _h, constraints: _c, ...rest } = dto
    return rest
  }

  private async nextDutyNumber(crewPlanId: string, role: CrewRole): Promise<number> {
    const agg = await this.prisma.duty.aggregate({ where: { crewPlanId, role }, _max: { dutyNumber: true } })
    return (agg._max.dutyNumber ?? 0) + 1
  }

  override async create(dto: CreateDutyDto): Promise<Duty> {
    const data = DutyService.stripManaged(dto)
    const crewPlanId = typeof data.crewPlanId === 'string' ? data.crewPlanId : ''
    const plan = await this.prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { id: true } })
    if (!plan) throw new BadRequestException('Escala não encontrada')
    const role = (data.role as CrewRole | undefined) ?? 'DRIVER'
    if (data.dutyNumber == null || data.dutyNumber === '') data.dutyNumber = await this.nextDutyNumber(crewPlanId, role)
    const created = await super.create(data as CreateDutyDto)
    await this.crewPlans.recalculate(crewPlanId)
    return this.findOne(created.id)
  }

  override async update(id: string, dto: UpdateDutyDto): Promise<Duty> {
    const { crewPlanId: _cp, ...data } = DutyService.stripManaged(dto)
    const current = await this.prisma.duty.findUnique({ where: { id }, select: { crewPlanId: true, role: true } })
    // role changed without a number → next free number in the new role
    if (current && data.role && data.role !== current.role && (data.dutyNumber == null || data.dutyNumber === '')) {
      data.dutyNumber = await this.nextDutyNumber(current.crewPlanId, data.role as CrewRole)
    }
    const updated = await super.update(id, data)
    if (current) {
      await this.crewPlans.recalculate(current.crewPlanId)
      return this.findOne(id)
    }
    return updated
  }

  override async remove(id: string): Promise<void> {
    const current = await this.prisma.duty.findUnique({ where: { id }, select: { crewPlanId: true } })
    await super.remove(id)
    if (current) await this.crewPlans.recalculate(current.crewPlanId)
  }
}
