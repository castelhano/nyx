import { Controller, Post, Patch, Param, Body, UseGuards } from '@nestjs/common'
import { User, CreateUserDto, UpdateUserDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { UserService } from './user.service'

@Controller('core/user')
@UseGuards(JwtAuthGuard)
export class UserController extends BaseController<User, CreateUserDto, UpdateUserDto> {
  constructor(
    private readonly userService: UserService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(userService, caslFactory)
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.userService.deactivate(id)
  }

  @Patch(':id/change-password')
  changePassword(
    @Param('id') id: string,
    @Body() dto: { currentPassword: string; newPassword: string },
  ) {
    return this.userService.changePassword(id, dto)
  }

  @Patch(':id/reset-password')
  resetPassword(
    @Param('id') id: string,
    @Body() dto: { newPassword: string },
  ) {
    return this.userService.resetPassword(id, dto.newPassword)
  }
}
