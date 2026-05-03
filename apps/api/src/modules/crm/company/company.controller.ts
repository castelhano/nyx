import { Controller, Post, Param, UseGuards } from '@nestjs/common'
import { Company, CreateCompanyDto, UpdateCompanyDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { CompanyService } from './company.service'

@Controller('crm/companies')
@UseGuards(JwtAuthGuard)
export class CompanyController extends BaseController<Company, CreateCompanyDto, UpdateCompanyDto> {
  constructor(private readonly companyService: CompanyService) {
    super(companyService)
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.companyService.deactivate(id)
  }
}
