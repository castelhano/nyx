import { createHash } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { TimesheetImportSummary } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { dayOf, toDbDate, type Day } from '../timetabling/plan-validity'
import { monthOf } from './hour-bank.calc'
import { bareCode, decodeTimesheet, parseTimesheet } from './timesheet-parser'

const fmt = (d: Day) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

// Imports the frequency file of an empresa (Fase 3): each day becomes a CrewTimesheetDay — the
// real hours, replacing the forecast. The last import wins; a day whose content didn't change
// isn't written again. Days in a closed month of the hour bank are left alone (reopen it first).
@Injectable()
export class TimesheetImportService {
  constructor(private readonly prisma: PrismaService) {}

  async import(branchId: string, file: { buffer: Buffer; originalname: string }, userId?: string): Promise<TimesheetImportSummary> {
    const sheet = parseTimesheet(decodeTimesheet(file.buffer))
    if (!sheet.from || !sheet.to || !sheet.employees.length) throw new BadRequestException('Arquivo não reconhecido — esperado a "Listagem de Movimentos da Frequência"')

    // the file's empresa (its header) must be the one chosen
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId }, select: { name: true, taxId: true, company: { select: { legalName: true, taxId: true } } } })
    if (!branch) throw new NotFoundException('Empresa não encontrada')
    const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
    const sameName = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
    const matches = sheet.taxId && digits(branch.taxId)
      ? sheet.taxId === digits(branch.taxId)
      : sameName(sheet.company, branch.company.legalName)
    if (!matches) throw new BadRequestException(`O arquivo é de ${sheet.company || 'outra empresa'} — não de ${branch.name}`)

    const members = await this.prisma.crewMember.findMany({ where: { employee: { branchId } }, select: { id: true, employee: { select: { code: true } } } })
    const byCode = new Map(members.map(m => [bareCode(m.employee.code), m.id]))
    const closed = new Set((await this.prisma.hourBankClosing.findMany({ where: { branchId }, select: { month: true } })).map(c => monthOf(dayOf(c.month))))
    const range = { gte: toDbDate(sheet.from), lte: toDbDate(sheet.to) }
    const ids = members.map(m => m.id)
    const [existing, vacations, roster] = await Promise.all([
      this.prisma.crewTimesheetDay.findMany({ where: { crewMemberId: { in: ids }, date: range }, select: { crewMemberId: true, date: true, hash: true } }),
      this.prisma.crewOccurrence.findMany({
        where:  { crewMemberId: { in: ids }, status: 'APPROVED', absenceType: { systemKey: 'VACATION' }, startDate: { lte: toDbDate(sheet.to) }, endDate: { gte: toDbDate(sheet.from) } },
        select: { crewMemberId: true, startDate: true, endDate: true },
      }),
      this.prisma.rosterEntry.findMany({ where: { crewMemberId: { in: ids }, date: range, kind: 'DUTY' }, select: { crewMemberId: true, date: true } }),
    ])
    const hashOf = new Map(existing.map(e => [`${e.crewMemberId}|${dayOf(e.date)}`, e.hash]))

    const imp = await this.prisma.crewTimesheetImport.create({
      data: { branchId, fromDate: toDbDate(sheet.from), toDate: toDbDate(sheet.to), fileName: file.originalname, userId: userId ?? null, summary: {} },
    })
    const unknown: string[] = [], divergences: string[] = []
    const write: Prisma.CrewTimesheetDayCreateManyInput[] = []
    let days = 0, skippedClosed = 0
    for (const e of sheet.employees) {
      const id = byCode.get(e.code)
      if (!id) { unknown.push(`${e.code} ${e.name}`); continue }
      for (const d of e.days) {
        if (d.date < sheet.from || d.date > sheet.to) continue
        days++
        if (closed.has(monthOf(d.date))) { skippedClosed++; continue }
        const hash = createHash('sha1').update(`${d.occurrence}|${d.extra}|${d.short}|${d.worked}`).digest('hex')
        if (hashOf.get(`${id}|${d.date}`) === hash) continue
        write.push({ crewMemberId: id, date: toDbDate(d.date), occurrence: d.occurrence, extraMinutes: d.extra, shortMinutes: d.short, workedMinutes: d.worked, hash, importId: imp.id })
        if (d.occurrence.startsWith('COMPENSACAO') && roster.some(r => r.crewMemberId === id && dayOf(r.date) === d.date)) {
          divergences.push(`${e.code} ${fmt(d.date)}: compensação no arquivo, mas escalado — vale a compensação`)
        }
      }
      // férias in the file's header without a launch in the system
      const v = e.vacation
      if (v && v.to >= sheet.from && v.from <= sheet.to) {
        const launched = vacations.some(o => o.crewMemberId === id && dayOf(o.startDate) <= v.from && dayOf(o.endDate) >= [v.to, sheet.to].sort()[0])
        if (!launched) divergences.push(`${e.code} ${e.name}: férias de ${fmt(v.from)} a ${fmt(v.to)} no arquivo, sem lançamento no sistema`)
      }
    }
    if (skippedClosed) divergences.unshift(`${skippedClosed} dia(s) em mês fechado do banco de horas não foram gravados — reabra o mês para reimportar`)

    if (write.length) {
      await this.prisma.$transaction([
        this.prisma.crewTimesheetDay.deleteMany({ where: { OR: write.map(w => ({ crewMemberId: w.crewMemberId, date: w.date })) } }),
        this.prisma.crewTimesheetDay.createMany({ data: write }),
      ])
    }
    const summary: TimesheetImportSummary = {
      from: sheet.from, to: sheet.to, members: sheet.employees.length - unknown.length, days, changed: write.length, unknown, divergences,
    }
    await this.prisma.crewTimesheetImport.update({ where: { id: imp.id }, data: { summary: summary as unknown as Prisma.InputJsonValue } })
    return summary
  }

  // the empresa's last imports
  async history(branchId: string) {
    const rows = await this.prisma.crewTimesheetImport.findMany({
      where: { branchId }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, fromDate: true, toDate: true, fileName: true, createdAt: true, summary: true },
    })
    return rows.map(r => ({ ...r, fromDate: dayOf(r.fromDate), toDate: dayOf(r.toDate) }))
  }
}

