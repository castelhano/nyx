import { Module } from '@nestjs/common'
import { VehicleModelController } from './vehicle-model.controller'
import { VehicleModelService } from './vehicle-model.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [VehicleModelController],
  providers:   [VehicleModelService],
  exports:     [VehicleModelService],
})
export class VehicleModelModule {}
