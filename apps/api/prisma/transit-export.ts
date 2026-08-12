import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaPg } from '@prisma/adapter-pg'

// Snapshots the transit cadastro domain — TransitLocality, DayType, Scope,
// ScopeOperator, TransitLine, TransitRoute, RouteLocality — keyed by natural keys
// (code, not id) so it survives a `prisma migrate reset` and imports cleanly on
// any machine. Run after making cadastro edits in the app; commit the resulting
// fixture so the other machine can `pnpm db:import-transit` it back.

const url      = process.env.DATABASE_URL!
const adapter  = url.startsWith('postgresql://') || url.startsWith('postgres://')
  ? new PrismaPg({ connectionString: url })
  : new PrismaLibSql({ url })
const prisma   = new PrismaClient({ adapter })

const FIXTURE_PATH = join(__dirname, 'fixtures', 'transit.json')

async function main() {
  const [localities, dayTypes, scopes, lines, routes, routeLocalities] = await Promise.all([
    prisma.transitLocality.findMany({ orderBy: { code: 'asc' } }),
    prisma.dayType.findMany({ orderBy: { code: 'asc' } }),
    prisma.scope.findMany({
      include: { operators: { include: { branch: { select: { taxId: true } } } } },
      orderBy: { name: 'asc' },
    }),
    prisma.transitLine.findMany({
      include: { scope: { select: { name: true } }, parentLine: { select: { code: true } } },
      orderBy: { code: 'asc' },
    }),
    prisma.transitRoute.findMany({
      include: {
        line:                { select: { code: true } },
        originLocality:      { select: { code: true } },
        destinationLocality: { select: { code: true } },
      },
      orderBy: [{ lineId: 'asc' }, { direction: 'asc' }],
    }),
    prisma.routeLocality.findMany({
      include: {
        route:    { select: { line: { select: { code: true } }, direction: true } },
        locality: { select: { code: true } },
      },
      orderBy: [{ routeId: 'asc' }, { sequence: 'asc' }],
    }),
  ])

  const fixture = {
    exportedAt: new Date().toISOString(),
    localities: localities.map(l => ({
      code: l.code, abbr: l.abbr, name: l.name, lat: l.lat, lng: l.lng,
      isDepot: l.isDepot, notes: l.notes, snapInfo: l.snapInfo,
    })),
    dayTypes: dayTypes.map(d => ({
      code: d.code, name: d.name, pattern: d.pattern, priority: d.priority, sortOrder: d.sortOrder,
    })),
    scopes: scopes.map(s => ({
      name: s.name,
      operators: s.operators.map(o => ({ branchTaxId: o.branch.taxId, abbr: o.abbr, share: o.share })),
    })),
    lines: lines.map(l => ({
      code: l.code, name: l.name, type: l.type, isActive: l.isActive,
      scopeName: l.scope?.name ?? null, parentLineCode: l.parentLine?.code ?? null,
      notes: l.notes, metrics: l.metrics,
    })),
    routes: routes.map(r => ({
      lineCode: r.line.code, direction: r.direction, name: r.name,
      originCode: r.originLocality.code, destinationCode: r.destinationLocality.code,
      isActive: r.isActive, isPrimary: r.isPrimary,
    })),
    routeLocalities: routeLocalities.map(rl => ({
      lineCode: rl.route.line.code, direction: rl.route.direction, sequence: rl.sequence,
      localityCode: rl.locality?.code ?? null, lat: rl.lat, lng: rl.lng,
      deltaMinutes: rl.deltaMinutes, deltaKm: rl.deltaKm, deltaSource: rl.deltaSource,
      geometry: rl.geometry, allowsCrewChange: rl.allowsCrewChange,
    })),
  }

  mkdirSync(join(__dirname, 'fixtures'), { recursive: true })
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2))

  console.log(`Exported to ${FIXTURE_PATH}`)
  console.log(`  localities=${localities.length} dayTypes=${dayTypes.length} scopes=${scopes.length}`)
  console.log(`  lines=${lines.length} routes=${routes.length} routeLocalities=${routeLocalities.length}`)
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
