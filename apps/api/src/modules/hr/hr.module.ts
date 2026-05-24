import { Module } from '@nestjs/common'
import { DepartmentModule } from './department/department.module'
import { JobTitleModule } from './job-title/job-title.module'
import { EmployeeModule } from './employee/employee.module'
import { ContractModule } from './contract/contract.module'
import { Domain } from '../../core/domain-registry'

@Domain({ label: 'RH', icon: 'Users' })
@Module({
  imports: [DepartmentModule, JobTitleModule, EmployeeModule, ContractModule],
})
export class HrModule {}
