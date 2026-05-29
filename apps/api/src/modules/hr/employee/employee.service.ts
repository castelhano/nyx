import { Injectable } from '@nestjs/common'
import { employeeSchema, Employee, CreateEmployeeDto, UpdateEmployeeDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'
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

  async update(id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    const current = await this.findOne(id) as Employee
    const result  = await super.update(id, dto)

    const oldUrl = current.photoUrl
    const newUrl = (result as Employee).photoUrl
    if (oldUrl && oldUrl !== newUrl && oldUrl.startsWith('/api/uploads/')) {
      const filePath = path.join(process.cwd(), oldUrl.replace('/api/', ''))
      fs.promises.unlink(filePath).catch(() => {})
    }

    return result
  }
}
