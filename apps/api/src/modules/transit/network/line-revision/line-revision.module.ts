import { Module } from '@nestjs/common'
import { LineRevisionController } from './line-revision.controller'
import { LineRevisionService } from './line-revision.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [LineRevisionController],
  providers:   [LineRevisionService],
  exports:     [LineRevisionService],
})
export class LineRevisionModule {}
