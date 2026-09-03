import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaPg } from '@prisma/adapter-pg'
import { assembleOso } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-assembler'
import { resolveLayouts } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-layout.resolver'
import { bandCarros } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-banding'
import { computeOsoSummary } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-summary'

// Manual test harness for the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) —
// there's no HTTP endpoint yet (that's Fase 2/3), so this is how to exercise layers 1-5
// against real data while the renderer doesn't exist. Usage:
//   pnpm oso:debug <lineCode> [vehiclePlanId]
// vehiclePlanId defaults to the most recently updated ACTIVE plan.

const url      = process.env.DATABASE_URL!
const adapter  = url.startsWith('postgresql://') || url.startsWith('postgres://')
  ? new PrismaPg({ connectionString: url })
  : new PrismaLibSql({ url })
const prisma   = new PrismaClient({ adapter }) as any

function fmt(m: number): string {
  const h = Math.floor(m / 60) % 24
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

async function main() {
  const [lineCode, planIdArg] = process.argv.slice(2)
  if (!lineCode) {
    console.error('usage: pnpm oso:debug <lineCode> [vehiclePlanId]')
    process.exit(1)
  }

  const line = await prisma.transitLine.findFirst({ where: { code: lineCode }, select: { id: true, code: true } })
  if (!line) { console.error(`no TransitLine with code "${lineCode}"`); process.exit(1) }

  const plan = planIdArg
    ? await prisma.vehiclePlan.findUniqueOrThrow({ where: { id: planIdArg }, select: { id: true, scope: { select: { name: true } } } })
    : await prisma.vehiclePlan.findFirstOrThrow({
        where:   { status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        select:  { id: true, scope: { select: { name: true } } },
      })

  console.log(`plan ${plan.id} (scope: ${plan.scope.name})`)

  const assembled = await assembleOso(prisma, plan.id, line.id)
  console.log(`family: ${assembled.family.map((l: any) => l.code).join(' + ')}`)

  if (assembled.carros.length === 0) {
    console.log('no carros with trips for this line in this plan.')
    return
  }

  const layouts = await resolveLayouts(prisma, assembled)
  const bands   = bandCarros(assembled, layouts)
  const summary = await computeOsoSummary(prisma, assembled)

  bands.forEach((band, i) => {
    console.log(`\n--- banda ${i + 1} ---`)
    for (const blockId of band.blockIds) {
      const carro  = assembled.carros.find((c: any) => c.blockId === blockId)!
      const layout = layouts.get(blockId)!
      const cols   = layout.columns.map(c => `${c.direction[0]}${c.timing ? `(${c.timing[0]})` : ''}`).join(' ')
      console.log(`  bloco ${carro.blockNumber} [${carro.operatorLabel ?? '—'}] cols=[${cols}] x${layout.tripsPerRow}`)
      for (const e of carro.events) {
        if (e.kind === 'trip')     console.log(`    trip     ${e.direction.padEnd(8)} ${fmt(e.departureMinutes)}-${fmt(e.arrivalMinutes)}`)
        if (e.kind === 'deadrun')  console.log(`    RECO              ${fmt(e.departureMinutes)}-${fmt(e.arrivalMinutes)}`)
        if (e.kind === 'interval') console.log(`    INTERV            ${fmt(e.departureMinutes)}-${fmt(e.arrivalMinutes)}`)
      }
    }
  })

  console.log('\n--- RESUMO ---')
  for (const op of summary.operators) {
    console.log(`  ${op.operatorLabel}: V=${op.trips} frota=${op.fleet} horas=${(op.operatingMinutes / 60).toFixed(1)}h km=${op.km.toFixed(1)}`)
  }
  console.log(`  Total: V=${summary.totals.trips} frota=${summary.totals.fleet} horas=${(summary.totals.operatingMinutes / 60).toFixed(1)}h km=${summary.totals.km.toFixed(1)}`)
  console.log(`  Tempo de viagem: ${summary.cycleTimesMinutes.map(m => `${m}'`).join(' ')}`)
  console.log(`  Extensão útil: ${JSON.stringify(summary.extensionUtilKm)}`)
  console.log(`  Extensão ociosa: ${summary.extensionOciosaKm.map(o => `${o.operatorLabel}=${o.km.toFixed(2)}km`).join(' ')}`)
}

main().finally(() => prisma.$disconnect())
