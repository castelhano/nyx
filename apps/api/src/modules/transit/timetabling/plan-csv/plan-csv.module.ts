import { Module } from '@nestjs/common'
import { PlanCsvController } from './plan-csv.controller'
import { PlanCsvService } from './plan-csv.service'

@Module({
  controllers: [PlanCsvController],
  providers:   [PlanCsvService],
})
export class PlanCsvModule {}
