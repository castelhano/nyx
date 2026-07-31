import { Module } from '@nestjs/common'
import { ScopeController } from './scope.controller'
import { ScopeService } from './scope.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [ScopeController],
  providers:   [ScopeService],
  exports:     [ScopeService],
})
export class ScopeModule {}
