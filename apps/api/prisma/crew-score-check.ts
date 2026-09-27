import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { TransitCrewConfigService } from '../src/modules/transit/settings/transit-crew-config.service'
import { CrewPlanService, canonicalJson, repeatsNextDay } from '../src/modules/transit/timetabling/crew-plan/crew-plan.service'
import { computeCrewPlan, evaluateDuty, CrewScoreAggregate, type CrewCalcContext, type CrewCalcDuty } from '../src/modules/transit/timetabling/crew-plan/crew-scoring.calc'
import { loadCrewSolverInput } from '../src/modules/transit/timetabling/crew-solver/crew-solver.input'

// Checks the incremental score (CrewScoreAggregate) against the full calculation, for every crew
// plan in the database:
//  1. computeCrewPlan now = the summaries stored by the last recalculation (score, criteria,
//     issues, coverage) — catches a refactor changing results;
//  2. an aggregate after removing and re-adding random duties = a fresh one over the same duties;
//  3. timing of the full calculation vs one incremental move.
// Usage: pnpm crew:score-check

const EPS = 1e-6

async function main() {
  const prisma    = new PrismaService()
  const crewPlans = new CrewPlanService(prisma, new TransitCrewConfigService(prisma))
  const plans = await prisma.crewPlan.findMany({
    select:  { id: true, description: true, summary: true, vehiclePlan: { select: { dayType: { select: { pattern: true } } } } },
    orderBy: { createdAt: 'asc' },
  })
  let failures = 0
  const fail = (msg: string) => { failures++; console.log(`  ✗ ${msg}`) }

  for (const plan of plans) {
    console.log(`${plan.description ?? plan.id}`)
    const { settings } = await crewPlans.resolveSettings(plan.id)
    if (!settings.mealBreakIntervalTypeId) { console.log('  (sem tipo de refeição — ignorada)'); continue }
    const input = await loadCrewSolverInput(prisma, plan.id, settings)
    const rows  = await prisma.duty.findMany({
      where:  { crewPlanId: plan.id },
      select: {
        id: true, role: true, kind: true, branchId: true, summary: true, issues: true,
        pieces:     { select: { id: true, vehicleBlockId: true, startMinutes: true, endMinutes: true, startLocalityId: true, endLocalityId: true } },
        activities: { select: { id: true, type: true, intervalTypeId: true, startMinutes: true, endMinutes: true, intervalType: { select: { isPaid: true } } } },
      },
    })
    const duties: CrewCalcDuty[] = rows.map(d => ({
      id: d.id, role: d.role, kind: d.kind, branchId: d.branchId, pieces: d.pieces,
      activities: d.activities.map(a => ({
        id: a.id, type: a.type, intervalTypeId: a.intervalTypeId, startMinutes: a.startMinutes, endMinutes: a.endMinutes,
        isPaidBreak: a.type === 'BREAK' && !!a.intervalType?.isPaid,
      })),
    }))
    const repeats   = repeatsNextDay(plan.vehiclePlan.dayType.pattern)
    const calcInput = { settings, blocks: input.blocks, duties, walk: input.walk, mealStops: input.mealStops, repeatsNextDay: repeats }

    // 1. full calculation vs stored
    let t = performance.now()
    const full = computeCrewPlan(calcInput)
    const fullMs = performance.now() - t
    const stored = plan.summary as { score: number; issueDutyCount: number; coveredMinutes: number; criteria?: { key: string; value: number }[] } | null
    if (stored) {
      if (full.summary.score !== stored.score) fail(`score ${full.summary.score} ≠ gravado ${stored.score}`)
      if (full.summary.issueDutyCount !== stored.issueDutyCount) fail(`pendências ${full.summary.issueDutyCount} ≠ gravado ${stored.issueDutyCount}`)
      if (full.summary.coveredMinutes !== stored.coveredMinutes) fail(`cobertura ${full.summary.coveredMinutes} ≠ gravado ${stored.coveredMinutes}`)
      for (const c of stored.criteria ?? []) {
        const now = full.summary.criteria.find(x => x.key === c.key)
        if (!now || Math.abs(now.value - c.value) > EPS) fail(`critério ${c.key} ${now?.value} ≠ gravado ${c.value}`)
      }
    }
    // the matrix here is the full one (solver input) — a duty's issues may differ from the stored
    // ones only where the stored recalculation had no matrix entry; summaries must match
    for (const d of rows) {
      const now = full.duties.get(d.id)!
      if (canonicalJson(now.summary) !== canonicalJson(d.summary)) fail(`resumo da jornada ${d.id} difere do gravado`)
    }

    // 2. incremental aggregate
    const ctx: CrewCalcContext = { settings, blocks: new Map(input.blocks.map(b => [b.id, b])), walk: input.walk, mealStops: input.mealStops, repeatsNextDay: repeats }
    const evs = new Map(duties.map(d => [d.id, evaluateDuty(d, ctx)]))
    const agg = new CrewScoreAggregate(ctx)
    for (const d of duties) agg.add(d, evs.get(d.id)!)
    const exact = agg.score()
    if (Math.round(exact) !== full.summary.score) fail(`agregado ${exact} ≠ cálculo completo ${full.summary.score}`)

    const pick = [...duties].sort(() => Math.random() - 0.5).slice(0, Math.ceil(duties.length / 4))
    t = performance.now()
    for (const d of pick) agg.remove(d, evs.get(d.id)!)
    const afterRemove = agg.score()
    const moveMs = (performance.now() - t) / Math.max(1, pick.length)
    const picked = new Set(pick.map(d => d.id))
    const fresh = new CrewScoreAggregate(ctx)
    for (const d of duties) if (!picked.has(d.id)) fresh.add(d, evs.get(d.id)!)
    if (Math.abs(afterRemove - fresh.score()) > EPS) fail(`após remover ${pick.length}: ${afterRemove} ≠ ${fresh.score()}`)
    for (const d of pick) agg.add(d, evs.get(d.id)!)
    if (Math.abs(agg.score() - exact) > EPS) fail(`após recolocar: ${agg.score()} ≠ ${exact}`)

    // 3. one move: re-evaluate two duties and swap them in the aggregate
    t = performance.now()
    const N = 200
    for (let i = 0; i < N; i++) {
      const a = duties[i % duties.length], b = duties[(i * 7 + 3) % duties.length]
      const ea = evaluateDuty(a, ctx), eb = evaluateDuty(b, ctx)
      agg.remove(a, evs.get(a.id)!); agg.remove(b, evs.get(b.id)!)
      agg.add(a, ea); agg.add(b, eb)
      evs.set(a.id, ea); evs.set(b.id, eb)
      agg.score()
    }
    const oneMove = (performance.now() - t) / N
    console.log(`  ${duties.length} jornadas · nota ${full.summary.score} · completo ${fullMs.toFixed(1)} ms · movimento (2 jornadas) ${oneMove.toFixed(3)} ms · remover ${moveMs.toFixed(3)} ms/jornada`)
  }

  console.log(failures ? `\n${failures} divergência(s)` : '\nOK — agregado incremental = cálculo completo')
  await prisma.$disconnect()
  process.exit(failures ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
