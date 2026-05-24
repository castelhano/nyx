import { Module } from '@nestjs/common'
import { DepartmentModule } from './department/department.module'
import { JobTitleModule } from './job-title/job-title.module'
import { Domain } from '../../core/domain-registry'

@Domain({ label: 'RH', icon: 'Users' })
@Module({
  imports: [DepartmentModule, JobTitleModule],
})
export class HrModule {}
