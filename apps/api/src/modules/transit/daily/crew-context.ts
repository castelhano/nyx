import type { DailyCrewContext, DailyCrewRest, RestCycle } from '@nyx/schemas'
import type { PrismaService } from '../../../prisma/prisma.service'

// DailyOperation.crewContext: the rest cycle each crew member's roster of the day was generated
// with. The day's checks judge him by it instead of his current settings, so a later change of his
// rest group (Painel de Escala, crew member form) only reaches the days generated after it.

export interface DayRest { pattern: RestCycle | null; offset: number }

// the rest he was generated with on the day — null: not part of a generation that wrote the day
export function generatedRest(crewContext: unknown, crewMemberId: string): DailyCrewRest | null {
  for (const byMember of Object.values((crewContext ?? {}) as DailyCrewContext)) {
    const rest = byMember?.[crewMemberId]
    if (rest) return rest
  }
  return null
}

// the rest patterns the given contexts point at
export async function loadContextCycles(prisma: PrismaService, contexts: unknown[]): Promise<Map<string, RestCycle>> {
  const ids = new Set<string>()
  for (const ctx of contexts) {
    for (const byMember of Object.values((ctx ?? {}) as DailyCrewContext)) {
      for (const rest of Object.values(byMember ?? {})) if (rest.restPatternId) ids.add(rest.restPatternId)
    }
  }
  if (!ids.size) return new Map()
  const rows = await prisma.restPattern.findMany({ where: { id: { in: [...ids] } }, select: { id: true, pattern: true, anchorDate: true, offOnHolidays: true } })
  return new Map(rows.map(r => [r.id, r]))
}

// what the day judges him by: the generated rest when there is one, else his current one
export function restOfDay(crewContext: unknown, crewMemberId: string, cycles: Map<string, RestCycle>, current: DayRest): DayRest {
  const rest = generatedRest(crewContext, crewMemberId)
  if (!rest) return current
  return { pattern: rest.restPatternId ? cycles.get(rest.restPatternId) ?? null : null, offset: rest.restOffset }
}
