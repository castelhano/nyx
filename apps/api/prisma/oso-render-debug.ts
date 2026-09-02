import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaPg } from '@prisma/adapter-pg'
import { assembleOso } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-assembler'
import { resolveLayouts } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-layout.resolver'
import { bandCarros } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-banding'
import { computeOsoSummary } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-summary'
import { renderOsoWorkbook } from '../src/modules/transit/timetabling/vehicle-plan/oso/oso-workbook.renderer'

// Manual test harness for layer 6 (renderer) — writes a real .xlsx to disk so the output can
// be inspected/opened, same spirit as oso-debug.ts for layers 1-5. Usage:
//   pnpm oso:render <lineCode> [vehiclePlanId]

const url     = process.env.DATABASE_URL!
const adapter = url.startsWith('postgresql://') || url.startsWith('postgres://')
  ? new PrismaPg({ connectionString: url })
  : new PrismaLibSql({ url })
const prisma  = new PrismaClient({ adapter }) as any

async function main() {
  const [lineCode, planIdArg] = process.argv.slice(2)
  if (!lineCode) {
    console.error('usage: pnpm oso:render <lineCode> [vehiclePlanId]')
    process.exit(1)
  }

  const line = await prisma.transitLine.findFirst({ where: { code: lineCode }, select: { id: true, code: true, name: true } })
  if (!line) { console.error(`no TransitLine with code "${lineCode}"`); process.exit(1) }

  const plan = planIdArg
    ? await prisma.vehiclePlan.findUniqueOrThrow({ where: { id: planIdArg }, select: { id: true, scopeId: true } })
    : await prisma.vehiclePlan.findFirstOrThrow({
        where:   { status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        select:  { id: true, scopeId: true },
      })

  const scope = await prisma.scope.findUniqueOrThrow({ where: { id: plan.scopeId }, select: { name: true, logoUrl: true, osoConfig: true } })

  const assembled = await assembleOso(prisma, plan.id, line.id)
  const layouts    = await resolveLayouts(prisma, assembled)
  const bands      = bandCarros(assembled, layouts)
  const summary    = await computeOsoSummary(prisma, assembled)

  const osoConfig = (scope.osoConfig as any) ?? {}
  const workbook = await renderOsoWorkbook(prisma, [{
    lineCode: line.code,
    lineName: line.name,
    assembled, layouts, bands, summary,
    scope: {
      name:       scope.name,
      logoUrl:    scope.logoUrl,
      organName:  osoConfig.organName,
      signatures: osoConfig.signatures ?? [],
    },
  }])

  const outPath = `/tmp/oso-${lineCode}.xlsx`
  await workbook.xlsx.writeFile(outPath)
  console.log(`wrote ${outPath}`)
}

main().finally(() => prisma.$disconnect())
