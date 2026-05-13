import { Injectable } from '@nestjs/common'
import { branchSchema, Branch, CreateBranchDto, UpdateBranchDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'

@Injectable()
export class BranchService extends BaseService<Branch, CreateBranchDto, UpdateBranchDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'branch', branchSchema, 'core')
  }

  findByCompany(companyId: string): Promise<Branch[]> {
    return this.prisma.branch.findMany({
      where:   { companyId },
      orderBy: { name: 'asc' },
    }) as Promise<Branch[]>
  }

  async deactivate(id: string): Promise<Branch> {
    await this.findOne(id)
    return this.prisma.branch.update({
      where: { id },
      data:  { isActive: false },
    }) as Promise<Branch>
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { name:  { contains: search, mode: 'insensitive' as const } },
        { taxId: { contains: search, mode: 'insensitive' as const } },
        { city:  { contains: search, mode: 'insensitive' as const } },
      ],
    }
  }
}
