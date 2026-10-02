import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { TransitGeneralConfigService } from '../src/modules/transit/settings/transit-general-config.service'
import { TransitPlanningConfigService } from '../src/modules/transit/settings/transit-planning-config.service'
import { loadVehicleSolverInput } from '../src/modules/transit/timetabling/vehicle-solver/vehicle-solver.input'
import { VehicleModel, constructBlocks, summarizeProposal, blockHasIssues, toProposalBlocks, type WorkBlock } from '../src/modules/transit/timetabling/vehicle-solver/vehicle-solver.calc'
import { VehicleImprover } from '../src/modules/transit/timetabling/vehicle-solver/vehicle-solver.improve'
import type { VehicleSolverSummary } from '../src/modules/transit/timetabling/vehicle-solver/vehicle-solver.types'

// Runs the vehicle solver outside the API — construction, then continuous improvement — and
// prints the plan as it is, the construction and the improved proposal side by side, plus a
// check of the proposal (every trip once, hard rules, capacity). A fixed seed repeats a run.
// Nothing is written.
// Usage: pnpm vehicle:solver-bench <vehiclePlanId> [seconds=60] [seed=1] [--scratch]
//        [--cycle=<seconds>] [--trace] (current/best score every 2 s) [--numbering]
//        [--settings='{"range":{"lineTransfer":{"modifier":30}}}'] (deep-merged over the settings)

function rows(s: VehicleSolverSummary): Record<string, string> {
  const total = s.criteria.reduce((a, c) => a + c.weight, 0)
  return {
    'Nota':          String(s.score),
    'Frota':         String(s.fleetCount),
    'Km ocioso':     s.deadrunKm.toFixed(1),
    'Km total':      s.totalKm.toFixed(1),
    'Com pendência': String(s.issueBlocks),
    ...Object.fromEntries(s.byBranch.map(b => [`Frota ${b.branchId?.slice(0, 8) ?? '—'}`, `${b.fleet} (${b.km.toFixed(0)} km)`])),
    ...Object.fromEntries(s.byDepot.map(d => [`Garagem ${d.depotId.slice(0, 8)} ${d.vehicleType}`, String(d.fleet)])),
    ...Object.fromEntries(s.criteria.map(c => [`perda ${c.key}`, String(Math.round((9999 * c.weight * (1 - c.value)) / total))])),
  }
}

function check(model: VehicleModel, blocks: WorkBlock[]): string[] {
  const problems: string[] = []
  const seen = new Map<string, number>()
  for (const b of blocks) for (const t of b.trips) seen.set(t.id, (seen.get(t.id) ?? 0) + 1)
  const missing = model.input.trips.filter(t => !seen.has(t.id)).length
  const twice = [...seen.values()].filter(n => n > 1).length
  if (missing) problems.push(`${missing} viagem(ns) sem carro`)
  if (twice) problems.push(`${twice} viagem(ns) em mais de um carro`)
  const cap = model.newCapacity()
  for (const b of blocks) {
    if (!model.chainOk(b.trips)) problems.push(`carro com encadeamento inválido (${b.trips[0].dep})`)
    if (!model.typeCandidates(b.trips).includes(b.vehicleType)) problems.push(`carro com tipo não aceito (${b.vehicleType})`)
    if (!model.depotAllows(b.depotId, b.branchId)) problems.push('garagem não atende a empresa do carro')
    if (!cap.fits(b.depotId, b.vehicleType)) problems.push(`capacidade excedida em ${b.depotId.slice(0, 8)} ${b.vehicleType}`)
    cap.add(b.depotId, b.vehicleType)
  }
  const flagged = blocks.filter(b => blockHasIssues(model, b)).length
  if (flagged) problems.push(`${flagged} carro(s) com pendência de modelagem`)
  return problems
}

async function main() {
  const args = process.argv.slice(2)
  const [planId, secondsArg, seedArg] = args.filter(a => !a.startsWith('--'))
  if (!planId) { console.error('usage: pnpm vehicle:solver-bench <vehiclePlanId> [seconds=60] [seed=1] [--scratch]'); process.exit(1) }
  const seconds = Number(secondsArg ?? 60), seed = Number(seedArg ?? 1)

  const prisma  = new PrismaService()
  const general = new TransitGeneralConfigService(prisma)
  const plan = await prisma.vehiclePlan.findUniqueOrThrow({ where: { id: planId }, select: { settings: true, scopeId: true } })
  const settings = plan.settings
    ? (await import('@nyx/schemas')).planningSettingsSchema.parse(plan.settings)
    : await new TransitPlanningConfigService(prisma).get(plan.scopeId)
  const merge = (a: any, b: any): any => (b && typeof b === 'object' && !Array.isArray(b)
    ? Object.fromEntries([...new Set([...Object.keys(a ?? {}), ...Object.keys(b)])].map(k => [k, k in b ? merge(a?.[k], b[k]) : a[k]]))
    : b)
  const settingsArg = args.find(a => a.startsWith('--settings='))?.slice(11)
  if (settingsArg) Object.assign(settings, merge(settings, JSON.parse(settingsArg)))

  const base = args.includes('--scratch') ? 'scratch' : 'complete'
  const { input, baseline } = await loadVehicleSolverInput(prisma, general, planId, settings, settings, { base, direction: 'balanced' })
  await prisma.$disconnect()
  console.log(`${input.trips.length} viagens a distribuir, ${input.locked.length} carros travados, ${input.depots.length} garagens, ${input.operators.length} empresas`)

  const model = new VehicleModel(input)
  let t0 = Date.now()
  const construction = constructBlocks(model)
  console.log(`construção: ${Date.now() - t0} ms`)
  const built = summarizeProposal(model, construction)

  t0 = Date.now()
  const cycleArg = args.find(a => a.startsWith('--cycle='))?.slice(8)
  const cycleMs  = cycleArg ? Number(cycleArg) * 1000 : Math.min(seconds * 1000, input.settings.stopNoImprovementMinutes * 30_000)
  const improver = new VehicleImprover(model, construction, cycleMs, seed)
  let lastLog = Date.now()
  while (Date.now() - t0 < seconds * 1000) {
    improver.run(200)
    if (args.includes('--trace') && Date.now() - lastLog > 2000) {
      lastLog = Date.now()
      console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s atual ${improver.current.toFixed(5)} melhor ${improver.bestScore.toFixed(5)} T ${improver.temperature?.toExponential(2)}`)
    }
  }
  const best = improver.bestBlocks()
  const improved = summarizeProposal(model, best)
  console.log(`melhoria: ${improver.attempts.toLocaleString('pt-BR')} tentativas, ${improver.improvements} melhorias`)
  for (const [k, v] of Object.entries(improver.stats)) console.log(`  ${k.padEnd(9)} tentados ${v.tried}  viáveis ${v.built}  aceitos ${v.accepted}`)

  const table = [rows(baseline), rows(built), rows(improved)]
  const keys = [...new Set(table.flatMap(r => Object.keys(r)))]
  const w = Math.max(...keys.map(k => k.length))
  console.log(`\n${''.padEnd(w)}  ${'Atual'.padStart(16)}  ${'Construção'.padStart(16)}  ${'Melhorada'.padStart(16)}`)
  for (const k of keys) console.log(`${k.padEnd(w)}  ${table.map(r => (r[k] ?? '—').padStart(16)).join('  ')}`)

  if (args.includes('--numbering')) {
    const ordered = toProposalBlocks(best).map((b, i) => `${i + 1}:${model.tripById.get(b.tripIds[0])!.lineCode}@${b.tripIds.map(id => model.tripById.get(id)!.lineCode).join(',').slice(0, 30)}`)
    console.log('\nnumeração:', ordered.slice(0, 15).join('  '))
  }

  const count = (blocks: WorkBlock[]) => ({
    intervals: blocks.reduce((n, b) => n + b.rows.intervals.length, 0),
    midDayReturns: blocks.reduce((n, b) => n + b.rows.deadruns.filter(d => d.type === 'RETURN').length - 1, 0),
    displacements: blocks.reduce((n, b) => n + b.rows.deadruns.filter(d => d.type === 'DISPLACEMENT').length, 0),
  })
  console.log(`\nconstrução ${JSON.stringify(count(construction))}  melhorada ${JSON.stringify(count(best))}`)

  const problems = check(model, best)
  console.log(problems.length ? `\nPROBLEMAS:\n - ${problems.join('\n - ')}` : '\nproposta ok (todas as viagens, regras rígidas, capacidade, sem pendências)')
}

main().catch(err => { console.error(err); process.exit(1) })
