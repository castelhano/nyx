import type { PrismaService } from '../../../prisma/prisma.service'
import { computeBlockRelief } from '../timetabling/crew-plan/relief-points'
import type { CrewCalcBlock } from '../timetabling/crew-plan/crew-scoring.calc'

type Span = { startMinutes: number; endMinutes: number }

// A daily block as the crew calculation reads it (crew-scoring.calc.ts) — the counterpart of
// loadBlockRelief over DailyBlock / DailyBlockEvent. Cancelled trips don't run: they're left out.
export async function loadDailyRelief(prisma: PrismaService, dailyOperationId: string): Promise<Map<string, CrewCalcBlock>> {
  const [blocks, events] = await Promise.all([
    prisma.dailyBlock.findMany({ where: { dailyOperationId }, select: { id: true, branchId: true } }),
    prisma.dailyBlockEvent.findMany({ where: { dailyOperationId, dailyBlockId: { not: null }, isCancelled: false } }),
  ])

  const routeIds = [...new Set(events.map(e => e.routeId).filter((id): id is string => !!id))]
  const stops = routeIds.length
    ? await prisma.routeLocality.findMany({
        where:   { routeId: { in: routeIds } },
        orderBy: { sequence: 'asc' },
        select:  { routeId: true, localityId: true, deltaMinutes: true, allowsCrewChange: true },
      })
    : []
  const stopsByRoute = new Map<string, typeof stops>()
  for (const s of stops) stopsByRoute.set(s.routeId, [...(stopsByRoute.get(s.routeId) ?? []), s])

  const missing = new Map<string, { originId: string; destinationId: string }>()
  for (const list of stopsByRoute.values()) {
    for (let i = 1; i < list.length; i++) {
      const from = list[i - 1].localityId, to = list[i].localityId
      if (list[i].deltaMinutes == null && from && to) missing.set(`${from}:${to}`, { originId: from, destinationId: to })
    }
  }
  const matrix = missing.size
    ? await prisma.travelTimeMatrix.findMany({ where: { OR: [...missing.values()] }, select: { originId: true, destinationId: true, baseMinutes: true } })
    : []
  const matrixMinutes = new Map(matrix.map(m => [`${m.originId}:${m.destinationId}`, m.baseMinutes]))

  const byBlock = new Map<string, typeof events>()
  for (const e of events) byBlock.set(e.dailyBlockId!, [...(byBlock.get(e.dailyBlockId!) ?? []), e])

  const result = new Map<string, CrewCalcBlock>()
  for (const b of blocks) {
    const evs       = byBlock.get(b.id) ?? []
    const trips     = evs.filter(e => e.kind === 'TRIP')
    const deadruns  = evs.filter(e => e.kind === 'DEADRUN')
    const intervals = evs.filter(e => e.kind === 'INTERVAL')
    const relief = computeBlockRelief({
      trips: trips.map(t => ({
        id: t.id, departureMinutes: t.startMinutes, arrivalMinutes: t.endMinutes,
        originLocalityId: t.originLocalityId!, destinationLocalityId: t.destinationLocalityId!,
        stops: t.routeId ? stopsByRoute.get(t.routeId) ?? [] : [],
      })),
      deadruns: deadruns.map(d => ({
        id: d.id, type: d.deadrunType ?? 'DISPLACEMENT', originLocalityId: d.originLocalityId!, destinationLocalityId: d.destinationLocalityId!,
        departureMinutes: d.startMinutes, arrivalMinutes: d.endMinutes,
      })),
      intervals: intervals.map(i => ({ departureMinutes: i.startMinutes, arrivalMinutes: i.endMinutes, bundleId: i.bundleId })),
      matrixMinutes,
    })
    result.set(b.id, {
      id: b.id, branchId: b.branchId, window: relief.window, serviceSpans: relief.serviceSpans, points: relief.points,
      trips:    trips.map(t => ({ id: t.id, departureMinutes: t.startMinutes, arrivalMinutes: t.endMinutes, lineId: t.lineId!, routeId: t.routeId! })),
      deadruns: deadruns.map(d => ({ departureMinutes: d.startMinutes, arrivalMinutes: d.endMinutes })),
      bundles:  bundleWindows(evs),
    })
  }
  return result
}

function bundleWindows(members: { bundleId: string | null; startMinutes: number; endMinutes: number }[]): Span[] {
  const windows = new Map<string, Span>()
  for (const m of members) {
    if (!m.bundleId) continue
    const w = windows.get(m.bundleId)
    windows.set(m.bundleId, w
      ? { startMinutes: Math.min(w.startMinutes, m.startMinutes), endMinutes: Math.max(w.endMinutes, m.endMinutes) }
      : { startMinutes: m.startMinutes, endMinutes: m.endMinutes })
  }
  return [...windows.values()].sort((a, b) => a.startMinutes - b.startMinutes)
}
