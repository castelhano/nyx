import { Module } from '@nestjs/common'
import { DepotFleetController } from './depot-fleet.controller'
import { DepotFleetService } from './depot-fleet.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [DepotFleetController],
  providers:   [DepotFleetService],
  exports:     [DepotFleetService],
})
export class DepotFleetModule {}
