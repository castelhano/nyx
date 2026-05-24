import { Module } from '@nestjs/common'
import { VehicleController } from './vehicle.controller'
import { VehicleService } from './vehicle.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [VehicleController],
  providers:   [VehicleService],
  exports:     [VehicleService],
})
export class VehicleModule {}
