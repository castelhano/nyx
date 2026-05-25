import { Module } from '@nestjs/common'
import { LineController } from './line.controller'
import { LineService } from './line.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [LineController],
  providers:   [LineService],
  exports:     [LineService],
})
export class LineModule {}
