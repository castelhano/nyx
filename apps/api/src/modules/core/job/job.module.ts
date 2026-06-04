import { Module } from '@nestjs/common'
import { JobController } from './job.controller'
import { JobService } from './job.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [JobController],
  providers:   [JobService],
  exports:     [JobService],
})
export class JobModule {}
