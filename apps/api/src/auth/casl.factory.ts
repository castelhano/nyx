import { Injectable } from '@nestjs/common'
import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability'
import { PrismaService } from '../prisma/prisma.service'
import { resourceRegistry } from '../core/resource-registry'

export type AppAbility = MongoAbility

@Injectable()
export class CaslAbilityFactory {
  constructor(private readonly prisma: PrismaService) {}

  // Lazily built on first request; never changes after startup.
  private inheritanceMap: Map<string, string[]> | null = null

  private getInheritanceMap(): Map<string, string[]> {
    if (this.inheritanceMap) return this.inheritanceMap

    // Pass 1 — direct parent → immediate children (skip privatePermissions resources)
    const direct = new Map<string, string[]>()
    for (const entry of resourceRegistry) {
      const meta = (entry.schema as any)._schemaMeta
      if (!meta?.breadcrumb?.length || meta?.privatePermissions) continue
      for (const bc of meta.breadcrumb as { resource: string }[]) {
        if (!direct.has(bc.resource)) direct.set(bc.resource, [])
        direct.get(bc.resource)!.push(entry.resource)
      }
    }

    // Pass 2 — transitive closure: each parent maps to ALL descendants
    const resolved = new Map<string, string[]>()

    const resolve = (resource: string, visiting = new Set<string>()): string[] => {
      if (resolved.has(resource)) return resolved.get(resource)!
      if (visiting.has(resource)) return [] // cycle guard
      visiting.add(resource)

      const descendants: string[] = []
      for (const child of direct.get(resource) ?? []) {
        if (!descendants.includes(child)) descendants.push(child)
        for (const grandchild of resolve(child, visiting)) {
          if (!descendants.includes(grandchild)) descendants.push(grandchild)
        }
      }
      resolved.set(resource, descendants)
      return descendants
    }

    for (const resource of direct.keys()) resolve(resource)

    this.inheritanceMap = resolved
    return this.inheritanceMap
  }

  async createForUser(user: { id: string; role: string }): Promise<AppAbility> {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility)

    if (user.role === 'admin') {
      can('manage', 'all')
    } else {
      const userPermissions = await this.prisma.userPermission.findMany({
        where: { userId: user.id },
      })

      const map = this.getInheritanceMap()

      for (const p of userPermissions) {
        const subject = p.resource[0].toUpperCase() + p.resource.slice(1)
        can(p.action, subject)
        for (const child of map.get(p.resource) ?? []) {
          can(p.action, child[0].toUpperCase() + child.slice(1))
        }
      }
    }

    return build()
  }
}
