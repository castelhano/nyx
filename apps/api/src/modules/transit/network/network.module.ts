import { Module } from '@nestjs/common'
import { LocalityModule } from './locality/locality.module'
import { LineModule } from './line/line.module'
import { LineGroupModule } from './line-group/line-group.module'
import { RouteModule } from './route/route.module'
import { RouteLocalityModule } from './route-locality/route-locality.module'
import { TravelTimeModule } from './travel-time/travel-time.module'
import { ScopeModule } from './scope/scope.module'
import { ScopeOperatorModule } from './scope-operator/scope-operator.module'
import { LineServiceRequirementModule } from './line-service-requirement/line-service-requirement.module'
import { LineRevisionModule } from './line-revision/line-revision.module'

@Module({
  imports: [LocalityModule, LineModule, LineGroupModule, RouteModule, RouteLocalityModule, TravelTimeModule, ScopeModule, ScopeOperatorModule, LineServiceRequirementModule, LineRevisionModule],
  exports: [LocalityModule, LineModule, LineGroupModule, RouteModule, RouteLocalityModule, TravelTimeModule, ScopeModule, ScopeOperatorModule, LineServiceRequirementModule, LineRevisionModule],
})
export class NetworkModule {}
