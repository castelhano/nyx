import { Module } from '@nestjs/common'
import { LineGroupController } from './line-group.controller'
import { LineGroupService } from './line-group.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [LineGroupController],
  providers:   [LineGroupService],
  exports:     [LineGroupService],
})
export class LineGroupModule {}
