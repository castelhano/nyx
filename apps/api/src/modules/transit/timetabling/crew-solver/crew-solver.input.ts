import { BadRequestException, NotFoundException } from '@nestjs/common'
import { mealPolicy, type CrewSettings } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { loadBlockRelief } from '../crew-plan/relief-points'
import { loadCrewWalk } from '../crew-plan/crew-walk'
import type { CrewCalcDuty } from '../crew-plan/crew-scoring.calc'
import type { CrewSolverInput, SolverBlock } from './crew-solver.calc'

// Everything solveCrewPlan needs for one crew plan, in a few queries: its VehiclePlan's
// blocks (relief points, trips, deadruns), its locked duties, the meal break type and meal
// stops, and the crew walking distances among the relief points' localities.
export async function loadCrewSolverInput(prisma: PrismaService, crewPlanId: string, settings: CrewSettings): Promise<CrewSolverInput> {
  // the meal type only matters when meal breaks are placed (continuous form, allowed or required)
  const breaks = mealPolicy(settings.mealRule).breaks
  const mealTypeId = breaks ? settings.mealBreakIntervalTypeId : null
  if (breaks && !mealTypeId) {
    throw new BadRequestException('Defina o tipo de intervalo de refeição nas configurações da escala')
  }
  const [plan, mealType] = await Promise.all([
    prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { vehiclePlanId: true } }),
    mealTypeId
      ? prisma.intervalType.findUnique({ where: { id: mealTypeId }, select: { minMinutes: true, maxMinutes: true, isPaid: true } })
      : Promise.resolve(null),
  ])
  if (!plan) throw new NotFoundException('crewPlan not found')
  if (mealTypeId && !mealType) throw new BadRequestException('Tipo de intervalo de refeição não encontrado')

  const [blockRows, lockedRows, mealStops] = await Promise.all([
    prisma.vehicleBlock.findMany({ where: { vehiclePlanId: plan.vehiclePlanId }, select: { id: true } }),
    prisma.duty.findMany({
      where:  { crewPlanId, constraints: { path: ['locked'], equals: true } },
      select: {
        id: true, role: true, kind: true, branchId: true,
        pieces:     { where: { isStale: false }, select: { id: true, vehicleBlockId: true, startMinutes: true, endMinutes: true, startLocalityId: true, endLocalityId: true } },
        activities: { select: { id: true, type: true, intervalTypeId: true, startMinutes: true, endMinutes: true, intervalType: { select: { isPaid: true } } } },
      },
    }),
    prisma.routeLocality.findMany({ where: { allowsMealBreak: true, localityId: { not: null } }, select: { routeId: true, localityId: true } }),
  ])
  const relief = await loadBlockRelief(prisma, blockRows.map(b => b.id))

  const blocks: SolverBlock[] = [...relief.entries()].map(([id, r]) => ({
    id, branchId: r.branchId, window: r.window, serviceSpans: r.serviceSpans, points: r.points, trips: r.trips, deadruns: r.deadruns,
  }))

  const localityIds = [...new Set(blocks.flatMap(b => b.points.map(p => p.localityId)))]
  const walk = await loadCrewWalk(prisma, localityIds)

  const locked: CrewCalcDuty[] = lockedRows.map(d => ({
    id: d.id, role: d.role, kind: d.kind, branchId: d.branchId, pieces: d.pieces,
    activities: d.activities.map(a => ({
      id: a.id, type: a.type, intervalTypeId: a.intervalTypeId, startMinutes: a.startMinutes, endMinutes: a.endMinutes,
      isPaidBreak: a.type === 'BREAK' && !!a.intervalType?.isPaid,
    })),
  }))

  return {
    blocks, locked, settings,
    meal: mealTypeId && mealType ? {
      intervalTypeId: mealTypeId,
      // the type's own range; the CCT meal criterion only scores
      minMinutes: mealType.minMinutes ?? settings.range.mealBreak.floor,
      maxMinutes: mealType.maxMinutes ?? settings.range.mealBreak.ceiling,
      isPaid:     mealType.isPaid,
    } : null,
    mealStops:     new Set(mealStops.map(s => `${s.routeId}:${s.localityId}`)),
    walk,
  }
}
