import type { ShiftWindow } from '@nyx/schemas'
import type { PrismaService } from '../../../../prisma/prisma.service'

// What the crew calculation needs about the operators: their active shifts (CrewShift) and who
// operates each line of the plan (LineOperator) — see CrewCalcContext.shifts / lineOperators.
// Shared by CrewPlanService.recalculate and the crew solver's input.
export async function loadCrewBranchRules(prisma: PrismaService, vehiclePlanId: string): Promise<{
  shifts:        Map<string, ShiftWindow[]>
  lineOperators: Map<string, string[]>
}> {
  const [shiftRows, operatorRows] = await Promise.all([
    prisma.crewShift.findMany({
      where:  { isActive: true },
      select: {
        id: true, priority: true, allowSplit: true, branches: { select: { branchId: true } },
        startFloor: true, startIdealMin: true, startIdealMax: true, startCeiling: true,
        endFloor: true, endIdealMin: true, endIdealMax: true, endCeiling: true,
      },
    }),
    prisma.lineOperator.findMany({
      where:  { line: { planLines: { some: { vehiclePlanId } } } },
      select: { lineId: true, branchId: true },
    }),
  ])
  const shifts = new Map<string, ShiftWindow[]>()
  for (const { branches, ...s } of shiftRows) {
    for (const { branchId } of branches) shifts.set(branchId, [...(shifts.get(branchId) ?? []), s])
  }
  const lineOperators = new Map<string, string[]>()
  for (const r of operatorRows) lineOperators.set(r.lineId, [...(lineOperators.get(r.lineId) ?? []), r.branchId])
  return { shifts, lineOperators }
}
