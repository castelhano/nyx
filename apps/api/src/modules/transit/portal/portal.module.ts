import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { CaslModule } from '../../../auth/casl.module'
import { TransitSettingsModule } from '../settings/transit-settings.module'
import { CrewModule } from '../crew/crew.module'
import { PortalProfileController } from './portal-profile.controller'
import { PortalProfileService } from './portal-profile.service'
import { PortalAccessController, PortalController } from './portal.controller'
import { PortalAuthService } from './portal-auth.service'
import { PortalGuard } from './portal.guard'
import { PortalService } from './portal.service'

// The crew portal: its profiles (staff), PIN access, and the crew member's own API
@Module({
  imports:     [CaslModule, TransitSettingsModule, CrewModule, JwtModule.register({})],
  controllers: [PortalProfileController, PortalController, PortalAccessController],
  providers:   [PortalProfileService, PortalAuthService, PortalService, PortalGuard],
})
export class PortalModule {}
