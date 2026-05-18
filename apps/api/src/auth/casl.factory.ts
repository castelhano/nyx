import { Injectable } from '@nestjs/common'
import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability'
import { PrismaService } from '../prisma/prisma.service'
import { resourceRegistry } from '../core/resource-registry'

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

      // Herança automática: filhos sem privatePermissions herdam permissões do pai
      for (const entry of resourceRegistry) {
        const meta = (entry.schema as any)._schemaMeta
        if (!meta?.breadcrumb?.length || meta?.privatePermissions) continue
        const childSubject = entry.resource[0].toUpperCase() + entry.resource.slice(1)
        for (const bc of meta.breadcrumb as { resource: string }[]) {
          for (const p of userPermissions.filter((p) => p.resource === bc.resource)) {
            can(p.action, childSubject)
          }
        }
      }
    }

    return build()
  }
}
