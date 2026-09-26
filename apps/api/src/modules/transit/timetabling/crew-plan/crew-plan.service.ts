import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  crewPlanSchema, crewSettingsSchema,
  CrewPlan, CreateCrewPlanDto, UpdateCrewPlanDto, CrewSettings,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { TransitCrewConfigService } from '../../settings/transit-crew-config.service'

@Injectable()
export class CrewPlanService extends BaseService<CrewPlan, CreateCrewPlanDto, UpdateCrewPlanDto> {
  constructor(
    prisma: PrismaService,
    private readonly crewConfig: TransitCrewConfigService,
  ) {
    super(prisma, 'crewPlan', crewPlanSchema, 'transit')
  }

  // status/validity only change through activation; summary/settings/constraints/generatedAt
  // have their own endpoints (or the solver) — a generic POST/PATCH must not write them.
  private static stripManaged(dto: Record<string, unknown>) {
    const {
      status: _s, validFrom: _vf, validTo: _vt, summary: _sm, settings: _st,
      constraints: _c, generatedAt: _g, ...rest
    } = dto
    return rest
  }

  override async create(dto: CreateCrewPlanDto): Promise<CrewPlan> {
    const data = CrewPlanService.stripManaged(dto)
    const vehiclePlan = await this.prisma.vehiclePlan.findUnique({
      where: { id: typeof data.vehiclePlanId === 'string' ? data.vehiclePlanId : '' }, select: { id: true },
    })
    if (!vehiclePlan) throw new BadRequestException('Planejamento de veículos não encontrado')
    return super.create(data as CreateCrewPlanDto)
  }

  override async update(id: string, dto: UpdateCrewPlanDto): Promise<CrewPlan> {
    const { vehiclePlanId: _vp, ...rest } = CrewPlanService.stripManaged(dto)
    return super.update(id, rest)
  }

  override async remove(id: string): Promise<void> {
    const plan = await this.prisma.crewPlan.findUnique({ where: { id }, select: { status: true } })
    if (plan?.status === 'ACTIVE') throw new BadRequestException('Escala ativa não pode ser excluída')
    return super.remove(id)
  }

  // ── settings ───────────────────────────────────────────────────────────────
  // CrewPlan.settings (full snapshot) ?? Settings(transit.crew, Scope) ?? global

  async resolveSettings(crewPlanId: string): Promise<{ settings: CrewSettings; isCustom: boolean }> {
    const plan = await this.prisma.crewPlan.findUnique({
      where:  { id: crewPlanId },
      select: { settings: true, vehiclePlan: { select: { scopeId: true } } },
    })
    if (!plan) throw new NotFoundException('crewPlan not found')
    if (plan.settings) return { settings: crewSettingsSchema.parse(plan.settings), isCustom: true }
    return { settings: await this.crewConfig.get(plan.vehiclePlan.scopeId), isCustom: false }
  }

  // "Customize": stores a full copy of the effective settings (Scope/global) in the plan
  async customizeSettings(id: string): Promise<{ settings: CrewSettings; isCustom: boolean }> {
    const { settings } = await this.resolveSettings(id)
    await this.prisma.crewPlan.update({ where: { id }, data: { settings } })
    return { settings, isCustom: true }
  }

  async putSettings(id: string, dto: unknown): Promise<{ settings: CrewSettings; isCustom: boolean }> {
    await this.findOne(id)
    const parsed = crewSettingsSchema.safeParse(dto)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
    await this.prisma.crewPlan.update({ where: { id }, data: { settings: parsed.data } })
    return { settings: parsed.data, isCustom: true }
  }

  // "Restore default": goes back to inheriting Scope/global live
  async resetSettings(id: string): Promise<{ settings: CrewSettings; isCustom: boolean }> {
    await this.findOne(id)
    await this.prisma.crewPlan.update({ where: { id }, data: { settings: Prisma.DbNull } })
    return this.resolveSettings(id)
  }
}
