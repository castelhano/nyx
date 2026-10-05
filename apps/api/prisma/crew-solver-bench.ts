import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { TransitCrewConfigService } from '../src/modules/transit/settings/transit-crew-config.service'
import { CrewPlanService } from '../src/modules/transit/timetabling/crew-plan/crew-plan.service'
import { loadCrewSolverInput } from '../src/modules/transit/timetabling/crew-solver/crew-solver.input'
import { solveCrewPlan, evaluateSolverDuties, type CrewSolverResult } from '../src/modules/transit/timetabling/crew-solver/crew-solver.calc'
import { CrewImprover } from '../src/modules/transit/timetabling/crew-solver/crew-solver.improve'

// Runs the crew solver outside the API — construction, then continuous improvement — and
// prints construction vs improved side by side. A fixed seed repeats a run, so weights and
// moves can be compared. Nothing is written.
// Usage: pnpm crew:solver-bench <crewPlanId> [seconds=60] [seed=1] [--scratch]
//        [--meal=none|allowed|continuous|fractioned] (overrides settings.mealRule: allowed =
//        continuous allowed, continuous/fractioned = that form required)
//        [--settings='{"range":{"tripperRatio":{"modifier":30}}}'] (deep-merged over the settings)

const KIND = { STRAIGHT: 'Corrida', SPLIT: 'Dupla pegada', TRIPPER: 'Meia jornada' } as const

function metrics(r: CrewSolverResult) {
  const s = r.evaluation.summary
  // drivers per vehicle: distinct duties with a piece on each block
  const perBlock = new Map<string, Set<number>>()
  r.duties.forEach((d, i) => d.pieces.forEach(p => (perBlock.get(p.vehicleBlockId) ?? perBlock.set(p.vehicleBlockId, new Set()).get(p.vehicleBlockId)!).add(i)))
  const drivers = [...perBlock.values()].map(x => x.size)
  const duties = [...r.evaluation.duties.values()]
  const total = s.criteria.reduce((a, c) => a + c.weight, 0)
  const pct = (n: number) => `${n} (${s.dutyCount ? Math.round((n / s.dutyCount) * 100) : 0}%)`
  return {
    rows: {
      'Nota':                     String(s.score),
      'Nota sem teto':            String(s.rawScore),
      'Jornadas':                 String(s.dutyCount),
      ...Object.fromEntries(Object.entries(KIND).map(([k, label]) => [label, pct(s.byKind[k] ?? 0)])),
      'Com troca de carro':       pct(duties.filter(d => d.summary.vehicleChanges > 0).length),
      'Com troca de linha':       pct(duties.filter(d => d.summary.lineChanges > 0).length),
      'Condutores por carro':     drivers.length ? (drivers.reduce((a, n) => a + n, 0) / drivers.length).toFixed(2) : '—',
      'Carros com ≤ 2 condutores': `${drivers.filter(n => n <= 2).length} de ${drivers.length}`,
      'Intrajornada fracionada':  String(duties.filter(d => d.summary.mealForm === 'FRACTIONED').length),
      'Extra (% do trabalhado)':  `${s.workMinutes ? ((s.overtimeMinutes / s.workMinutes) * 100).toFixed(1) : 0}%`,
      'Com pendência':            String(duties.filter(d => d.issues.length).length),
      'Com pendência error':      String(duties.filter(d => d.issues.some(i => i.severity === 'error')).length),
      'Sem motorista (min)':      String(s.uncoveredMinutes),
    } as Record<string, string>,
    losses: Object.fromEntries(s.criteria.map(c => [c.key, Math.round((9999 * c.weight * (1 - c.value)) / total)])),
  }
}

async function main() {
  const args = process.argv.slice(2)
  const [crewPlanId, secondsArg, seedArg] = args.filter(a => !a.startsWith('--'))
  if (!crewPlanId) { console.error('usage: pnpm crew:solver-bench <crewPlanId> [seconds=60] [seed=1] [--scratch]'); process.exit(1) }
  const seconds = Number(secondsArg ?? 60), seed = Number(seedArg ?? 1)

  const prisma = new PrismaService()
  const { settings } = await new CrewPlanService(prisma, new TransitCrewConfigService(prisma)).resolveSettings(crewPlanId)
  const input = await loadCrewSolverInput(prisma, crewPlanId, settings)
  if (args.includes('--scratch')) input.locked = []
  const merge = (a: any, b: any): any => (b && typeof b === 'object' && !Array.isArray(b)
    ? Object.fromEntries([...new Set([...Object.keys(a ?? {}), ...Object.keys(b)])].map(k => [k, k in b ? merge(a?.[k], b[k]) : a[k]]))
    : b)
  const settingsArg = args.find(a => a.startsWith('--settings='))?.slice(11)
  if (settingsArg) Object.assign(settings, merge(settings, JSON.parse(settingsArg)))
  const mealArg = args.find(a => a.startsWith('--meal='))?.slice(7)
  if (mealArg || settingsArg) {
    if (mealArg) {
      settings.mealRule = {
        ...settings.mealRule,
        mode: mealArg === 'none' ? 'none' : mealArg === 'allowed' ? 'allowed' : 'required',
        form: mealArg === 'fractioned' ? 'fractioned' : 'continuous',
      }
    }
    Object.assign(input, await loadCrewSolverInput(prisma, crewPlanId, settings), { locked: input.locked })
  }
  await prisma.$disconnect()

  let t = performance.now()
  const construction = solveCrewPlan(input)
  console.log(`construção: ${(performance.now() - t).toFixed(0)} ms`)

  const maxMs = seconds * 1000
  const noImprovementMs = settings.stopNoImprovementMinutes * 60_000
  const improver = new CrewImprover(input, construction.duties, Math.min(maxMs, noImprovementMs / 2), seed)
  t = performance.now()
  let stop = 'max_time', lastLog = 0
  while (true) {
    improver.run(100)
    const now = Date.now()
    if (now - improver.startedAt >= maxMs) break
    if (now - improver.lastImprovementAt >= noImprovementMs) { stop = 'no_improvement'; break }
    if (now - lastLog >= 5000) {
      lastLog = now
      console.log(`  ${((now - improver.startedAt) / 1000).toFixed(0)}s · ${improver.attempts.toLocaleString('pt-BR')} tentativas · ${improver.improvements} melhorias · melhor ${improver.bestScore.toFixed(1)}`)
    }
  }
  const secs = (performance.now() - t) / 1000
  console.log(`melhoria: ${secs.toFixed(0)} s · ${improver.attempts.toLocaleString('pt-BR')} tentativas (${Math.round(improver.attempts / secs).toLocaleString('pt-BR')}/s) · ${improver.improvements} melhorias · parada: ${stop}\n`)

  const a = metrics(construction), b = metrics(evaluateSolverDuties(input, improver.bestDuties()))
  console.table(Object.fromEntries(Object.keys(a.rows).map(k => [k, { construção: a.rows[k], melhorada: b.rows[k] }])))
  console.log('Perdas na nota')
  console.table(Object.fromEntries(Object.keys(a.losses).map(k => [k, { construção: a.losses[k], melhorada: b.losses[k] ?? 0 }])))
}

main().catch(err => { console.error(err); process.exit(1) })
