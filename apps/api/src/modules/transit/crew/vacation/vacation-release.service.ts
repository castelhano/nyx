import { Injectable } from '@nestjs/common'
import type { DutySummary, VacationRelease } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitCrewConfigService } from '../../settings/transit-crew-config.service'
import { DailyOperationService } from '../../daily/daily-operation.service'
import { addDays, dayOf, toDbDate } from '../../timetabling/plan-validity'
import { vacationTypeId } from '../crew-absence-type/system-types'

// Férias on days already generated: the crew member's duties (PLANNED / PUBLISHED days — a
// published change is logged and reaches the crew) are released. With a ferista, each goes to him
// when he is free on the day (nothing but a generated day off — he follows the titular's days),
// not absent and the rest to his neighboring days holds; otherwise it's left without anyone for
// the generator. Shortening or deleting the férias redoes nothing — the next generation does.
@Injectable()
export class VacationReleaseService {
  constructor(
    private readonly prisma:     PrismaService,
    private readonly daily:      DailyOperationService,
    private readonly crewConfig: TransitCrewConfigService,
  ) {}

  async release(occurrenceId: string, userId?: string): Promise<VacationRelease> {
    const none = { released: 0, covered: 0 }
    const o = await this.prisma.crewOccurrence.findUnique({
      where:  { id: occurrenceId },
      select: { crewMemberId: true, coverCrewMemberId: true, kind: true, status: true, absenceTypeId: true, startDate: true, endDate: true },
    })
    if (!o || o.kind !== 'ABSENCE' || o.status !== 'APPROVED' || o.absenceTypeId !== await vacationTypeId(this.prisma)) return none
    const range = { gte: o.startDate, lte: o.endDate }

    // the titular's generated days off give way to the férias
    await this.prisma.rosterEntry.deleteMany({ where: { crewMemberId: o.crewMemberId, date: range, kind: 'DAY_OFF', source: 'GENERATED' } })
    const held = await this.prisma.rosterEntry.findMany({
      where:   { crewMemberId: o.crewMemberId, date: range, dailyDutyId: { not: null }, dailyDuty: { operation: { status: { in: ['PLANNED', 'PUBLISHED'] } } } },
      orderBy: { date: 'asc' },
      select:  { date: true, dailyDutyId: true, dailyDuty: { select: { summary: true, dailyOperationId: true, operation: { select: { scopeId: true } } } } },
    })
    let covered = 0
    for (const e of held) {
      const duty = e.dailyDuty!
      const cover = o.coverCrewMemberId
      if (cover && await this.coverFits(cover, e.date, duty.summary as DutySummary | null, duty.operation.scopeId)) {
        await this.prisma.rosterEntry.deleteMany({ where: { crewMemberId: cover, date: e.date, kind: 'DAY_OFF', source: 'GENERATED' } })
        await this.daily.assignCrew(duty.dailyOperationId, e.dailyDutyId!, cover, userId)
        covered++
      } else {
        await this.daily.assignCrew(duty.dailyOperationId, e.dailyDutyId!, null, userId)
      }
    }
    return { released: held.length, covered }
  }

  // the ferista takes the duty: no other duty / fixed day off on the date, no absence, and the
  // rest to the day before / after at least the floor
  private async coverFits(cover: string, date: Date, s: DutySummary | null, scopeId: string): Promise<boolean> {
    if (s?.startMinutes == null || s.endMinutes == null) return false
    const day = dayOf(date)
    const [entries, absent, settings] = await Promise.all([
      this.prisma.rosterEntry.findMany({
        where:  { crewMemberId: cover, date: { gte: toDbDate(addDays(day, -1)), lte: toDbDate(addDays(day, 1)) } },
        select: { date: true, kind: true, source: true, dailyDuty: { select: { summary: true } } },
      }),
      this.prisma.crewOccurrence.count({ where: { crewMemberId: cover, kind: 'ABSENCE', status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } } }),
      this.crewConfig.get(scopeId),
    ])
    if (absent) return false
    if (entries.some(e => dayOf(e.date) === day && !(e.kind === 'DAY_OFF' && e.source === 'GENERATED'))) return false
    const floor = settings.range.interShiftRest.floor
    const span = (e: typeof entries[number]) => e.dailyDuty?.summary as DutySummary | null
    const before = entries.filter(e => dayOf(e.date) === addDays(day, -1)).map(span).flatMap(x => x?.endMinutes ?? [])
    const after  = entries.filter(e => dayOf(e.date) === addDays(day, 1)).map(span).flatMap(x => x?.startMinutes ?? [])
    if (before.some(end => 1440 + s.startMinutes! - end < floor)) return false
    if (after.some(start => 1440 + start - s.endMinutes! < floor)) return false
    return true
  }
}
