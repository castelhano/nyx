import { Controller, Post, Param, UseGuards } from '@nestjs/common'
import { Company, CreateCompanyDto, UpdateCompanyDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { CompanyService } from './company.service'

@Controller('core/company')
@UseGuards(JwtAuthGuard)
export class CompanyController extends BaseController<Company, CreateCompanyDto, UpdateCompanyDto> {
  constructor(
    private readonly companyService: CompanyService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(companyService, caslFactory)
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.companyService.deactivate(id)
  }
}
