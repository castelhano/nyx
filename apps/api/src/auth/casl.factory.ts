import { Injectable } from '@nestjs/common'
import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability'
import { PrismaService } from '../prisma/prisma.service'

export type AppAbility = MongoAbility

@Injectable()
export class CaslAbilityFactory {
  constructor(private readonly prisma: PrismaService) {}

  async createForUser(user: { id: string; role: string }): Promise<AppAbility> {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility)

    if (user.role === 'admin') {
      can('manage', 'all')
    } else {
      // baseline por role — permissões explícitas sobrescrevem quando necessário
      can('read', 'all')

      if (user.role === 'operator') {
        can('create', 'all')
        can('update', 'all')
      }

      const userPermissions = await this.prisma.userPermission.findMany({
        where: { userId: user.id },
      })

      for (const p of userPermissions) {
        can(p.action, p.resource)
      }
    }

    return build()
  }
}
