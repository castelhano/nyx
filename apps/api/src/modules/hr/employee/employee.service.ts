import { Injectable } from '@nestjs/common'
import { employeeSchema, Employee, CreateEmployeeDto, UpdateEmployeeDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

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
}
