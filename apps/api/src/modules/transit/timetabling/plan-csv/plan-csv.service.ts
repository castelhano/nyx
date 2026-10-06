import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import { PLAN_CSV_MODELS, type PlanCsvFile, type PlanCsvModel } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { loadPlanCsv } from './plan-csv.loader'
import { dutyDetailed, dutySummary, vehicleDetailed, vehicleSummary } from './plan-csv.layouts'

const modelSchema = z.enum(PLAN_CSV_MODELS)
const viewSchema  = z.enum(['vehicles', 'duties'])

const SUFFIX: Record<PlanCsvModel, string> = { DETAILED: 'detalhado', SUMMARY: 'resumo' }

@Injectable()
export class PlanCsvService {
  constructor(private readonly prisma: PrismaService) {}

  private model(value: unknown): PlanCsvModel {
    const parsed = modelSchema.safeParse(value)
    if (!parsed.success) throw new BadRequestException('Modelo de exportação inválido')
    return parsed.data
  }

  // Exportar Plano — the vehicles, with the drivers of the plan's ACTIVE crew plan (if any)
  async vehiclePlan(vehiclePlanId: string, model: unknown): Promise<PlanCsvFile> {
    const m = this.model(model)
    const crewPlan = await this.prisma.crewPlan.findFirst({ where: { vehiclePlanId, status: 'ACTIVE' }, select: { id: true } })
    const data = await loadPlanCsv(this.prisma, vehiclePlanId, crewPlan?.id ?? null)
    const file = m === 'DETAILED' ? vehicleDetailed(data.blocks, data.duties) : vehicleSummary(data.blocks, data.duties)
    return { filename: `${data.name}-carros-${SUFFIX[m]}`, ...file }
  }

  // Exportar Escala — the duties, or the vehicles with this crew plan's drivers
  async crewPlan(crewPlanId: string, model: unknown, view: unknown): Promise<PlanCsvFile> {
    const m = this.model(model)
    const v = viewSchema.safeParse(view ?? 'duties')
    if (!v.success) throw new BadRequestException('Visão de exportação inválida')

    const plan = await this.prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { vehiclePlanId: true } })
    if (!plan) throw new NotFoundException('crewPlan not found')
    const data = await loadPlanCsv(this.prisma, plan.vehiclePlanId, crewPlanId)

    if (v.data === 'vehicles') {
      const file = m === 'DETAILED' ? vehicleDetailed(data.blocks, data.duties) : vehicleSummary(data.blocks, data.duties)
      return { filename: `${data.name}-carros-${SUFFIX[m]}`, ...file }
    }
    const file = m === 'DETAILED' ? dutyDetailed(data.duties, data.blocks) : dutySummary(data.duties, data.blocks)
    return { filename: `${data.name}-tabelas-${SUFFIX[m]}`, ...file }
  }
}
