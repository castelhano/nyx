import { Module } from '@nestjs/common'
import { NetworkModule } from './network/network.module'
import { TimetablingModule } from './timetabling/timetabling.module'
import { TransitSettingsModule } from './settings/transit-settings.module'
import { CrewModule } from './crew/crew.module'
import { DailyModule } from './daily/daily.module'
import { HourBankModule } from './hour-bank/hour-bank.module'
import { ConsoleModule } from './console/console.module'
import { Domain } from '../../core/domain-registry'

@Domain({ label: 'Operação', icon: 'Route' })
@Module({
  imports: [NetworkModule, TimetablingModule, TransitSettingsModule, CrewModule, DailyModule, HourBankModule, ConsoleModule],
})
export class TransitModule {}
