import { Controller, UseGuards } from '@nestjs/common'
import { Contract, CreateContractDto, UpdateContractDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { ContractService } from './contract.service'

@Controller('hr/contract')
@UseGuards(JwtAuthGuard)
export class ContractController extends BaseController<Contract, CreateContractDto, UpdateContractDto> {
  constructor(
    private readonly contractService: ContractService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(contractService, caslFactory)
  }
}
