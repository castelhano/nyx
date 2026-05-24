import { Module } from '@nestjs/common'
import { DepartmentController } from './department.controller'
import { DepartmentService } from './department.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [DepartmentController],
  providers:   [DepartmentService],
  exports:     [DepartmentService],
})
export class DepartmentModule {}
