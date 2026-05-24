import { Injectable } from '@nestjs/common'
import { departmentSchema, Department, CreateDepartmentDto, UpdateDepartmentDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

@Injectable()
export class DepartmentService extends BaseService<Department, CreateDepartmentDto, UpdateDepartmentDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'department', departmentSchema, 'hr')
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ name: stringContains(search) }] }
  }
}
