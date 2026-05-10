import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common'
import { UserPermission, CreateUserPermissionDto, UpdateUserPermissionDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { UserPermissionService } from './user-permission.service'

@Controller('core/user-permission')
@UseGuards(JwtAuthGuard)
export class UserPermissionController extends BaseController<
  UserPermission,
  CreateUserPermissionDto,
  UpdateUserPermissionDto
> {
  constructor(
    private readonly userPermissionService: UserPermissionService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(userPermissionService, caslFactory)
  }

  @Get('by-user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.userPermissionService.findByUser(userId)
  }

  @Put('by-user/:userId')
  setForUser(
    @Param('userId') userId: string,
    @Body() body: { permissions: { resource: string; action: string }[] },
  ) {
    return this.userPermissionService.setForUser(userId, body.permissions)
  }
}
