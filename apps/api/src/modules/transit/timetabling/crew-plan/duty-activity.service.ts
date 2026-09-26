import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  dutyActivitySchema, createDutyActivitySchema,
  DutyActivity, CreateDutyActivityDto, UpdateDutyActivityDto,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { CrewPlanService } from './crew-plan.service'
import { assertTimeWindow, assertNoDutyOverlap } from './duty-occupancy.utils'

@Injectable()
export class DutyActivityService extends BaseService<DutyActivity, CreateDutyActivityDto, UpdateDutyActivityDto> {
  constructor(
    prisma: PrismaService,
    private readonly crewPlans: CrewPlanService,
  ) {
    super(prisma, 'dutyActivity', dutyActivitySchema, 'transit')
  }

  override async create(dto: CreateDutyActivityDto): Promise<DutyActivity> {
    const parsed = createDutyActivitySchema.safeParse(dto)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
    await this.validate(parsed.data)
    const created = await super.create(parsed.data)
    await this.recalculatePlanOf(parsed.data.dutyId)
    return created
  }

  override async update(id: string, dto: UpdateDutyActivityDto): Promise<DutyActivity> {
    const current = await this.prisma.dutyActivity.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('dutyActivity not found')
    const { dutyId: _d, ...patch } = dto as Record<string, unknown>
    const parsed = createDutyActivitySchema.safeParse({ ...current, ...patch, dutyId: current.dutyId })
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
    await this.validate(parsed.data, id)
    const { dutyId: _dd, ...data } = parsed.data
    const updated = await super.update(id, data)
    await this.recalculatePlanOf(current.dutyId)
    return updated
  }

  override async remove(id: string): Promise<void> {
    const current = await this.prisma.dutyActivity.findUnique({ where: { id }, select: { dutyId: true } })
    await super.remove(id)
    if (current) await this.recalculatePlanOf(current.dutyId)
  }

  private async recalculatePlanOf(dutyId: string): Promise<void> {
    const duty = await this.prisma.duty.findUnique({ where: { id: dutyId }, select: { crewPlanId: true } })
    if (duty) await this.crewPlans.recalculate(duty.crewPlanId)
  }

  private async validate(input: CreateDutyActivityDto, activityId?: string): Promise<void> {
    assertTimeWindow(input.startMinutes, input.endMinutes)
    if (input.type === 'BREAK' && !input.intervalTypeId) throw new BadRequestException('Intervalo precisa de um tipo de intervalo')
    const duty = await this.prisma.duty.findUnique({ where: { id: input.dutyId }, select: { id: true } })
    if (!duty) throw new BadRequestException('Jornada não encontrada')
    await assertNoDutyOverlap(this.prisma, input.dutyId, input.startMinutes, input.endMinutes, { activityId })
  }
}
