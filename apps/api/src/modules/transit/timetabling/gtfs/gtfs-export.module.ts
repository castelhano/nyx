import { Module } from '@nestjs/common'
import { DayTypeModule } from '../day-type/day-type.module'
import { GtfsExportController } from './gtfs-export.controller'
import { GtfsExportService } from './gtfs-export.service'

@Module({
  imports:     [DayTypeModule],
  controllers: [GtfsExportController],
  providers:   [GtfsExportService],
})
export class GtfsExportModule {}
