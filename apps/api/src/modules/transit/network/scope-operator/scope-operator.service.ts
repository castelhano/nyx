import { BadRequestException, Injectable } from '@nestjs/common'
import { scopeOperatorSchema, ScopeOperator, CreateScopeOperatorDto, UpdateScopeOperatorDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class ScopeOperatorService extends BaseService<ScopeOperator, CreateScopeOperatorDto, UpdateScopeOperatorDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'scopeOperator', scopeOperatorSchema, 'transit')
  }

  override async create(dto: CreateScopeOperatorDto): Promise<ScopeOperator> {
    await this.assertShareTotal(dto.scopeId, null, dto.share)
    return super.create(dto)
  }

  override async update(id: string, dto: UpdateScopeOperatorDto): Promise<ScopeOperator> {
    if (dto.share !== undefined) {
      const current = await this.findOne(id)
      await this.assertShareTotal(current.scopeId, id, dto.share)
    }
    return super.update(id, dto)
  }

  // the Scope's operators share its fleet (vehicle solver) — the shares set can't pass 100%
  private async assertShareTotal(scopeId: string, excludeId: string | null, share: unknown): Promise<void> {
    const value = share === '' || share == null ? 0 : Number(share)
    const others = await this.prisma.scopeOperator.aggregate({
      where: { scopeId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      _sum:  { share: true },
    })
    const total = (others._sum.share ?? 0) + value
    if (total > 100) throw new BadRequestException(`A soma das participações do escopo passaria de 100% (${total.toLocaleString('pt-BR')}%)`)
  }
}
