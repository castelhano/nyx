import { Module } from '@nestjs/common'
import { CaslModule } from '../../auth/casl.module'
import { DiscoveryController } from './discovery.controller'

@Module({
  imports:     [CaslModule],
  controllers: [DiscoveryController],
})
export class DiscoveryModule {}
