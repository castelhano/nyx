import { Injectable } from '@nestjs/common'
import { branchSchema, Branch, CreateBranchDto, UpdateBranchDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

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
        { name:  stringContains(search) },
        { taxId: stringContains(search) },
        { city:  stringContains(search) },
      ],
    }
  }
}
