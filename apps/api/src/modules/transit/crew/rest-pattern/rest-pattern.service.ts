import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  restPatternSchema, REST_PATTERN_RE, restGroupIndex, restGroupOffsets,
  RestPattern, CreateRestPatternDto, UpdateRestPatternDto,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import { localToday, toDbDate } from '../../timetabling/plan-validity'

// the crew members of a pattern per current shift, counted per group
export interface RestPatternGroups {
  offsets: number[]
  total:   number
  shifts:  { shiftId: string | null; code: string; counts: number[]; outside: number }[]
  // shifts with the pattern as their default
  defaultOf: { id: string; code: string; name: string }[]
}

@Injectable()
export class RestPatternService extends BaseService<RestPattern, CreateRestPatternDto, UpdateRestPatternDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'restPattern', restPatternSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }

  override async create(dto: CreateRestPatternDto): Promise<RestPattern> {
    return super.create({ ...dto, pattern: RestPatternService.checked(dto.pattern) })
  }

  override async update(id: string, dto: UpdateRestPatternDto): Promise<RestPattern> {
    return super.update(id, dto.pattern === undefined ? dto : { ...dto, pattern: RestPatternService.checked(dto.pattern) })
  }

  // ── groups ──────────────────────────────────────────────────────────────────

  // active crew members following the pattern — their own, or their current shift's
  private async members(id: string) {
    const today = toDbDate(localToday())
    const current = { validFrom: { lte: today }, OR: [{ validTo: null }, { validTo: { gte: today } }] }
    return this.prisma.crewMember.findMany({
      where: {
        employee: { status: 'ACTIVE' },
        OR: [{ restPatternId: id }, { restPatternId: null, shifts: { some: { ...current, shift: { restPatternId: id } } } }],
      },
      orderBy: { employee: { code: 'asc' } },
      select:  { id: true, restOffset: true, shifts: { where: current, take: 1, select: { shift: { select: { id: true, code: true } } } } },
    })
  }

  private async pattern(id: string) {
    const p = await this.prisma.restPattern.findUnique({ where: { id }, select: { pattern: true, staggered: true } })
    if (!p) throw new NotFoundException('Regime não encontrado')
    return p
  }

  async groups(id: string): Promise<RestPatternGroups> {
    const [p, members, defaultOf] = await Promise.all([
      this.pattern(id), this.members(id),
      this.prisma.crewShift.findMany({ where: { restPatternId: id }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    ])
    const offsets = restGroupOffsets(p)
    const byShift = new Map<string, RestPatternGroups['shifts'][number]>()
    for (const m of members) {
      const shift = m.shifts[0]?.shift
      const key = shift?.id ?? '-'
      const row = byShift.get(key) ?? { shiftId: shift?.id ?? null, code: shift?.code ?? 'Sem turno', counts: offsets.map(() => 0), outside: 0 }
      byShift.set(key, row)
      const g = restGroupIndex(p, m.restOffset)
      if (g == null) row.outside++
      else row.counts[g]++
    }
    return { offsets, total: members.length, shifts: [...byShift.values()].sort((a, b) => a.code.localeCompare(b.code)), defaultOf }
  }

  // Evens out the groups within each shift, moving as few crew members as possible; someone
  // between groups goes to one first. Returns how many changed group.
  async balance(id: string): Promise<{ moved: number }> {
    const [p, members] = await Promise.all([this.pattern(id), this.members(id)])
    const offsets = restGroupOffsets(p)
    const G = offsets.length
    const byShift = new Map<string, { id: string; offset: number; group: number | null }[]>()
    for (const m of members) {
      const key = m.shifts[0]?.shift.id ?? '-'
      byShift.set(key, [...(byShift.get(key) ?? []), { id: m.id, offset: m.restOffset, group: restGroupIndex(p, m.restOffset) }])
    }
    const updates: { id: string; restOffset: number }[] = []
    for (const list of byShift.values()) {
      const counts = offsets.map((_, g) => list.filter(m => m.group === g).length)
      // targets: everyone base, the fullest groups one more
      const base = Math.floor(list.length / G), extra = list.length % G
      const order = counts.map((c, g) => ({ c, g })).sort((a, b) => b.c - a.c || a.g - b.g)
      const target = new Array<number>(G).fill(base)
      order.slice(0, extra).forEach(({ g }) => { target[g]++ })
      // who moves: the ones between groups, then the last ones of each overfull group
      const movers = list.filter(m => m.group == null)
      for (let g = 0; g < G; g++) {
        const inGroup = list.filter(m => m.group === g)
        movers.push(...inGroup.slice(target[g]))
        counts[g] = Math.min(counts[g], target[g])
      }
      for (const m of movers) {
        const g = counts.findIndex((c, i) => c < target[i])
        if (g < 0) break
        counts[g]++
        if (offsets[g] !== m.offset) updates.push({ id: m.id, restOffset: offsets[g] })
      }
    }
    await this.prisma.$transaction(updates.map(u => this.prisma.crewMember.update({ where: { id: u.id }, data: { restOffset: u.restOffset } })))
    return { moved: updates.length }
  }

  // upper-cased, only T/F, at least one day off
  private static checked(raw: string): string {
    const pattern = String(raw ?? '').replace(/\s/g, '').toUpperCase()
    if (!REST_PATTERN_RE.test(pattern)) throw new BadRequestException('Ciclo: use só T (trabalha) e F (folga)')
    if (!pattern.includes('F')) throw new BadRequestException('O ciclo precisa de ao menos uma folga')
    return pattern
  }
}
