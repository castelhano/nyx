import { Module } from '@nestjs/common'
import { VehicleBrandController } from './vehicle-brand.controller'
import { VehicleBrandService } from './vehicle-brand.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [VehicleBrandController],
  providers:   [VehicleBrandService],
  exports:     [VehicleBrandService],
})
export class VehicleBrandModule {}
