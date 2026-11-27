import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  vehiclePlanGoalSchema, buildGoalContext, suggestGoalLevers, evaluateGoal, lineVehicleCapacity,
  type VehiclePlanGoal, type GoalContext, type GoalLever, type GoalEvaluation,
  type GoalBlockInput, type GoalLineInput, type LineGenMetrics, type LineVehicleTypes,
} from '@nyx/schemas'
import { PrismaService } from '../../../../../prisma/prisma.service'
import { VehiclePlanService } from '../vehicle-plan.service'

export interface GoalOptions {
  plan:     { id: string; description: string | null; status: string; dayTypeName: string }
  lines:    { lineId: string; code: string; name: string }[]
  branches: { id: string; name: string; abbr: string }[]
}

export interface GoalAnalysis {
  goal:       VehiclePlanGoal
  context:    GoalContext
  levers:     GoalLever[]
  evaluation: GoalEvaluation
}

// Goal planning (docs/proposal/plan_goal_planning_v1.md) — etapa 1: reads the plan, builds the
// analysis context and the suggested levers. Nothing is written.
@Injectable()
export class VehiclePlanGoalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans:  VehiclePlanService,
  ) {}

  // what the goal form offers: the plan's lines and its scope's empresas
  async options(planId: string): Promise<GoalOptions> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: {
        id: true, description: true, status: true,
        dayType: { select: { name: true } },
        lines:   { select: { lineId: true, line: { select: { code: true, name: true } } } },
        scope:   { select: { operators: { select: { branchId: true, abbr: true, branch: { select: { name: true } } } } } },
      },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    return {
      plan:     { id: plan.id, description: plan.description, status: plan.status, dayTypeName: plan.dayType.name },
      lines:    plan.lines
        .map(l => ({ lineId: l.lineId, code: l.line.code, name: l.line.name }))
        .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })),
      branches: plan.scope.operators
        .map(o => ({ id: o.branchId, name: o.branch.name, abbr: o.abbr }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    }
  }

  async analyze(planId: string, body: unknown): Promise<GoalAnalysis> {
    const parsed = vehiclePlanGoalSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => i.message))
    const goal = parsed.data

    const [plan, blocks, { settings }] = await Promise.all([
      this.prisma.vehiclePlan.findUnique({
        where:  { id: planId },
        select: {
          dayTypeId:     true,
          baseDayTypeId: true,
          dayType:       { select: { code: true } },
          baseDayType:   { select: { code: true } },
          lines: { select: { lineId: true, isDrifted: true, line: { select: { code: true, metrics: true, vehicleTypes: true } } } },
        },
      }),
      this.prisma.vehicleBlock.findMany({
        where:  { vehiclePlanId: planId },
        select: {
          id: true, branchId: true, constraints: true,
          blockTrips: { select: { trip: { select: {
            departureMinutes: true, arrivalMinutes: true, bundleId: true,
            route: { select: { lineId: true, direction: true } },
          } } } },
        },
      }),
      this.plans.resolveSettings(planId),
    ])
    if (!plan) throw new NotFoundException('VehiclePlan not found')

    const lineIds = plan.lines.map(l => l.lineId)
    const dayTypeIds = [plan.dayTypeId, ...(plan.baseDayTypeId ? [plan.baseDayTypeId] : [])]
    const requirements = await this.prisma.lineServiceRequirement.findMany({
      where:  { lineId: { in: lineIds }, dayTypeId: { in: dayTypeIds } },
      select: { lineId: true, dayTypeId: true, direction: true, label: true, earliestMinutes: true, latestMinutes: true },
    })

    const lockedTrips  = new Map<string, number>()
    const bundledTrips = new Map<string, number>()
    const blockInputs: GoalBlockInput[] = blocks.map(b => {
      const locked = !!(b.constraints as { locked?: boolean } | null)?.locked
      return {
        id:       b.id,
        branchId: b.branchId,
        trips:    b.blockTrips.map(({ trip }) => {
          const lineId = trip.route.lineId
          if (locked)        lockedTrips.set(lineId, (lockedTrips.get(lineId) ?? 0) + 1)
          if (trip.bundleId) bundledTrips.set(lineId, (bundledTrips.get(lineId) ?? 0) + 1)
          return { lineId, direction: trip.route.direction, departureMinutes: trip.departureMinutes, arrivalMinutes: trip.arrivalMinutes }
        }),
      }
    })

    const planCode = plan.dayType.code
    const baseCode = plan.baseDayType?.code ?? null

    const lineInputs: GoalLineInput[] = plan.lines.map(pl => {
      const metrics = pl.line.metrics as LineGenMetrics | null
      // a special plan reads its base day type's data while the line has none of its own
      const hasOwn = !!(metrics?.windows?.[planCode] || metrics?.demand?.[planCode])
      const useBase = !hasOwn && !!baseCode
      const dayTypeCode = useBase && baseCode ? baseCode : planCode
      const reqDayTypeId = useBase ? plan.baseDayTypeId : plan.dayTypeId
      return {
        lineId:       pl.lineId,
        code:         pl.line.code,
        metrics,
        dayTypeCode,
        capacity:     lineVehicleCapacity(settings.vehicleCapacity, (pl.line.vehicleTypes as LineVehicleTypes | null)?.preferred),
        requirements: requirements
          .filter(r => r.lineId === pl.lineId && r.dayTypeId === reqDayTypeId)
          .map(r => ({ label: r.label, direction: r.direction, earliestMinutes: r.earliestMinutes, latestMinutes: r.latestMinutes })),
        lockedTrips:  lockedTrips.get(pl.lineId) ?? 0,
        bundledTrips: bundledTrips.get(pl.lineId) ?? 0,
        isDrifted:    pl.isDrifted,
      }
    })

    const context = buildGoalContext(blockInputs, lineInputs, { demandMatch: settings.line.demandMatch, maxGap: settings.line.maxGap })
    const levers  = suggestGoalLevers(context, goal)
    return { goal, context, levers, evaluation: evaluateGoal(context, goal, levers) }
  }
}
