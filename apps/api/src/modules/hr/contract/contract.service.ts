import { Injectable, BadRequestException } from '@nestjs/common'
import { contractSchema, Contract, CreateContractDto, UpdateContractDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'
import { assertNoConflict, assertSingleActive, closeOpenContract } from './contract.rules'

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

  override async create(dto: CreateContractDto): Promise<Contract> {
    const start = new Date(dto.startDate)
    const end   = dto.endDate ? new Date(dto.endDate) : null

    if (end && end <= start) {
      throw new BadRequestException('A data de término deve ser posterior à data de início.')
    }

    await assertNoConflict(this.prisma, dto.employeeId, start, end)
    await closeOpenContract(this.prisma, dto.employeeId, start)
    await assertSingleActive(this.prisma, dto.employeeId, dto.status)

    return super.create(dto)
  }

  override async update(id: string, dto: UpdateContractDto): Promise<Contract> {
    const existing = await this.findOne(id)

    const start = dto.startDate ? new Date(dto.startDate) : new Date((existing as any).startDate)
    const end   = dto.endDate !== undefined
      ? (dto.endDate ? new Date(dto.endDate) : null)
      : ((existing as any).endDate ? new Date((existing as any).endDate) : null)

    if (end && end <= start) {
      throw new BadRequestException('A data de término deve ser posterior à data de início.')
    }

    const employeeId = dto.employeeId ?? (existing as any).employeeId
    await assertNoConflict(this.prisma, employeeId, start, end, id)
    await assertSingleActive(this.prisma, employeeId, dto.status, id)

    return super.update(id, dto)
  }
}
