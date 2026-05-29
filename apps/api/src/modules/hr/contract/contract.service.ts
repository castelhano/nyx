import { Injectable, BadRequestException } from '@nestjs/common'
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

  override async create(dto: CreateContractDto): Promise<Contract> {
    const start = new Date(dto.startDate)
    const end   = dto.endDate ? new Date(dto.endDate) : null

    if (end && end <= start) {
      throw new BadRequestException('A data de término deve ser posterior à data de início.')
    }

    await this.assertNoConflict(dto.employeeId, start, end)
    await this.closeOpenContract(dto.employeeId, start)
    await this.assertSingleActive(dto.employeeId, dto.status)

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
    await this.assertNoConflict(employeeId, start, end, id)
    await this.assertSingleActive(employeeId, dto.status, id)

    return super.update(id, dto)
  }

  // Close open contract that predates the new start (startDate < newStart)
  private async closeOpenContract(employeeId: string, newStart: Date): Promise<void> {
    const open = await this.prisma.contract.findFirst({
      where: { employeeId, endDate: null, startDate: { lt: newStart } },
    })
    if (!open) return

    const closeDate = new Date(newStart)
    closeDate.setDate(closeDate.getDate() - 1)

    const engineNote = '--\nFinalizado automaticamente pelo engine.'
    const notes = open.notes ? `${open.notes}\n${engineNote}` : engineNote

    await this.prisma.contract.update({
      where: { id: open.id },
      data:  { endDate: closeDate, status: 'EXPIRED', notes },
    })
  }

  private async assertSingleActive(employeeId: string, status: string | undefined, excludeId?: string): Promise<void> {
    if (status !== 'ACTIVE') return
    const existing = await this.prisma.contract.findFirst({
      where: {
        employeeId,
        status: 'ACTIVE',
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    })
    if (existing) {
      throw new BadRequestException('Já existe um contrato ativo para este funcionário. Finalize-o antes de ativar outro.')
    }
  }

  // Conflict rules:
  // - open contract with startDate >= newStart (can't auto-close, periods overlap)
  // - closed contract where existingStart <= newEnd AND existingEnd >= newStart
  private async assertNoConflict(
    employeeId: string,
    start: Date,
    end: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const base = excludeId ? { id: { not: excludeId } } : {}

    const conflict = await this.prisma.contract.findFirst({
      where: {
        employeeId,
        ...base,
        OR: [
          // open contract that starts AT or AFTER newStart — can't be auto-closed, real overlap
          { endDate: null, startDate: { gte: start } },
          // open contract that starts BEFORE newStart but newEnd exists — overlaps if openStart <= newEnd
          ...(end ? [{ endDate: null as null, startDate: { lt: start, lte: end } }] : []),
          // closed contract: existingStart <= newEnd AND existingEnd >= newStart
          {
            endDate:   { not: null, gte: start },
            startDate: end ? { lte: end } : undefined,
          },
        ],
      },
    })

    if (conflict) {
      throw new BadRequestException('O período informado conflita com outro contrato existente.')
    }
  }
}
