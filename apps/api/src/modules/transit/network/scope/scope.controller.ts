import { Controller, UseGuards } from '@nestjs/common'
import { Scope, CreateScopeDto, UpdateScopeDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { ScopeService } from './scope.service'

@Controller('transit/scope')
@UseGuards(JwtAuthGuard)
export class ScopeController extends BaseController<Scope, CreateScopeDto, UpdateScopeDto> {
  constructor(
    private readonly scopeService: ScopeService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(scopeService, caslFactory)
  }
}
