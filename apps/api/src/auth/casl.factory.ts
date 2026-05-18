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
      // deny-by-default: apenas permissões explicitamente concedidas por recurso
      const userPermissions = await this.prisma.userPermission.findMany({
        where: { userId: user.id },
      })

      for (const p of userPermissions) {
        const subject = p.resource[0].toUpperCase() + p.resource.slice(1)
        can(p.action, subject)
      }
    }

    return build()
  }
}
