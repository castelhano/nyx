import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common'
import { Branch, CreateBranchDto, UpdateBranchDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { BranchService } from './branch.service'

@Controller('core/branch')
@UseGuards(JwtAuthGuard)
export class BranchController extends BaseController<Branch, CreateBranchDto, UpdateBranchDto> {
  constructor(
    private readonly branchService: BranchService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(branchService, caslFactory)
  }

  @Get('by-company/:companyId')
  findByCompany(@Param('companyId') companyId: string) {
    return this.branchService.findByCompany(companyId)
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.branchService.deactivate(id)
  }
}
