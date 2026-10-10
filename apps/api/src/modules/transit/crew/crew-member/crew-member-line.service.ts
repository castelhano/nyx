import { BadRequestException, Injectable } from '@nestjs/common'
import { crewMemberLineSchema, CrewMemberLine, CreateCrewMemberLineDto, UpdateCrewMemberLineDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { TransitRosterConfigService } from '../../settings/transit-roster-config.service'

type LineRow = { crewMemberId: string; lineId: string; access?: string | null; rank?: number | null }

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
    if (!member) throw new BadRequestException('Condutor não encontrado')
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
    if (!operated) throw new BadRequestException('A linha não é operada pela empresa do condutor')

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
    if (dup) throw new BadRequestException(dup.lineId === row.lineId ? 'A linha já está cadastrada para o condutor' : `O condutor já tem a preferência ${row.rank}`)
  }
}
