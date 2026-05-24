import { Controller, UseGuards } from '@nestjs/common'
import { Employee, CreateEmployeeDto, UpdateEmployeeDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { EmployeeService } from './employee.service'

@Controller('hr/employee')
@UseGuards(JwtAuthGuard)
export class EmployeeController extends BaseController<Employee, CreateEmployeeDto, UpdateEmployeeDto> {
  constructor(
    private readonly employeeService: EmployeeService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(employeeService, caslFactory)
  }
}
