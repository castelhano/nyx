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

  private async resolveByPattern(date: Date): Promise<DayType> {
    const dayTypes = await this.prisma.dayType.findMany({
      where:   { pattern: { not: Prisma.DbNull } },
      orderBy: { priority: 'asc' },
    })

    for (const dt of dayTypes) {
      if (this.matchesPattern(date, dt.pattern as unknown as DayTypePattern)) {
        return dt as unknown as DayType
      }
    }

    throw new NotFoundException(
      `No DayType pattern covers ${date.toISOString().slice(0, 10)} — check priority and pattern configuration`,
    )
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
