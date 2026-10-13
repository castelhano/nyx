import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  hourBankSchema,
  type DutySummary, type HourBankEntryInput, type HourBankMember, type HourBankMonth, type HourBankMovement, type HourBankOverview, type HourBankStatement,
} from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { resourceRegistry } from '../../../core/resource-registry'
import { TransitRosterConfigService } from '../settings/transit-roster-config.service'
import { addDays, dayOf, localToday, toDbDate, type Day } from '../timetabling/plan-validity'
import { forecastDay, importedDay, lastDayOf, monthOf, nextMonth, runBank } from './hour-bank.calc'
import { bareCode } from './timesheet-parser'

type Member = HourBankMember & { branchId: string }

// The hour bank of an empresa's crew members. The days of an open month are read live — the
// imported frequency (CrewTimesheetDay) where it has the day, else the roster's forecast —
// together with the manual launches (saldo inicial, ajustes). Closing a month freezes its days
// as DAY entries and keeps each one's result (HourBankLot); only the last closed month reopens.
@Injectable()
export class HourBankService {
  constructor(
    private readonly prisma:       PrismaService,
    private readonly rosterConfig: TransitRosterConfigService,
  ) {
    resourceRegistry.push({ domain: 'transit', resource: 'hour-bank', schema: hourBankSchema })
  }

  async overview(branchId: string, month: string): Promise<HourBankOverview> {
    assertMonth(month)
    const start = await this.start(branchId)
    const closings = await this.closings(branchId)
    const lastClosed = closings.at(-1) ?? null
    const base = { branchId, month, start, closed: closings.includes(month), lastClosed, imported: null }
    if (!start) return { ...base, rows: [] }
    const members = await this.members(branchId)
    const results = await this.run(members, start, month, new Set(closings))
    const rows = members.map(m => ({ ...publicMember(m), ...(results.get(m.crewMemberId)?.months.at(-1) ?? emptyMonth(month)) }))
    const span = await this.prisma.crewTimesheetDay.aggregate({
      where: { crewMemberId: { in: members.map(m => m.crewMemberId) }, date: { gte: toDbDate(`${month}-01`), lte: toDbDate(lastDayOf(month)) } },
      _min:  { date: true }, _max: { date: true },
    })
    return {
      ...base, rows,
      imported: span._min.date && span._max.date ? { from: dayOf(span._min.date), to: dayOf(span._max.date) } : null,
    }
  }

  // the crew member's months from the bank's start to `month`, and every movement in them
  async statement(crewMemberId: string, month: string): Promise<HourBankStatement> {
    assertMonth(month)
    const m = await this.prisma.crewMember.findUnique({ where: { id: crewMemberId }, select: { employee: { select: { branchId: true } } } })
    if (!m) throw new NotFoundException('Operador não encontrado')
    const branchId = m.employee.branchId
    const start = await this.start(branchId)
    if (!start) throw new BadRequestException('A empresa não tem banco de horas — defina o mês de início nas configurações da escala')
    const member = (await this.members(branchId, [crewMemberId]))[0]
    if (!member) throw new NotFoundException('Operador não encontrado')
    const closed = new Set(await this.closings(branchId))
    const r = (await this.run([member], start, month, closed)).get(crewMemberId)!
    // previsto × realizado of the months since the start (a closed one: its frozen days)
    const since = r.months.map(x => x.month).filter(x => x >= start)
    const forecast = since.length ? (await this.liveDays([member], since[0], since.at(-1)!, true)).get(crewMemberId) ?? [] : []
    const compare = since.map(x => ({
      month:    x,
      forecast: forecast.filter(d => monthOf(d.date) === x).reduce((n, d) => n + d.minutes, 0),
      actual:   r.movements.filter(d => d.kind === 'DAY' && monthOf(d.date) === x).reduce((n, d) => n + d.minutes, 0),
    }))
    return { member: publicMember(member), months: r.months, movements: r.movements, compare }
  }

  // the current balance of each crew member of the empresa — the roster screen's column
  async balances(branchId: string): Promise<Map<string, number>> {
    const start = await this.start(branchId)
    if (!start) return new Map()
    const month = monthOf(localToday())
    if (month < start) return new Map()
    const members = await this.members(branchId)
    const results = await this.run(members, start, month, new Set(await this.closings(branchId)))
    return new Map([...results].map(([id, r]) => [id, r.months.at(-1)?.balance ?? 0]))
  }

  // Each crew member's position at the start of `day` (the movements before it) — what the roster
  // generator compensates by: the previous month's credit still unused (it expires at the end of
  // the day's month), the month's own, the negative carried; null without an hour bank
  async positionsAt(branchId: string, day: Day): Promise<Map<string, BankPosition> | null> {
    const start = await this.start(branchId)
    const month = monthOf(day)
    if (!start || month < start) return null
    const members = await this.members(branchId)
    const results = await this.run(members, start, month, new Set(await this.closings(branchId)))
    const out = new Map<string, BankPosition>()
    for (const m of members) {
      const r = results.get(m.crewMemberId)!
      const months = r.months.map(x => ({ month: x.month, closed: x.closed, moves: r.movements.filter(v => monthOf(v.date) === x.month && v.date < day) }))
      const at = runBank(months).at(-1)!
      out.set(m.crewMemberId, { expiring: at.expiring, lot: at.lot, negative: at.negative, journey: m.journey })
    }
    return out
  }

  // Closes the month: its days frozen (as read now), each crew member's lot kept. The months
  // before it (from the start) must be closed, and the month over.
  async close(branchId: string, month: string, userId?: string): Promise<void> {
    assertMonth(month)
    const start = await this.start(branchId)
    if (!start) throw new BadRequestException('A empresa não tem banco de horas')
    if (month < start) throw new BadRequestException('Mês anterior ao início do banco')
    const closings = await this.closings(branchId)
    if (closings.includes(month)) throw new BadRequestException('Mês já fechado')
    const previous = nextMonth(month, -1)
    if (month > start && !closings.includes(previous)) throw new BadRequestException(`Feche ${fmtMonth(previous)} antes`)
    if (lastDayOf(month) >= localToday()) throw new BadRequestException('O mês ainda não terminou')

    const members = await this.members(branchId)
    const live = await this.liveDays(members, month, month)
    const results = await this.run(members, start, month, new Set(closings))
    await this.prisma.$transaction(async tx => {
      await tx.hourBankEntry.createMany({
        data: members.flatMap(m => (live.get(m.crewMemberId) ?? []).map(x => ({
          crewMemberId: m.crewMemberId, date: toDbDate(x.date), kind: 'DAY' as const, source: x.source,
          minutes: x.minutes, payMinutes: x.payMinutes, holidayMinutes: x.holidayMinutes, occurrence: x.occurrence, userId: userId ?? null,
        }))),
      })
      await tx.hourBankLot.deleteMany({ where: { crewMemberId: { in: members.map(m => m.crewMemberId) }, month: toDbDate(`${month}-01`) } })
      await tx.hourBankLot.createMany({
        data: members.map(m => {
          const r = results.get(m.crewMemberId)!.months.at(-1)!
          return {
            crewMemberId: m.crewMemberId, month: toDbDate(`${month}-01`),
            credit: r.credit, debit: r.debit, minutes: r.lot, payout: r.payout, pay: r.pay, holiday: r.holiday, forgiven: r.forgiven,
            negative: Math.min(0, r.negative + r.forgiven),
          }
        }),
      })
      await tx.hourBankClosing.create({ data: { branchId, month: toDbDate(`${month}-01`), userId: userId ?? null } })
    })
  }

  // reopens the last closed month: its frozen days and lots go away, read live again
  async reopen(branchId: string, month: string): Promise<void> {
    assertMonth(month)
    const closings = await this.closings(branchId)
    if (closings.at(-1) !== month) throw new BadRequestException('Só o último mês fechado pode ser reaberto')
    const ids = (await this.members(branchId)).map(m => m.crewMemberId)
    const range = { gte: toDbDate(`${month}-01`), lte: toDbDate(lastDayOf(month)) }
    await this.prisma.$transaction([
      this.prisma.hourBankEntry.deleteMany({ where: { crewMemberId: { in: ids }, kind: 'DAY', date: range } }),
      this.prisma.hourBankLot.deleteMany({ where: { crewMemberId: { in: ids }, month: toDbDate(`${month}-01`) } }),
      this.prisma.hourBankClosing.delete({ where: { branchId_month: { branchId, month: toDbDate(`${month}-01`) } } }),
    ])
  }

  // a manual launch — saldo inicial (dated on the first day of its lot's month) or ajuste — in
  // an open month
  async addEntry(dto: HourBankEntryInput, userId?: string): Promise<void> {
    const m = await this.prisma.crewMember.findUnique({ where: { id: dto.crewMemberId }, select: { employee: { select: { branchId: true } } } })
    if (!m) throw new NotFoundException('Operador não encontrado')
    if (!dto.minutes) throw new BadRequestException('Informe as horas')
    const date = dto.kind === 'OPENING' ? `${monthOf(dto.date)}-01` : dto.date
    if ((await this.closings(m.employee.branchId)).includes(monthOf(date))) throw new BadRequestException('Mês fechado — reabra antes')
    await this.prisma.hourBankEntry.create({
      data: { crewMemberId: dto.crewMemberId, date: toDbDate(date), kind: dto.kind, source: 'MANUAL', minutes: dto.minutes, notes: dto.notes || null, userId: userId ?? null },
    })
  }

  // Saldos iniciais from a CSV (matrícula + balance as H:MM or decimal hours): the closing
  // balance of the month before the bank's start, launched as that month's lot — it expires at
  // the start month's closing. A negative balance only counts on an odd month: an even month's
  // closing has already forgiven it. Re-importing replaces the crew members' opening balances.
  async importOpening(branchId: string, text: string, userId?: string): Promise<OpeningImportSummary> {
    const start = await this.start(branchId)
    if (!start) throw new BadRequestException('Defina antes o mês de início do banco (Configurações › Escala)')
    const month = nextMonth(start, -1)
    const rows = parseOpeningCsv(text)
    if (!rows.length) throw new BadRequestException('Nenhuma linha reconhecida — esperado matrícula e saldo (H:MM ou decimal)')
    const members = await this.prisma.crewMember.findMany({ where: { employee: { branchId } }, select: { id: true, employee: { select: { code: true } } } })
    const byCode = new Map(members.map(m => [bareCode(m.employee.code), m.id]))
    const forgiven = Number(month.slice(5, 7)) % 2 === 0
    const unknown: string[] = []
    const data: { crewMemberId: string; minutes: number }[] = []
    let zeroed = 0
    for (const r of rows) {
      const id = byCode.get(bareCode(r.code))
      if (!id) { unknown.push(r.code); continue }
      if (r.minutes < 0 && forgiven) { zeroed++; continue }
      if (r.minutes) data.push({ crewMemberId: id, minutes: r.minutes })
    }
    const date = toDbDate(`${month}-01`)
    await this.prisma.$transaction([
      this.prisma.hourBankEntry.deleteMany({ where: { crewMemberId: { in: members.map(m => m.id) }, kind: 'OPENING' } }),
      this.prisma.hourBankEntry.createMany({
        data: data.map(d => ({ ...d, date, kind: 'OPENING' as const, source: 'MANUAL', notes: 'Saldo inicial (importado)', userId: userId ?? null })),
      }),
    ])
    return { month, loaded: data.length, zeroed, unknown }
  }

  async removeEntry(id: string): Promise<void> {
    const e = await this.prisma.hourBankEntry.findUnique({ where: { id }, select: { kind: true, date: true, crewMember: { select: { employee: { select: { branchId: true } } } } } })
    if (!e) throw new NotFoundException('Lançamento não encontrado')
    if (e.kind === 'DAY') throw new BadRequestException('Dias de mês fechado só saem reabrindo o mês')
    if ((await this.closings(e.crewMember.employee.branchId)).includes(monthOf(dayOf(e.date)))) throw new BadRequestException('Mês fechado — reabra antes')
    await this.prisma.hourBankEntry.delete({ where: { id } })
  }

  // ── reading ────────────────────────────────────────────────────────────────

  private async start(branchId: string): Promise<string | null> {
    return (await this.rosterConfig.get(branchId)).hourBankStart ?? null
  }

  private async closings(branchId: string): Promise<string[]> {
    const rows = await this.prisma.hourBankClosing.findMany({ where: { branchId }, orderBy: { month: 'asc' }, select: { month: true } })
    return rows.map(r => monthOf(dayOf(r.month)))
  }

  // the empresa's active crew members (or the given ones): journey and hour value from the contract
  private async members(branchId: string, ids?: string[]): Promise<Member[]> {
    const settings = await this.rosterConfig.get(branchId)
    const rows = await this.prisma.crewMember.findMany({
      where:   ids ? { id: { in: ids } } : { employee: { branchId, status: 'ACTIVE' } },
      orderBy: { employee: { code: 'asc' } },
      select: {
        id: true, weeklyHours: true,
        employee: {
          select: {
            code: true, fullName: true, preferredName: true, branchId: true,
            contracts: { where: { status: 'ACTIVE' }, orderBy: { startDate: 'desc' }, take: 1, select: { weeklyHours: true, workDaysPerWeek: true, salary: true } },
          },
        },
      },
    })
    return rows.map(r => {
      const c = r.employee.contracts[0]
      const weekly = r.weeklyHours ?? c?.weeklyHours ?? settings.defaultWeeklyHours
      const days = c?.workDaysPerWeek ?? 6
      return {
        crewMemberId: r.id, code: r.employee.code, name: r.employee.preferredName || r.employee.fullName, branchId: r.employee.branchId,
        journey:   Math.round(weekly * 60 / days),
        hourValue: c ? Math.round(Number(c.salary) / (weekly * 5) * 100) / 100 : 0,
      }
    })
  }

  // Each member's months (bank start — or an earlier opening balance — .. `to`) and movements:
  // the persisted entries, plus the live days of the open months.
  private async run(members: Member[], start: string, to: string, closed: Set<string>) {
    const ids = members.map(m => m.crewMemberId)
    const earliest = await this.prisma.hourBankEntry.aggregate({ where: { crewMemberId: { in: ids } }, _min: { date: true } })
    const first = [start, earliest._min.date ? monthOf(dayOf(earliest._min.date)) : start].sort()[0]
    const months: string[] = []
    for (let m = first; m <= to; m = nextMonth(m)) months.push(m)
    const entries = await this.prisma.hourBankEntry.findMany({
      where:   { crewMemberId: { in: ids }, date: { gte: toDbDate(`${first}-01`), lte: toDbDate(lastDayOf(to)) } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select:  { id: true, crewMemberId: true, date: true, kind: true, source: true, minutes: true, payMinutes: true, holidayMinutes: true, occurrence: true, notes: true },
    })
    const open = months.filter(m => m >= start && !closed.has(m))
    const live = open.length ? await this.liveDays(members, open[0], open.at(-1)!) : new Map<string, LiveDay[]>()

    const entriesOf = groupBy(entries, e => e.crewMemberId)
    const out = new Map<string, { months: HourBankMonth[]; movements: HourBankMovement[] }>()
    for (const m of members) {
      const movements: HourBankMovement[] = [
        ...(entriesOf.get(m.crewMemberId) ?? []).map(e => ({
          id: e.id, date: dayOf(e.date), kind: e.kind, source: e.source as HourBankMovement['source'],
          minutes: e.minutes, payMinutes: e.payMinutes, holidayMinutes: e.holidayMinutes, occurrence: e.occurrence, notes: e.notes,
        })),
        ...(live.get(m.crewMemberId) ?? []).filter(x => !closed.has(monthOf(x.date))).map(x => ({
          id: null, date: x.date, kind: 'DAY' as const, source: x.source,
          minutes: x.minutes, payMinutes: x.payMinutes, holidayMinutes: x.holidayMinutes, occurrence: x.occurrence, notes: null,
        })),
      ].sort((a, b) => a.date.localeCompare(b.date) || Number(b.kind === 'OPENING') - Number(a.kind === 'OPENING'))
      const byMonth = groupBy(movements, x => monthOf(x.date))
      out.set(m.crewMemberId, {
        months:    runBank(months.map(month => ({ month, closed: closed.has(month), moves: byMonth.get(month) ?? [] }))),
        movements,
      })
    }
    return out
  }

  // The live days of [fromMonth, toMonth] per member — the imported frequency where it has the
  // day (a compensation there is real even on a day the roster had work), else the roster;
  // `forecastOnly`: the roster on every day
  private async liveDays(members: Member[], fromMonth: string, toMonth: string, forecastOnly = false): Promise<Map<string, LiveDay[]>> {
    const ids = members.map(m => m.crewMemberId)
    const from = `${fromMonth}-01`, to = lastDayOf(toMonth)
    const range = { gte: toDbDate(from), lte: toDbDate(to) }
    const branchIds = [...new Set(members.map(m => m.branchId))]
    const [sheet, roster, holidays] = await Promise.all([
      forecastOnly ? [] : this.prisma.crewTimesheetDay.findMany({ where: { crewMemberId: { in: ids }, date: range }, select: { crewMemberId: true, date: true, occurrence: true, extraMinutes: true, shortMinutes: true } }),
      this.prisma.rosterEntry.findMany({
        where:  { crewMemberId: { in: ids }, date: range, kind: { in: ['DUTY', 'STANDBY', 'COMP_OFF'] } },
        select: { crewMemberId: true, date: true, kind: true, dailyDuty: { select: { summary: true } } },
      }),
      this.prisma.holiday.findMany({ where: { date: range, OR: [{ branchId: null }, { branchId: { in: branchIds } }] }, select: { date: true, branchId: true } }),
    ])
    // by `${crewMemberId}|${day}`
    const sheetOf  = new Map(sheet.map(s => [`${s.crewMemberId}|${dayOf(s.date)}`, s]))
    const rosterOf = groupBy(roster, e => `${e.crewMemberId}|${dayOf(e.date)}`)
    const out = new Map<string, LiveDay[]>()
    for (const m of members) {
      const days: LiveDay[] = []
      for (let d: Day = from; d <= to; d = addDays(d, 1)) {
        const s = sheetOf.get(`${m.crewMemberId}|${d}`)
        if (s) {
          const x = importedDay(s, m.journey)
          if (x.minutes || x.payMinutes || x.holidayMinutes) days.push({ ...x, date: d, source: 'IMPORT' })
          continue
        }
        const held = (rosterOf.get(`${m.crewMemberId}|${d}`) ?? []).map(e => ({ kind: e.kind, paid: (e.dailyDuty?.summary as DutySummary | null)?.paidMinutes ?? 0 }))
        if (!held.length) continue
        const holiday = holidays.some(h => dayOf(h.date) === d && (!h.branchId || h.branchId === m.branchId))
        const x = forecastDay(held, m.journey, holiday)
        if (x && (x.minutes || x.payMinutes || x.holidayMinutes)) days.push({ ...x, date: d, source: 'FORECAST' })
      }
      out.set(m.crewMemberId, days)
    }
    return out
  }
}

export interface OpeningImportSummary {
  // the lot's month (the one before the start)
  month:   string
  loaded:  number
  // negative balances left out — forgiven at the (even) month's closing
  zeroed:  number
  // matrículas without a crew member of the empresa
  unknown: string[]
}

// "matricula,decimal,horas" / "matricula;saldo"...: the matrícula is the first column; the
// balance the H:MM one (signed), else a decimal number of hours (comma or dot)
export function parseOpeningCsv(text: string): { code: string; minutes: number }[] {
  const out: { code: string; minutes: number }[] = []
  for (const line of text.split(/\r?\n/)) {
    // ';' / tab separated: a comma is the decimal one
    const sep = /[;\t]/.test(line) ? /"([^"]*)"|([^;\t]+)/g : /"([^"]*)"|([^,]+)/g
    const cells = [...line.matchAll(sep)].map(m => (m[1] ?? m[2]).trim())
    const code = cells[0]
    if (!code || !/^\d+$/.test(code)) continue
    const rest = cells.slice(1)
    const hm = rest.find(c => /^-?\d+:\d{2}$/.test(c))
    if (hm) {
      const [h, m] = hm.replace('-', '').split(':').map(Number)
      out.push({ code, minutes: (hm.startsWith('-') ? -1 : 1) * (h * 60 + m) })
      continue
    }
    const dec = rest.find(c => /^-?\d+([.,]\d+)?$/.test(c))
    if (dec) out.push({ code, minutes: Math.round(Number(dec.replace(',', '.')) * 60) })
  }
  return out
}

export interface BankPosition { expiring: number; lot: number; negative: number; journey: number }

type LiveDay = Pick<HourBankMovement, 'minutes' | 'payMinutes' | 'holidayMinutes' | 'occurrence'> & { date: Day; source: 'IMPORT' | 'FORECAST' }

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const x of list) {
    const k = key(x)
    const g = out.get(k)
    if (g) g.push(x)
    else out.set(k, [x])
  }
  return out
}

const publicMember = ({ branchId: _b, ...m }: Member): HourBankMember => m
const emptyMonth = (month: string): HourBankMonth => ({
  month, closed: false, opening: 0, credit: 0, debit: 0, pay: 0, holiday: 0, expiring: 0, lot: 0, payout: 0, forgiven: 0, negative: 0, balance: 0,
})
const fmtMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`
function assertMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) throw new BadRequestException('Mês inválido')
}
