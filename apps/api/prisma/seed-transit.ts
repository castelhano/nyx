import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

// ── helpers ───────────────────────────────────────────────────────────────────

function range(start: number, end: number, step: number): number[] {
  const out: number[] = []
  for (let v = start; v <= end; v += step) out.push(v)
  return out
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding transit data…')

  // ── day types ──────────────────────────────────────────────────────────────

  const [diaUtil, sabado] = await Promise.all([
    prisma.dayType.upsert({
      where:  { code: 'DIA_UTIL' },
      update: {},
      create: { code: 'DIA_UTIL', name: 'Dia Útil',  priority: 1, sortOrder: 1 },
    }),
    prisma.dayType.upsert({
      where:  { code: 'SABADO' },
      update: {},
      create: { code: 'SABADO',   name: 'Sábado',    priority: 2, sortOrder: 2 },
    }),
  ])
  console.log('  ✓ day types')

  // ── localities ─────────────────────────────────────────────────────────────

  const [gar, tca, tno, tsu, ble] = await Promise.all([
    prisma.transitLocality.upsert({
      where:  { code: 'GAR' },
      update: {},
      create: { code: 'GAR', name: 'Garagem Central',  isDepot: true,  lat: -23.550, lng: -46.633 },
    }),
    prisma.transitLocality.upsert({
      where:  { code: 'TCA' },
      update: {},
      create: { code: 'TCA', name: 'Terminal Centro',  isDepot: false, lat: -23.545, lng: -46.638 },
    }),
    prisma.transitLocality.upsert({
      where:  { code: 'TNO' },
      update: {},
      create: { code: 'TNO', name: 'Terminal Norte',   isDepot: false, lat: -23.510, lng: -46.620 },
    }),
    prisma.transitLocality.upsert({
      where:  { code: 'TSU' },
      update: {},
      create: { code: 'TSU', name: 'Terminal Sul',     isDepot: false, lat: -23.590, lng: -46.645 },
    }),
    prisma.transitLocality.upsert({
      where:  { code: 'BLE' },
      update: {},
      create: { code: 'BLE', name: 'Bairro Leste',    isDepot: false, lat: -23.548, lng: -46.600 },
    }),
  ])
  console.log('  ✓ localities')

  // ── travel time matrix (symmetric pairs) ───────────────────────────────────

  const pairs: Array<[string, string, number, number]> = [
    // [originId, destinationId, minutes, km]
    [gar.id, tca.id,  15, 8],
    [tca.id, gar.id,  15, 8],
    [gar.id, tno.id,  22, 13],
    [tno.id, gar.id,  22, 13],
    [gar.id, tsu.id,  20, 11],
    [tsu.id, gar.id,  20, 11],
    [gar.id, ble.id,  18, 10],
    [ble.id, gar.id,  18, 10],
    [tca.id, tno.id,  25, 15],
    [tno.id, tca.id,  25, 15],
    [tca.id, tsu.id,  20, 12],
    [tsu.id, tca.id,  20, 12],
    [tca.id, ble.id,  10,  5],
    [ble.id, tca.id,  10,  5],
    [tno.id, tsu.id,  35, 20],
    [tsu.id, tno.id,  35, 20],
    [tno.id, ble.id,  22, 13],
    [ble.id, tno.id,  22, 13],
    [tsu.id, ble.id,  18, 10],
    [ble.id, tsu.id,  18, 10],
  ]

  for (const [originId, destinationId, baseMinutes, distanceKm] of pairs) {
    await prisma.travelTimeMatrix.upsert({
      where:  { originId_destinationId: { originId, destinationId } },
      update: {},
      create: { originId, destinationId, baseMinutes, distanceKm, source: 'MANUAL' },
    })
  }
  console.log('  ✓ travel time matrix')

  // ── lines ──────────────────────────────────────────────────────────────────

  const [l001, l002] = await Promise.all([
    prisma.transitLine.upsert({
      where:  { code: 'L001' },
      update: {},
      create: { code: 'L001', name: 'Centro-Norte', type: 'URBAN', isActive: true },
    }),
    prisma.transitLine.upsert({
      where:  { code: 'L002' },
      update: {},
      create: { code: 'L002', name: 'Centro-Sul',   type: 'URBAN', isActive: true },
    }),
  ])
  console.log('  ✓ lines')

  // ── routes ─────────────────────────────────────────────────────────────────
  // upsert by lineId+direction (no unique on those, so check by name)

  async function upsertRoute(data: {
    lineId: string; direction: 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'
    name: string; originLocalityId: string; destinationLocalityId: string
  }) {
    const existing = await prisma.transitRoute.findFirst({ where: { lineId: data.lineId, direction: data.direction } })
    if (existing) return existing
    return prisma.transitRoute.create({ data: { ...data, isActive: true } })
  }

  const [r001out, r001in, r002out, r002in] = await Promise.all([
    upsertRoute({ lineId: l001.id, direction: 'OUTBOUND', name: 'Centro → Norte', originLocalityId: tca.id, destinationLocalityId: tno.id }),
    upsertRoute({ lineId: l001.id, direction: 'INBOUND',  name: 'Norte → Centro', originLocalityId: tno.id, destinationLocalityId: tca.id }),
    upsertRoute({ lineId: l002.id, direction: 'OUTBOUND', name: 'Centro → Sul',   originLocalityId: tca.id, destinationLocalityId: tsu.id }),
    upsertRoute({ lineId: l002.id, direction: 'INBOUND',  name: 'Sul → Centro',   originLocalityId: tsu.id, destinationLocalityId: tca.id }),
  ])
  console.log('  ✓ routes')

  // ── route localities ───────────────────────────────────────────────────────

  async function ensureRouteLocality(routeId: string, localityId: string, sequence: number) {
    const existing = await prisma.routeLocality.findUnique({ where: { routeId_localityId: { routeId, localityId } } })
    if (!existing) {
      await prisma.routeLocality.create({ data: { routeId, localityId, sequence } })
    }
  }

  await Promise.all([
    ensureRouteLocality(r001out.id, tca.id, 1),
    ensureRouteLocality(r001out.id, tno.id, 2),
    ensureRouteLocality(r001in.id,  tno.id, 1),
    ensureRouteLocality(r001in.id,  tca.id, 2),
    ensureRouteLocality(r002out.id, tca.id, 1),
    ensureRouteLocality(r002out.id, tsu.id, 2),
    ensureRouteLocality(r002in.id,  tsu.id, 1),
    ensureRouteLocality(r002in.id,  tca.id, 2),
  ])
  console.log('  ✓ route localities')

  // ── trips ──────────────────────────────────────────────────────────────────

  type TripSpec = { dayTypeId: string; routeId: string; departureMinutes: number; arrivalMinutes: number }

  async function seedTrips(specs: TripSpec[]) {
    let created = 0
    for (const spec of specs) {
      const exists = await prisma.transitTrip.findFirst({
        where: { dayTypeId: spec.dayTypeId, routeId: spec.routeId, departureMinutes: spec.departureMinutes },
      })
      if (!exists) {
        await prisma.transitTrip.create({ data: spec })
        created++
      }
    }
    return created
  }

  // DIA_UTIL — every 30 min, 06:00–20:00
  const duSpecs: TripSpec[] = [
    // L001 Outbound: TCA→TNO 25min
    ...range(360, 1200, 30).map(dep => ({ dayTypeId: diaUtil.id, routeId: r001out.id, departureMinutes: dep, arrivalMinutes: dep + 25 })),
    // L001 Inbound: TNO→TCA 25min (offset +20)
    ...range(380, 1220, 30).map(dep => ({ dayTypeId: diaUtil.id, routeId: r001in.id,  departureMinutes: dep, arrivalMinutes: dep + 25 })),
    // L002 Outbound: TCA→TSU 20min
    ...range(360, 1200, 30).map(dep => ({ dayTypeId: diaUtil.id, routeId: r002out.id, departureMinutes: dep, arrivalMinutes: dep + 20 })),
    // L002 Inbound: TSU→TCA 20min (offset +15)
    ...range(375, 1215, 30).map(dep => ({ dayTypeId: diaUtil.id, routeId: r002in.id,  departureMinutes: dep, arrivalMinutes: dep + 20 })),
  ]

  // SABADO — every 45 min, 07:00–19:00
  const sabSpecs: TripSpec[] = [
    ...range(420, 1140, 45).map(dep => ({ dayTypeId: sabado.id, routeId: r001out.id, departureMinutes: dep, arrivalMinutes: dep + 25 })),
    ...range(440, 1160, 45).map(dep => ({ dayTypeId: sabado.id, routeId: r001in.id,  departureMinutes: dep, arrivalMinutes: dep + 25 })),
    ...range(420, 1140, 45).map(dep => ({ dayTypeId: sabado.id, routeId: r002out.id, departureMinutes: dep, arrivalMinutes: dep + 20 })),
    ...range(435, 1155, 45).map(dep => ({ dayTypeId: sabado.id, routeId: r002in.id,  departureMinutes: dep, arrivalMinutes: dep + 20 })),
  ]

  const duCreated  = await seedTrips(duSpecs)
  const sabCreated = await seedTrips(sabSpecs)
  console.log(`  ✓ trips  (Dia Útil: +${duCreated}/${duSpecs.length}, Sábado: +${sabCreated}/${sabSpecs.length})`)

  console.log('Transit seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
