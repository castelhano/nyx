import { Module } from '@nestjs/common'
import { JobTitleController } from './job-title.controller'
import { JobTitleService } from './job-title.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [JobTitleController],
  providers:   [JobTitleService],
  exports:     [JobTitleService],
})
export class JobTitleModule {}
