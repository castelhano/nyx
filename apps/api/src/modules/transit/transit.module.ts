import { Module } from '@nestjs/common'
import { NetworkModule } from './network/network.module'
import { TimetablingModule } from './timetabling/timetabling.module'
import { TransitSettingsModule } from './settings/transit-settings.module'
import { Domain } from '../../core/domain-registry'

@Domain({ label: 'Operação', icon: 'Route' })
@Module({
  imports: [NetworkModule, TimetablingModule, TransitSettingsModule],
})
export class TransitModule {}
