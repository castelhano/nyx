import { Module } from '@nestjs/common'
import { EmployeeController } from './employee.controller'
import { EmployeeService } from './employee.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [EmployeeController],
  providers:   [EmployeeService],
  exports:     [EmployeeService],
})
export class EmployeeModule {}
