import { Injectable } from '@nestjs/common'
import { contractSchema, Contract, CreateContractDto, UpdateContractDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

@Injectable()
export class ContractService extends BaseService<Contract, CreateContractDto, UpdateContractDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'contract', contractSchema, 'hr')
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { jobTitle: { name: stringContains(search) } },
        { notes:    stringContains(search) },
      ],
    }
  }
}
