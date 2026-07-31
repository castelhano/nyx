import { Controller, UseGuards } from '@nestjs/common'
import { ScopeOperator, CreateScopeOperatorDto, UpdateScopeOperatorDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { ScopeOperatorService } from './scope-operator.service'

@Controller('transit/scope-operator')
@UseGuards(JwtAuthGuard)
export class ScopeOperatorController extends BaseController<ScopeOperator, CreateScopeOperatorDto, UpdateScopeOperatorDto> {
  constructor(
    private readonly scopeOperatorService: ScopeOperatorService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(scopeOperatorService, caslFactory)
  }
}
