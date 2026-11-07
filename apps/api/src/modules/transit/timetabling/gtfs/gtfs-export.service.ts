import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import archiver from 'archiver'
import {
  gtfsExportRequestSchema, gtfsFileName,
  type DayTypePattern, type GtfsOptions, type GtfsPreview, type GtfsReport,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { DayTypeService } from '../day-type/day-type.service'
import { addDays, dayOf, inForceOn, toDbDate } from '../plan-validity'
import { gtfsCsv } from './gtfs-csv'
import { loadOperatorTrips, loadPublishedPlans, loadRoutes } from './gtfs-export.loader'
import { buildGtfsFeed, type GtfsFeed, type GtfsService } from './gtfs-feed.builder'

const DEFAULT_ROUTE_TYPE = 3 // bus

interface ScopeMetadata { organName?: string; agencyId?: string; agencyUrl?: string; agencyTimezone?: string; routeType?: number }

interface ResolvedExport {
  request: ReturnType<typeof gtfsExportRequestSchema.parse>
  // a plan per day type; empty when blocked
  plans:    { dayTypeId: string; vehiclePlanId: string; version: number }[]
  fileName: string
  feed:     GtfsFeed
}

// docs/architecture/transit/gtfs-export.md — one operator's feed of a day type, generated from the
// plan in force at the start of the period.
@Injectable()
export class GtfsExportService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly dayTypes: DayTypeService,
  ) {}

  async options(): Promise<GtfsOptions> {
    const [operators, dayTypes, latest] = await Promise.all([
      this.prisma.scopeOperator.findMany({
        orderBy: { abbr: 'asc' },
        select:  { id: true, abbr: true, scope: { select: { name: true } } },
      }),
      this.prisma.dayType.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true, pattern: true } }),
      this.prisma.gtfsExportDayType.groupBy({ by: ['scopeOperatorId', 'dayTypeId'], _max: { version: true } }),
    ])

    return {
      // no pattern (a JSON null here) means no dates to put in the calendar
      dayTypes:  dayTypes.filter(d => d.pattern).map(({ id, code, name }) => ({ id, code, name })),
      operators: operators.map(o => ({
        id: o.id, abbr: o.abbr, scopeName: o.scope.name,
        nextVersions: Object.fromEntries(
          latest.filter(l => l.scopeOperatorId === o.id).map(l => [l.dayTypeId, (l._max.version ?? 0) + 1]),
        ),
      })),
    }
  }

  async preview(body: unknown): Promise<GtfsPreview> {
    const { feed } = await this.resolve(body)
    return {
      lines:      feed.lines,
      report:     feed.report,
      serviceIds: [...new Set(feed.files.trips?.rows.map(r => r.service_id))],
      blockTrips: feed.files.trips?.rows.filter(r => r.block_id).length ?? 0,
    }
  }

  async export(body: unknown): Promise<{ fileName: string; zip: Buffer }> {
    const { request, plans, fileName, feed } = await this.resolve(body)
    const { blockers, errors } = feed.report

    if (blockers.length) throw new BadRequestException(blockers.join(' '))
    if (errors.length && !request.confirmErrors) throw new BadRequestException('O relatório tem erros: confirme para exportar sem esses itens')

    const zip = await zipFeed(feed)

    try {
      await this.prisma.gtfsExport.create({
        data: {
          scopeOperatorId: request.scopeOperatorId,
          periodStart:     toDbDate(request.periodStart),
          periodEnd:       toDbDate(request.periodEnd),
          report:          feed.report as unknown as Prisma.InputJsonValue,
          dayTypes:        { create: plans.map(p => ({ ...p, scopeOperatorId: request.scopeOperatorId })) },
        },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Essa versão já foi usada por este operador neste tipo de dia')
      throw e
    }

    return { fileName, zip }
  }

  private async resolve(body: unknown): Promise<ResolvedExport> {
    const parsed = gtfsExportRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('Parâmetros de exportação inválidos')
    const request = parsed.data

    const operator = await this.prisma.scopeOperator.findUniqueOrThrow({
      where:  { id: request.scopeOperatorId },
      select: { abbr: true, branchId: true, scopeId: true, scope: { select: { name: true, serviceMetadata: true } } },
    })
    const metadata = (operator.scope.serviceMetadata ?? {}) as ScopeMetadata

    const versions = new Map(request.dayTypes.map(d => [d.id, d.version]))
    const dayTypeIds = [...versions.keys()]
    const [dayTypes, published] = await Promise.all([
      this.prisma.dayType.findMany({ where: { id: { in: dayTypeIds } }, orderBy: { sortOrder: 'asc' } }),
      loadPublishedPlans(this.prisma, operator.scopeId, dayTypeIds),
    ])
    const fileName = gtfsFileName(operator.abbr, dayTypes.map(d => ({ code: d.code, version: versions.get(d.id)! })))

    const blockers: string[] = []
    if (!metadata.agencyId || !metadata.agencyUrl || !metadata.agencyTimezone) {
      blockers.push(`Preencha agency_id, agency_url e agency_timezone nos metadados do escopo ${operator.scope.name}.`)
    }

    const plans: ResolvedExport['plans'] = []
    for (const dayType of dayTypes) {
      const own = published.filter(p => p.dayTypeId === dayType.id)
      const inForce = own.find(p => inForceOn(p, request.periodStart))
      // one version per day type: a feed can't hold a plan change
      const next = own.find(p => p.validFrom && dayOf(p.validFrom) > request.periodStart && dayOf(p.validFrom) <= request.periodEnd)

      if (!dayType.pattern) blockers.push(`${dayType.name}: tipo de dia sem padrão de dias.`)
      if (!inForce) blockers.push(`${dayType.name}: nenhum plano em vigor em ${request.periodStart}.`)
      if (next) blockers.push(`${dayType.name}: outro plano entra em vigor em ${dayOf(next.validFrom!)}, dentro do período.`)
      if (inForce) plans.push({ dayTypeId: dayType.id, vehiclePlanId: inForce.id, version: versions.get(dayType.id)! })
    }

    if (blockers.length) {
      return { request, plans: [], fileName, feed: { files: {}, lines: [], report: emptyReport(blockers) } }
    }

    const services: GtfsService[] = await Promise.all(plans.map(async ({ dayTypeId, vehiclePlanId, version }) => {
      const dayType = dayTypes.find(d => d.id === dayTypeId)!
      const pattern = dayType.pattern as unknown as DayTypePattern
      return {
        dayType: { code: dayType.code, name: dayType.name, pattern: pattern },
        version,
        dates:   pattern.type === 'weekdays' ? [] : this.datesOf(pattern, request.periodStart, request.periodEnd),
        ...await loadOperatorTrips(this.prisma, vehiclePlanId, operator.branchId),
      }
    }))

    const routeIds = [...new Set(services.flatMap(s => s.blocks.flatMap(b => b.trips.map(t => t.routeId))))]

    const feed = buildGtfsFeed({
      agency: {
        id:       metadata.agencyId!,
        name:     metadata.organName || operator.scope.name,
        url:      metadata.agencyUrl!,
        timezone: metadata.agencyTimezone!,
      },
      routeType:     metadata.routeType ?? DEFAULT_ROUTE_TYPE,
      operatorAbbr:  operator.abbr,
      periodStart:   request.periodStart,
      periodEnd:     request.periodEnd,
      blockIdMode:   request.blockIdMode,
      services,
      routes:        await loadRoutes(this.prisma, routeIds),
    })

    return { request, plans, fileName, feed }
  }

  private datesOf(pattern: DayTypePattern, start: string, end: string): string[] {
    const dates: string[] = []
    for (let day = start; day <= end; day = addDays(day, 1)) {
      const [y, m, d] = day.split('-').map(Number)
      if (this.dayTypes.matchesPattern(new Date(y, m - 1, d), pattern)) dates.push(day)
    }
    return dates
  }
}

const emptyReport = (blockers: string[]): GtfsReport => ({ blockers, errors: [], warnings: [] })

function zipFeed(feed: GtfsFeed): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const chunks: Buffer[] = []
    archive.on('data', chunk => chunks.push(chunk))
    archive.on('error', reject)
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    for (const [name, table] of Object.entries(feed.files)) archive.append(gtfsCsv(table), { name: `${name}.txt` })
    void archive.finalize()
  })
}
