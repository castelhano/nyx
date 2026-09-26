import { Module, OnModuleInit } from '@nestjs/common'
import { z } from 'zod'
import { withMeta } from '@nyx/schemas'
import { resourceRegistry } from '../../../core/resource-registry'
import { TransitGeneralConfigService }  from './transit-general-config.service'
import { TransitPlanningConfigService } from './transit-planning-config.service'
import { TransitCrewConfigService }     from './transit-crew-config.service'
import { TransitRosterConfigService }   from './transit-roster-config.service'
import { TransitSettingsController }    from './transit-settings.controller'

const transitSettingsEntrySchema = withMeta(
  z.object({}),
  { label: 'Configurações', labelPlural: 'Configurações', icon: 'Settings2', isSingleton: true },
)

@Module({
  controllers: [TransitSettingsController],
  providers: [
    TransitGeneralConfigService,
    TransitPlanningConfigService,
    TransitCrewConfigService,
    TransitRosterConfigService,
  ],
  exports: [
    TransitGeneralConfigService,
    TransitPlanningConfigService,
    TransitCrewConfigService,
    TransitRosterConfigService,
  ],
})
export class TransitSettingsModule implements OnModuleInit {
  onModuleInit() {
    resourceRegistry.push({ domain: 'transit', resource: 'settings', schema: transitSettingsEntrySchema as any })
  }
}
