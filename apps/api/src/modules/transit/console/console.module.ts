import { Module } from '@nestjs/common'
import { CaslModule } from '../../../auth/casl.module'
import { TransitSettingsModule } from '../settings/transit-settings.module'
import { DayTypeModule } from '../timetabling/day-type/day-type.module'
import { CrewModule } from '../crew/crew.module'
import { ConsoleController } from './console.controller'
import { ConsoleService } from './console.service'

// Painel de Escala — the planned crew against the effective plans
@Module({
  imports:     [CaslModule, TransitSettingsModule, DayTypeModule, CrewModule],
  controllers: [ConsoleController],
  providers:   [ConsoleService],
})
export class ConsoleModule {}
