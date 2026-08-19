import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaPg } from '@prisma/adapter-pg'

// Restores prisma/fixtures/transit.json written by transit-export.ts. Upserts by
// natural key, so it's safe to re-run. Requires prisma/seed-core.ts to have already
// run (ScopeOperator resolves branches by taxId).

const url      = process.env.DATABASE_URL!
const adapter  = url.startsWith('postgresql://') || url.startsWith('postgres://')
  ? new PrismaPg({ connectionString: url })
  : new PrismaLibSql({ url })
const prisma   = new PrismaClient({ adapter })

const FIXTURE_PATH = join(__dirname, 'fixtures', 'transit.json')

interface Fixture {
  localities: Array<{ code: string; abbr: string | null; name: string; lat: number | null; lng: number | null; isDepot: boolean; notes: string | null; snapInfo: unknown }>
  dayTypes: Array<{ code: string; name: string; pattern: unknown; priority: number; sortOrder: number }>
  intervalTypes: Array<{ code: string; name: string; isPaid: boolean; minMinutes: number | null; maxMinutes: number | null; notes: string | null }>
  scopes: Array<{ name: string; operators: Array<{ branchTaxId: string; abbr: string; share: number }> }>
  lines: Array<{ code: string; name: string; type: string; isActive: boolean; scopeName: string | null; parentLineCode: string | null; notes: string | null; metrics: unknown }>
  routes: Array<{ lineCode: string; direction: string; ordinal: number; name: string; originCode: string; destinationCode: string; isActive: boolean; isPrimary: boolean }>
  routeLocalities: Array<{ lineCode: string; direction: string; routeOrdinal: number; routeName: string; sequence: number; localityCode: string | null; lat: number | null; lng: number | null; deltaMinutes: number | null; deltaKm: number | null; deltaSource: string; geometry: unknown; allowsCrewChange: boolean }>
  lineGroups: Array<{ name: string; branchTaxId: string | null; notes: string | null; lineCodes: string[] }>
}

async function main() {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Fixture
  console.log(`Importing fixture exported at ${(fixture as any).exportedAt ?? 'unknown'}`)

  // ── localities ──────────────────────────────────────────────────────────────
  for (const l of fixture.localities) {
    await prisma.transitLocality.upsert({
      where:  { code: l.code },
      update: { abbr: l.abbr, name: l.name, lat: l.lat, lng: l.lng, isDepot: l.isDepot, notes: l.notes, snapInfo: l.snapInfo as Prisma.InputJsonValue },
      create: { code: l.code, abbr: l.abbr, name: l.name, lat: l.lat, lng: l.lng, isDepot: l.isDepot, notes: l.notes, snapInfo: l.snapInfo as Prisma.InputJsonValue },
    })
  }
  const localityMap = new Map((await prisma.transitLocality.findMany({ select: { id: true, code: true } })).map(l => [l.code, l.id]))
  console.log(`  ✓ localities (${fixture.localities.length})`)

  // ── day types ───────────────────────────────────────────────────────────────
  for (const d of fixture.dayTypes) {
    await prisma.dayType.upsert({
      where:  { code: d.code },
      update: { name: d.name, pattern: d.pattern as Prisma.InputJsonValue, priority: d.priority, sortOrder: d.sortOrder },
      create: { code: d.code, name: d.name, pattern: d.pattern as Prisma.InputJsonValue, priority: d.priority, sortOrder: d.sortOrder },
    })
  }
  console.log(`  ✓ day types (${fixture.dayTypes.length})`)

  // ── interval types ──────────────────────────────────────────────────────────
  for (const i of fixture.intervalTypes) {
    await prisma.intervalType.upsert({
      where:  { code: i.code },
      update: { name: i.name, isPaid: i.isPaid, minMinutes: i.minMinutes, maxMinutes: i.maxMinutes, notes: i.notes },
      create: { code: i.code, name: i.name, isPaid: i.isPaid, minMinutes: i.minMinutes, maxMinutes: i.maxMinutes, notes: i.notes },
    })
  }
  console.log(`  ✓ interval types (${fixture.intervalTypes.length})`)

  // ── scopes + operators ──────────────────────────────────────────────────────
  const scopeMap = new Map<string, string>()
  for (const s of fixture.scopes) {
    const scope = await prisma.scope.upsert({
      where:  { name: s.name },
      update: {},
      create: { name: s.name },
    })
    scopeMap.set(s.name, scope.id)

    for (const op of s.operators) {
      const branch = await prisma.branch.findUnique({ where: { taxId: op.branchTaxId } })
      if (!branch) {
        console.warn(`  ! filial ${op.branchTaxId} não encontrada — rode prisma/seed-core.ts antes`)
        continue
      }
      await prisma.scopeOperator.upsert({
        where:  { scopeId_branchId: { scopeId: scope.id, branchId: branch.id } },
        update: { abbr: op.abbr, share: op.share },
        create: { scopeId: scope.id, branchId: branch.id, abbr: op.abbr, share: op.share },
      })
    }
  }
  console.log(`  ✓ scopes (${fixture.scopes.length})`)

  // ── lines (two passes: create/update, then wire parentLineId) ─────────────────
  const lineMap = new Map<string, string>()
  for (const l of fixture.lines) {
    const scopeId = l.scopeName ? scopeMap.get(l.scopeName) : undefined
    const record = await prisma.transitLine.upsert({
      where:  { code: l.code },
      update: { name: l.name, type: l.type as any, isActive: l.isActive, scopeId, notes: l.notes, metrics: l.metrics as Prisma.InputJsonValue },
      create: { code: l.code, name: l.name, type: l.type as any, isActive: l.isActive, scopeId, notes: l.notes, metrics: l.metrics as Prisma.InputJsonValue },
    })
    lineMap.set(l.code, record.id)
  }
  for (const l of fixture.lines) {
    if (!l.parentLineCode) continue
    const childId  = lineMap.get(l.code)
    const parentId = lineMap.get(l.parentLineCode)
    if (!childId || !parentId) continue
    await prisma.transitLine.update({ where: { id: childId }, data: { parentLineId: parentId } })
  }
  console.log(`  ✓ lines (${fixture.lines.length})`)

  // ── routes ──────────────────────────────────────────────────────────────────
  const routeMap = new Map<string, string>() // `${lineCode}:${direction}:${ordinal}` — a line/direction can have multiple route variants
  for (const r of fixture.routes) {
    const lineId   = lineMap.get(r.lineCode)!
    const originId = localityMap.get(r.originCode)!
    const destId   = localityMap.get(r.destinationCode)!
    const existing = await prisma.transitRoute.findFirst({ where: { lineId, direction: r.direction as any, ordinal: r.ordinal } })
    const record = existing
      ? await prisma.transitRoute.update({
          where: { id: existing.id },
          data:  { name: r.name, originLocalityId: originId, destinationLocalityId: destId, isActive: r.isActive, isPrimary: r.isPrimary },
        })
      : await prisma.transitRoute.create({
          data: { lineId, direction: r.direction as any, ordinal: r.ordinal, name: r.name, originLocalityId: originId, destinationLocalityId: destId, isActive: r.isActive, isPrimary: r.isPrimary },
        })
    routeMap.set(`${r.lineCode}:${r.direction}:${r.ordinal}`, record.id)
  }
  console.log(`  ✓ routes (${fixture.routes.length})`)

  // ── route localities (trajectory) ──────────────────────────────────────────
  // owned entirely by the fixture per route — wipe and recreate each route's stops.
  const routesTouched = new Set(fixture.routeLocalities.map(rl => `${rl.lineCode}:${rl.direction}:${rl.routeOrdinal}`))
  for (const key of routesTouched) {
    const routeId = routeMap.get(key)
    if (!routeId) continue
    await prisma.routeLocality.deleteMany({ where: { routeId } })
  }
  for (const rl of fixture.routeLocalities) {
    const routeId    = routeMap.get(`${rl.lineCode}:${rl.direction}:${rl.routeOrdinal}`)
    if (!routeId) continue
    const localityId = rl.localityCode ? localityMap.get(rl.localityCode) : null
    await prisma.routeLocality.create({
      data: {
        routeId, localityId, sequence: rl.sequence, lat: rl.lat, lng: rl.lng,
        deltaMinutes: rl.deltaMinutes, deltaKm: rl.deltaKm, deltaSource: rl.deltaSource as any,
        geometry: rl.geometry as Prisma.InputJsonValue, allowsCrewChange: rl.allowsCrewChange,
      },
    })
  }
  console.log(`  ✓ route localities (${fixture.routeLocalities.length})`)

  // ── line groups ─────────────────────────────────────────────────────────────
  for (const g of fixture.lineGroups) {
    const branch = g.branchTaxId ? await prisma.branch.findUnique({ where: { taxId: g.branchTaxId } }) : null
    const group = await prisma.lineGroup.upsert({
      where:  { name: g.name },
      update: { branchId: branch?.id, notes: g.notes },
      create: { name: g.name, branchId: branch?.id, notes: g.notes },
    })
    const lineIds = g.lineCodes.map(code => lineMap.get(code)).filter((id): id is string => !!id)
    await prisma.lineGroupLine.deleteMany({ where: { lineGroupId: group.id } })
    await prisma.lineGroupLine.createMany({ data: lineIds.map(lineId => ({ lineGroupId: group.id, lineId })) })
  }
  console.log(`  ✓ line groups (${fixture.lineGroups.length})`)

  console.log('Transit import complete.')
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
