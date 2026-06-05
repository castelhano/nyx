import { Module } from '@nestjs/common'
import { EmployeeController } from './employee.controller'
import { EmployeeService } from './employee.service'
import { EmployeeSyncController } from './employee-sync.controller'
import { EmployeeSyncService } from './employee-sync.service'
import { CaslModule } from '../../../auth/casl.module'
import { JobModule } from '../../core/job/job.module'

@Module({
  imports:     [CaslModule, JobModule],
  controllers: [EmployeeController, EmployeeSyncController],
  providers:   [EmployeeService, EmployeeSyncService],
  exports:     [EmployeeService],
})
export class EmployeeModule {}
