import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  portalChangeRequestSchema, restGroupIndex, restGroupLabel, restGroupOffsets, restPatternWorks,
  type PortalChangeOptions, type PortalChangeRequest,
} from '@nyx/schemas'
import type { CrewRole } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { addDays, dayOf, toDbDate } from '../timetabling/plan-validity'
import { OPEN_CHANGE, changeRequestSelect, changeText, currentOf, settleChangeRequests } from '../crew/crew-member/crew-change-request'
import { PortalService } from './portal.service'
import type { PortalCrew } from './portal.guard'

// The crew member's lasting change requests (CrewChangeRequest) — his shift or his rest group, with
// no date. He asks and cancels here; staff reviews them in the Painel de Escala.

// the rest group preview: whole weeks from next Monday
const PREVIEW_WEEKS = 4

@Injectable()
export class PortalChangeRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portal: PortalService,
  ) {}

  // the shifts of his empresa and his pattern's groups, each with its days off in the preview weeks
  async options(crew: PortalCrew): Promise<PortalChangeOptions> {
    const now = (await currentOf(this.prisma, [crew.id])).get(crew.id)!
    const shifts = await this.prisma.crewShift.findMany({
      where:   { isActive: true, branches: { some: { branchId: crew.branchId } } },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
      select:  { id: true, name: true },
    })
    const p = now.pattern
    const offsets = p ? restGroupOffsets(p) : []
    let restGroups: PortalChangeOptions['restGroups'] = null
    if (p && offsets.length > 1) {
      const today = dayOf(new Date())
      const from = addDays(today, 7 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
      const to = addDays(from, PREVIEW_WEEKS * 7 - 1)
      const holidays = p.offOnHolidays
        ? new Set((await this.prisma.holiday.findMany({
          where:  { date: { gte: toDbDate(from), lte: toDbDate(to) }, OR: [{ branchId: null }, { branchId: crew.branchId }] },
          select: { date: true },
        })).map(h => dayOf(h.date)))
        : new Set<string>()
      const days = Array.from({ length: PREVIEW_WEEKS * 7 }, (_, i) => addDays(from, i))
      const mine = restGroupIndex(p, now.offset)
      restGroups = {
        patternName: p.name, from, to,
        options: offsets.map((offset, g) => ({
          offset, label: `Grupo ${restGroupLabel(g)}`, current: mine === g,
          off: days.filter(d => !restPatternWorks(p, offset, d, holidays.has(d))),
        })),
      }
    }
    return { shifts: shifts.map(s => ({ ...s, current: s.id === now.shiftId })), restGroups }
  }

  async list(crew: PortalCrew): Promise<PortalChangeRequest[]> {
    await settleChangeRequests(this.prisma, [crew.id])
    const rows = await this.prisma.crewChangeRequest.findMany({
      where:   { crewMemberId: crew.id },
      orderBy: { createdAt: 'desc' }, take: 50,
      select:  changeRequestSelect,
    })
    const out: PortalChangeRequest[] = []
    for (const r of rows) {
      out.push({
        id: r.id, kind: r.kind, status: r.status, change: changeText(r), notes: r.notes, reviewNotes: r.reviewNotes, createdAt: r.createdAt.toISOString(),
        position: r.status === 'QUEUED' ? await this.position(crew, r) : null,
      })
    }
    return out
  }

  // his place among the empresa's queued requests for the same shift / group — the oldest first
  private async position(crew: PortalCrew, r: { id: string; kind: 'SHIFT' | 'REST_GROUP'; shiftId: string | null; restPatternId: string | null; restOffset: number | null; createdAt: Date }): Promise<number> {
    const ahead = await this.prisma.crewChangeRequest.count({
      where: {
        kind: r.kind, status: 'QUEUED', id: { not: r.id }, createdAt: { lt: r.createdAt },
        ...(r.kind === 'SHIFT' ? { shiftId: r.shiftId } : { restPatternId: r.restPatternId, restOffset: r.restOffset }),
        crewMember: { role: crew.role as CrewRole, employee: { branchId: crew.branchId } },
      },
    })
    return ahead + 1
  }

  async create(crew: PortalCrew, raw: unknown): Promise<PortalChangeRequest> {
    const req = portalChangeRequestSchema.parse(raw)
    const permissions = await this.portal.permissions(crew)
    if (req.kind === 'SHIFT' && !permissions.requestShiftChange) throw new ForbiddenException('Sem permissão para pedir troca de turno')
    if (req.kind === 'REST_GROUP' && !permissions.requestRestGroupChange) throw new ForbiddenException('Sem permissão para pedir troca de grupo de folga')
    const open = await this.prisma.crewChangeRequest.count({ where: { crewMemberId: crew.id, kind: req.kind, status: { in: [...OPEN_CHANGE] } } })
    if (open) throw new UnprocessableEntityException(`Você já tem um pedido de ${req.kind === 'SHIFT' ? 'troca de turno' : 'troca de grupo de folga'} em aberto`)
    const now = (await currentOf(this.prisma, [crew.id])).get(crew.id)!

    let target: { shiftId?: string; restPatternId?: string; restOffset?: number }
    if (req.kind === 'SHIFT') {
      const shift = await this.prisma.crewShift.findFirst({ where: { id: req.shiftId, isActive: true, branches: { some: { branchId: crew.branchId } } }, select: { id: true } })
      if (!shift) throw new BadRequestException('Turno não encontrado')
      if (shift.id === now.shiftId) throw new BadRequestException('Você já está nesse turno')
      target = { shiftId: shift.id }
    } else {
      const p = now.pattern
      if (!p || restGroupOffsets(p).length < 2) throw new BadRequestException('Seu regime de folga não tem outros grupos')
      if (!restGroupOffsets(p).includes(req.restOffset)) throw new BadRequestException('Grupo não encontrado')
      if (restGroupIndex(p, now.offset) === restGroupIndex(p, req.restOffset)) throw new BadRequestException('Você já está nesse grupo')
      target = { restPatternId: p.id, restOffset: req.restOffset }
    }
    const created = await this.prisma.crewChangeRequest.create({
      data: { crewMemberId: crew.id, kind: req.kind, origin: 'PORTAL', ...target, fromShiftId: now.shiftId, fromOffset: now.offset, notes: req.notes?.trim() || null },
      select: { id: true },
    })
    return (await this.list(crew)).find(r => r.id === created.id)!
  }

  async cancel(crew: PortalCrew, id: string): Promise<PortalChangeRequest> {
    const { count } = await this.prisma.crewChangeRequest.updateMany({ where: { id, crewMemberId: crew.id, status: { in: [...OPEN_CHANGE] } }, data: { status: 'CANCELLED' } })
    if (!count) throw new NotFoundException('Pedido não encontrado ou já encerrado')
    return (await this.list(crew)).find(r => r.id === id)!
  }
}
