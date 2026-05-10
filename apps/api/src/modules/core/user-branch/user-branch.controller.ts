import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common'
import { UserBranch, CreateUserBranchDto, UpdateUserBranchDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { UserBranchService } from './user-branch.service'

@Controller('core/user-branch')
@UseGuards(JwtAuthGuard)
export class UserBranchController extends BaseController<UserBranch, CreateUserBranchDto, UpdateUserBranchDto> {
  constructor(
    private readonly userBranchService: UserBranchService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(userBranchService, caslFactory)
  }

  @Get('by-user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.userBranchService.findByUser(userId)
  }

  @Get('by-branch/:branchId')
  findByBranch(@Param('branchId') branchId: string) {
    return this.userBranchService.findByBranch(branchId)
  }

  @Put('by-user/:userId')
  setForUser(
    @Param('userId') userId: string,
    @Body() body: { branches: { branchId: string; role: string }[] },
  ) {
    return this.userBranchService.setForUser(userId, body.branches)
  }
}
