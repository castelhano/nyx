import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { dayTypeSchema, DayType, CreateDayTypeDto, UpdateDayTypeDto, DayTypePattern } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class DayTypeService extends BaseService<DayType, CreateDayTypeDto, UpdateDayTypeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'dayType', dayTypeSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { name: stringContains(search) },
        { code: stringContains(search) },
      ],
    }
  }

  /**
   * Resolves which DayType applies to a given date for a specific line.
   *
   * Resolution order:
   *   1. LineCalendarException with sourceDayTypeId = null (unconditional override)
   *   2. Pattern matching among DayTypes ordered by priority asc
   *   3. LineCalendarException with sourceDayTypeId matching the pattern result
   *
   * Throws NotFoundException if no pattern covers the date (misconfiguration).
   */
  async resolveDayType(date: Date, lineId: string): Promise<DayType> {
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    // Step 1 — unconditional exception (sourceDayTypeId = null overrides any day in interval)
    const unconditional = await this.prisma.lineCalendarException.findFirst({
      where: {
        validFrom:       { lte: dateOnly },
        OR:              [{ validTo: null }, { validTo: { gte: dateOnly } }],
        sourceDayTypeId: null,
        lines:           { some: { lineId } },
      },
      include:  { overrideDayType: true },
      orderBy:  { validFrom: 'desc' },
    })
    if (unconditional) return unconditional.overrideDayType as unknown as DayType

    // Step 2 — pattern matching
    const base = await this.resolveByPattern(dateOnly)

    // Step 3 — conditional exception that matches the resolved base type
    const conditional = await this.prisma.lineCalendarException.findFirst({
      where: {
        validFrom:       { lte: dateOnly },
        OR:              [{ validTo: null }, { validTo: { gte: dateOnly } }],
        sourceDayTypeId: base.id,
        lines:           { some: { lineId } },
      },
      include:  { overrideDayType: true },
      orderBy:  { validFrom: 'desc' },
    })
    if (conditional) return conditional.overrideDayType as unknown as DayType

    return base
  }

  /**
   * Pure pattern-based composition of a period — how many dias úteis/sábados/etc it
   * has, ignoring per-line LineCalendarException (those are a per-line override, not
   * a property of the calendar itself). Used by DOP's "Composição do período".
   */
  async getCalendarComposition(from: Date, to: Date): Promise<{ dayTypeId: string; code: string; name: string; days: number }[]> {
    const patterns = await this.prisma.dayType.findMany({
      where:   { pattern: { not: Prisma.DbNull } },
      orderBy: { priority: 'asc' },
    })
    const patternedDayTypes = patterns as unknown as DayType[]

    const counts = new Map<string, number>()
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dt = this.pickByPattern(new Date(d), patternedDayTypes)
      counts.set(dt.id, (counts.get(dt.id) ?? 0) + 1)
    }

    return Array.from(counts.entries()).map(([dayTypeId, days]) => {
      const dt = patternedDayTypes.find(p => p.id === dayTypeId)!
      return { dayTypeId, code: dt.code, name: dt.name, days }
    })
  }

  private async resolveByPattern(date: Date): Promise<DayType> {
    const dayTypes = await this.prisma.dayType.findMany({
      where:   { pattern: { not: Prisma.DbNull } },
      orderBy: { priority: 'asc' },
    })
    return this.pickByPattern(date, dayTypes as unknown as DayType[])
  }

  private pickByPattern(date: Date, patternedDayTypes: DayType[]): DayType {
    for (const dt of patternedDayTypes) {
      if (this.matchesPattern(date, dt.pattern as unknown as DayTypePattern)) return dt
    }
    throw new NotFoundException(
      `No DayType pattern covers ${date.toISOString().slice(0, 10)} — check priority and pattern configuration`,
    )
  }

  /**
   * Batch counterpart of resolveDayType — pre-loads every DayType pattern and every
   * LineCalendarException overlapping [from, to] for the given lines in two queries,
   * then returns a pure in-memory resolver. Same 3-step precedence as resolveDayType,
   * just replayed against the pre-fetched arrays instead of a query per (date, lineId)
   * pair — needed once a caller resolves a whole period × line list (DOP aggregation),
   * where the per-call version would issue up to 2 queries per pair.
   */
  async buildDayTypeResolver(from: Date, to: Date, lineIds: string[]): Promise<(date: Date, lineId: string) => DayType> {
    const [patterns, exceptions] = await Promise.all([
      this.prisma.dayType.findMany({
        where:   { pattern: { not: Prisma.DbNull } },
        orderBy: { priority: 'asc' },
      }),
      lineIds.length > 0
        ? this.prisma.lineCalendarException.findMany({
            where: {
              validFrom: { lte: to },
              OR:        [{ validTo: null }, { validTo: { gte: from } }],
              lines:     { some: { lineId: { in: lineIds } } },
            },
            include: { overrideDayType: true, lines: { select: { lineId: true } } },
            orderBy: { validFrom: 'desc' },
          })
        : Promise.resolve([]),
    ])
    const patternedDayTypes = patterns as unknown as DayType[]

    return (date: Date, lineId: string): DayType => {
      const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())

      const applicable = exceptions.filter(e =>
        e.validFrom <= dateOnly
        && (e.validTo === null || e.validTo >= dateOnly)
        && e.lines.some(l => l.lineId === lineId),
      )

      const unconditional = applicable.find(e => e.sourceDayTypeId === null)
      if (unconditional) return unconditional.overrideDayType as unknown as DayType

      const base = this.pickByPattern(dateOnly, patternedDayTypes)

      const conditional = applicable.find(e => e.sourceDayTypeId === base.id)
      if (conditional) return conditional.overrideDayType as unknown as DayType

      return base
    }
  }

  private matchesPattern(date: Date, pattern: DayTypePattern): boolean {
    const isoDay = isoWeekday(date)

    if (pattern.type === 'weekdays') {
      return pattern.days.includes(isoDay)
    }

    if (pattern.type === 'month_window') {
      const year  = date.getFullYear()
      const month = date.getMonth()
      const daysInMonth = new Date(year, month + 1, 0).getDate()

      const all = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1))
      const candidates = pattern.baseWeekdays?.length
        ? all.filter(d => pattern.baseWeekdays!.includes(isoWeekday(d)))
        : all

      if (pattern.anchor === 'end') candidates.reverse()

      const window = candidates.slice(0, pattern.days)
      return window.some(d => d.getDate() === date.getDate())
    }

    return false
  }
}

function isoWeekday(date: Date): number {
  const day = date.getDay() // 0 = Sun
  return day === 0 ? 7 : day  // ISO: 1 = Mon … 7 = Sun
}
