import { Controller, UseGuards } from '@nestjs/common'
import { Department, CreateDepartmentDto, UpdateDepartmentDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { DepartmentService } from './department.service'

@Controller('hr/department')
@UseGuards(JwtAuthGuard)
export class DepartmentController extends BaseController<Department, CreateDepartmentDto, UpdateDepartmentDto> {
  constructor(
    private readonly departmentService: DepartmentService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(departmentService, caslFactory)
  }
}
