import { Module } from '@nestjs/common'
import { ScopeOperatorController } from './scope-operator.controller'
import { ScopeOperatorService } from './scope-operator.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [ScopeOperatorController],
  providers:   [ScopeOperatorService],
  exports:     [ScopeOperatorService],
})
export class ScopeOperatorModule {}
