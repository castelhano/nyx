import { Module } from '@nestjs/common'
import { NetworkModule } from './network/network.module'
import { TimetablingModule } from './timetabling/timetabling.module'
import { Domain } from '../../core/domain-registry'

@Domain({ label: 'Trânsito', icon: 'Route' })
@Module({
  imports: [NetworkModule, TimetablingModule],
})
export class TransitModule {}
