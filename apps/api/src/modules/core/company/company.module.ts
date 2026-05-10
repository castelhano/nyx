import { Module } from '@nestjs/common'
import { CompanyController } from './company.controller'
import { CompanyService } from './company.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [CompanyController],
  providers:   [CompanyService],
  exports:     [CompanyService],
})
export class CompanyModule {}
