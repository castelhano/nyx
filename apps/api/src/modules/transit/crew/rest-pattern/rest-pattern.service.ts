import { BadRequestException, Injectable } from '@nestjs/common'
import { restPatternSchema, REST_PATTERN_RE, RestPattern, CreateRestPatternDto, UpdateRestPatternDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

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

  // upper-cased, only T/F, at least one day off
  private static checked(raw: string): string {
    const pattern = String(raw ?? '').replace(/\s/g, '').toUpperCase()
    if (!REST_PATTERN_RE.test(pattern)) throw new BadRequestException('Ciclo: use só T (trabalha) e F (folga)')
    if (!pattern.includes('F')) throw new BadRequestException('O ciclo precisa de ao menos uma folga')
    return pattern
  }
}
