import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { crewMemberLineSchema, CrewMemberLine, CreateCrewMemberLineDto, UpdateCrewMemberLineDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { TransitRosterConfigService } from '../../settings/transit-roster-config.service'

type LineRow = { crewMemberId: string; lineId: string; access?: string | null; rank?: number | null }

// the operator's lines screen: every line his empresa operates (by line group) and his rows
export interface CrewLinesBoard {
  lineAccessMode:    'WHITELIST' | 'BLACKLIST'
  maxPreferredLines: number
  lines:   { id: string; code: string; name: string; groups: { id: string; name: string }[] }[]
  entries: { lineId: string; access: 'ENABLED' | 'BLOCKED' | null; rank: number | null }[]
  // the plantão as one more item: blocked (never on plantão, whatever the mode) and its rank
  standby: { blocked: boolean; rank: number | null }
}

// One row per (crew member, line). What `access` means comes from the crew member's empresa
// (roster settings lineAccessMode); a preferred line (rank) must be one he may operate.
@Injectable()
export class CrewMemberLineService extends BaseService<CrewMemberLine, CreateCrewMemberLineDto, UpdateCrewMemberLineDto> {
  constructor(
    prisma: PrismaService,
    private readonly roster: TransitRosterConfigService,
  ) {
    super(prisma, 'crewMemberLine', crewMemberLineSchema, 'transit')
  }

  override async create(dto: CreateCrewMemberLineDto): Promise<CrewMemberLine> {
    const row = CrewMemberLineService.normalized(dto)
    await this.assertValid(null, row)
    return super.create(row)
  }

  override async update(id: string, dto: UpdateCrewMemberLineDto): Promise<CrewMemberLine> {
    const current = await this.findOne(id)
    const row = CrewMemberLineService.normalized({ ...current, ...dto })
    await this.assertValid(id, row)
    return super.update(id, { lineId: row.lineId, access: row.access, rank: row.rank })
  }

  // ── board ───────────────────────────────────────────────────────────────────

  private async branchOf(crewMemberId: string): Promise<string> {
    const member = await this.prisma.crewMember.findUnique({ where: { id: crewMemberId }, select: { employee: { select: { branchId: true } } } })
    if (!member) throw new NotFoundException('Operador não encontrado')
    return member.employee.branchId
  }

  // active lines the empresa operates: one of their LineOperators, or (no operators) any
  // operator of their Scope
  private operatedLines(branchId: string) {
    return this.prisma.transitLine.findMany({
      where: {
        isActive: true,
        OR: [
          { operators: { some: { branchId } } },
          { operators: { none: {} }, scope: { operators: { some: { branchId } } } },
        ],
      },
      orderBy: { code: 'asc' },
      select: {
        id: true, code: true, name: true,
        lineGroups: { where: { lineGroup: { OR: [{ branchId: null }, { branchId }] } }, select: { lineGroup: { select: { id: true, name: true } } } },
      },
    })
  }

  async board(crewMemberId: string): Promise<CrewLinesBoard> {
    const branchId = await this.branchOf(crewMemberId)
    const [settings, lines, entries, member] = await Promise.all([
      this.roster.get(branchId),
      this.operatedLines(branchId),
      this.prisma.crewMemberLine.findMany({ where: { crewMemberId }, select: { lineId: true, access: true, rank: true } }),
      this.prisma.crewMember.findUnique({ where: { id: crewMemberId }, select: { standbyRank: true, standbyBlocked: true } }),
    ])
    return {
      lineAccessMode:    settings.lineAccessMode,
      maxPreferredLines: settings.maxPreferredLines,
      lines:   lines.map(l => ({ id: l.id, code: l.code, name: l.name, groups: l.lineGroups.map(g => g.lineGroup) })),
      entries: entries.map(e => ({ lineId: e.lineId, access: e.access, rank: e.rank })),
      standby: { blocked: !!member?.standbyBlocked, rank: member?.standbyRank ?? null },
    }
  }

  // replaces every row of the operator (and his plantão item) — the screen saves the whole board
  async replaceAll(crewMemberId: string, raw: unknown, rawStandby?: unknown): Promise<CrewLinesBoard> {
    const branchId = await this.branchOf(crewMemberId)
    const [{ lineAccessMode, maxPreferredLines }, lines] = await Promise.all([this.roster.get(branchId), this.operatedLines(branchId)])
    const operated = new Set(lines.map(l => l.id))
    const list = Array.isArray(raw) ? raw as { lineId: string; access?: string | null; rank?: number | null }[] : []
    const rows = list
      .map(e => ({ lineId: String(e.lineId), access: (e.access || null) as 'ENABLED' | 'BLOCKED' | null, rank: e.rank == null ? null : Number(e.rank) }))
      .filter(e => e.access || e.rank != null)

    const sb = (rawStandby ?? {}) as { blocked?: unknown; rank?: unknown }
    const standby = { blocked: sb.blocked === true, rank: sb.rank == null || sb.rank === '' ? null : Number(sb.rank) }
    if (standby.blocked && standby.rank != null) throw new BadRequestException('Plantão bloqueado não pode ser preferência')
    const seen = new Set<string>(), ranks = new Set<number>(standby.rank != null ? [standby.rank] : [])
    if (standby.rank != null && (standby.rank < 1 || standby.rank > maxPreferredLines)) throw new BadRequestException(`Preferências de 1 a ${maxPreferredLines}, sem repetir`)
    for (const r of rows) {
      if (!operated.has(r.lineId)) throw new BadRequestException('Há linha não operada pela empresa do operador')
      if (seen.has(r.lineId)) throw new BadRequestException('Linha repetida')
      seen.add(r.lineId)
      if (r.access && r.access !== (lineAccessMode === 'WHITELIST' ? 'ENABLED' : 'BLOCKED')) {
        throw new BadRequestException('Acesso não condiz com o modo de linhas da empresa')
      }
      if (r.rank == null) continue
      if (r.rank < 1 || r.rank > maxPreferredLines || ranks.has(r.rank)) throw new BadRequestException(`Preferências de 1 a ${maxPreferredLines}, sem repetir`)
      ranks.add(r.rank)
      if (lineAccessMode === 'WHITELIST' ? r.access !== 'ENABLED' : r.access === 'BLOCKED') {
        throw new BadRequestException('Linha preferencial precisa poder ser operada')
      }
    }
    await this.prisma.$transaction([
      this.prisma.crewMemberLine.deleteMany({ where: { crewMemberId } }),
      this.prisma.crewMemberLine.createMany({ data: rows.map(r => ({ crewMemberId, ...r })) }),
      this.prisma.crewMember.update({ where: { id: crewMemberId }, data: { standbyRank: standby.rank, standbyBlocked: standby.blocked } }),
    ])
    return this.board(crewMemberId)
  }

  // a cleared select / number arrives as '' — sanitizeDto would keep the old value
  private static normalized<D extends LineRow>(dto: D): D {
    return {
      ...dto,
      access: (dto.access as unknown) === '' ? null : dto.access ?? null,
      rank:   (dto.rank as unknown) === '' || dto.rank == null ? null : Number(dto.rank),
    }
  }

  private async assertValid(id: string | null, row: LineRow): Promise<void> {
    if (!row.access && row.rank == null) throw new BadRequestException('Informe o acesso ou a preferência')

    const member = await this.prisma.crewMember.findUnique({ where: { id: row.crewMemberId }, select: { employee: { select: { branchId: true } } } })
    if (!member) throw new BadRequestException('Operador não encontrado')
    const branchId = member.employee.branchId
    const { lineAccessMode, maxPreferredLines } = await this.roster.get(branchId)

    if (lineAccessMode === 'WHITELIST' && row.access === 'BLOCKED') {
      throw new BadRequestException('A empresa trabalha com linhas habilitadas — use "Habilitada" ou deixe o acesso vazio')
    }
    if (lineAccessMode === 'BLACKLIST' && row.access === 'ENABLED') {
      throw new BadRequestException('A empresa trabalha com linhas bloqueadas — use "Bloqueada" ou deixe o acesso vazio')
    }

    // the empresa must operate the line: one of its LineOperators, or any operator of its Scope
    const line = await this.prisma.transitLine.findUnique({
      where:  { id: row.lineId },
      select: { scopeId: true, operators: { select: { branchId: true } } },
    })
    if (!line) throw new BadRequestException('Linha não encontrada')
    const operated = line.operators.length
      ? line.operators.some(o => o.branchId === branchId)
      : !!line.scopeId && !!(await this.prisma.scopeOperator.findFirst({ where: { scopeId: line.scopeId, branchId }, select: { id: true } }))
    if (!operated) throw new BadRequestException('A linha não é operada pela empresa do operador')

    if (row.rank != null) {
      if (row.rank < 1 || row.rank > maxPreferredLines) {
        throw new BadRequestException(maxPreferredLines ? `Preferência de 1 a ${maxPreferredLines}` : 'A empresa não usa linhas preferenciais')
      }
      const canOperate = lineAccessMode === 'WHITELIST' ? row.access === 'ENABLED' : row.access !== 'BLOCKED'
      if (!canOperate) {
        throw new BadRequestException(lineAccessMode === 'WHITELIST'
          ? 'Linha preferencial precisa estar habilitada'
          : 'Linha bloqueada não pode ser preferencial')
      }
    }

    const dup = await this.prisma.crewMemberLine.findFirst({
      where:  { crewMemberId: row.crewMemberId, ...(id ? { id: { not: id } } : {}), OR: [{ lineId: row.lineId }, ...(row.rank != null ? [{ rank: row.rank }] : [])] },
      select: { lineId: true, rank: true },
    })
    if (dup) throw new BadRequestException(dup.lineId === row.lineId ? 'A linha já está cadastrada para o operador' : `O operador já tem a preferência ${row.rank}`)
  }
}
