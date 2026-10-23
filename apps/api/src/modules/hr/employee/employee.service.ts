import { BadRequestException, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { employeeSchema, Employee, CreateEmployeeDto, UpdateEmployeeDto } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'
import type { ImportOp } from '../../../core/import/import.engine'
import { assertNoConflict, assertSingleActive, closeOpenContract } from '../contract/contract.rules'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class EmployeeService extends BaseService<Employee, CreateEmployeeDto, UpdateEmployeeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'employee', employeeSchema, 'hr', 'branchId')
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { fullName: stringContains(search) },
        { code:     stringContains(search) },
        { taxId:    stringContains(search) },
      ],
    }
  }

  async update(id: string, dto: UpdateEmployeeDto, user?: AuthUser): Promise<Employee> {
    const current = await this.findOne(id, user)
    const result  = await super.update(id, dto, user)

    const oldUrl = current.photoUrl
    const newUrl = result.photoUrl
    if (oldUrl && oldUrl !== newUrl && oldUrl.startsWith('/api/uploads/')) {
      const filePath = path.join(process.cwd(), oldUrl.replace('/api/', ''))
      fs.promises.unlink(filePath).catch(() => {})
    }

    return result
  }

  // An import row's contract columns are always a NEW contract: the open one is closed the day
  // before it starts (contract rules); a contract starting on the same date is the same one, so
  // re-importing a file is harmless; one starting later blocks the row.
  protected override async importWrite(tx: Prisma.TransactionClient, op: ImportOp): Promise<void> {
    const employeeId = op.action === 'create'
      ? (await tx.employee.create({ data: op.data as Prisma.EmployeeUncheckedCreateInput })).id
      : (await tx.employee.update({ where: { id: op.id }, data: op.data })).id

    const contract = op.nested.contract
    if (!contract) return
    const start = contract.startDate as Date
    const end   = (contract.endDate as Date | undefined) ?? null

    const later = await tx.contract.findFirst({
      where:   { employeeId, startDate: { gte: start } },
      orderBy: { startDate: 'desc' },
      select:  { startDate: true },
    })
    if (later?.startDate.getTime() === start.getTime()) return
    if (later) throw new BadRequestException(`Já existe contrato com início em ${later.startDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}, posterior ao informado`)
    if (end && end <= start) throw new BadRequestException('O término do contrato deve ser posterior ao início')

    await assertNoConflict(tx, employeeId, start, end)
    await closeOpenContract(tx, employeeId, start)
    await assertSingleActive(tx, employeeId, 'ACTIVE')
    await tx.contract.create({ data: { ...contract, employeeId, status: 'ACTIVE' } as Prisma.ContractUncheckedCreateInput })
  }
}
