import { BadRequestException, Injectable } from '@nestjs/common'
import type { ImportValue } from '@nyx/types'
import type { Prisma } from '@prisma/client'
import {
  UserPermission, CreateUserPermissionDto, UpdateUserPermissionDto,
  userPermissionSchema,
} from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { resourceRegistry } from '../../../core/resource-registry'
import { getDomainRegistry } from '../../../core/domain-registry'
import type { ImportOp } from '../../../core/import/import.engine'

// what the permission matrix offers — discovery's rule: top-level resources, or children with
// their own permissions; hidden ones are out
function permissionResources() {
  return resourceRegistry.filter(e => {
    const meta = (e.schema as any)._schemaMeta ?? {}
    return !meta.hidden && (!meta.breadcrumb?.length || meta.privatePermissions)
  })
}

@Injectable()
export class UserPermissionService extends BaseService<
  UserPermission,
  CreateUserPermissionDto,
  UpdateUserPermissionDto
> {
  constructor(prisma: PrismaService) {
    super(prisma, 'userPermission', userPermissionSchema, 'core')
  }

  // the resource column lists every resource a permission can name, by domain
  protected override importValues(): Record<string, ImportValue[]> {
    const domains = new Map(getDomainRegistry().map(d => [d.key, d.label]))
    return {
      resource: permissionResources()
        .map(e => {
          const meta = (e.schema as any)._schemaMeta ?? {}
          return { value: e.resource, label: meta.labelPlural ?? meta.label ?? e.resource, group: domains.get(e.domain) ?? e.domain }
        })
        .sort((a, b) => a.group.localeCompare(b.group, 'pt-BR') || a.label.localeCompare(b.label, 'pt-BR')),
    }
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

  // CSV import row: the user's actions on one resource, replaced as a whole. Only resources the
  // permission matrix offers (permissionResources), with any of the four actions, as in the matrix.
  protected override async importWrite(tx: Prisma.TransactionClient, op: ImportOp): Promise<void> {
    const { userId, resource } = op.data as { userId?: string; resource?: string }
    const actions = op.extra.actions as string[] | undefined
    if (!actions?.length) throw new BadRequestException('Informe as ações (create, read, update, delete)')

    const entry = permissionResources().find(e => e.resource === resource)
    if (!entry) throw new BadRequestException(`Recurso desconhecido: ${resource}`)

    const where = { userId: userId!, resource: resource! }
    await tx.userPermission.deleteMany({ where })
    await tx.userPermission.createMany({ data: actions.map(action => ({ ...where, action })) })
  }
}
