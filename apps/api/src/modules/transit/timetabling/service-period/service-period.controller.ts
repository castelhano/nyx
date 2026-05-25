import { Controller, UseGuards } from '@nestjs/common'
import { ServicePeriod, CreateServicePeriodDto, UpdateServicePeriodDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { ServicePeriodService } from './service-period.service'

@Controller('transit/service-period')
@UseGuards(JwtAuthGuard)
export class ServicePeriodController extends BaseController<ServicePeriod, CreateServicePeriodDto, UpdateServicePeriodDto> {
  constructor(
    private readonly servicePeriodService: ServicePeriodService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(servicePeriodService, caslFactory)
  }
}
