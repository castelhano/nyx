import { Injectable } from '@nestjs/common'
import { companySchema, Company, CreateCompanyDto, UpdateCompanyDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'

@Injectable()
export class CompanyService extends BaseService<Company, CreateCompanyDto, UpdateCompanyDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'company', companySchema)
  }

  async deactivate(id: string): Promise<Company> {
    await this.findOne(id)
    return this.prisma.company.update({ where: { id }, data: { isActive: false } }) as Promise<Company>
  }

  protected buildSearchWhere(search: string) {
    const s = search.toLowerCase()
    return {
      OR: [
        { legalName: { contains: s } },
        { tradeName: { contains: s } },
        { taxId:     { contains: s } },
      ],
    }
  }
}
