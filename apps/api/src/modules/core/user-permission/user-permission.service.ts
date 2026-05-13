import { Injectable } from '@nestjs/common'
import {
  UserPermission, CreateUserPermissionDto, UpdateUserPermissionDto,
  userPermissionSchema,
} from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'

@Injectable()
export class UserPermissionService extends BaseService<
  UserPermission,
  CreateUserPermissionDto,
  UpdateUserPermissionDto
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'user-permission', userPermissionSchema, 'core')
  }

  findByUser(userId: string): Promise<UserPermission[]> {
    return this.prisma.userPermission.findMany({ where: { userId } }) as Promise<UserPermission[]>
  }

  // Substitui todas as permissões do usuário atomicamente
  async setForUser(userId: string, permissions: { resource: string; action: string }[]): Promise<UserPermission[]> {
    await this.prisma.userPermission.deleteMany({ where: { userId } })

    if (permissions.length === 0) return []

    await this.prisma.userPermission.createMany({
      data: permissions.map(p => ({ userId, resource: p.resource, action: p.action })),
    })

    return this.findByUser(userId)
  }
}
