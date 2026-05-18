import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/policies.guard'
import { CaslAbilityFactory } from '../../auth/casl.factory'
import { resourceRegistry } from '../../core/resource-registry'
import { getDomainRegistry } from '../../core/domain-registry'
import type { DiscoveryDomain, DiscoveryResource, AuthUser } from '@nyx/types'

function toTitleCase(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

@Controller('discovery')
@UseGuards(JwtAuthGuard)
export class DiscoveryController {
  constructor(private readonly caslFactory: CaslAbilityFactory) {}

  @Get()
  async getDiscovery(@Req() req: { user: AuthUser }): Promise<DiscoveryDomain[]> {
    const domainRegistry = getDomainRegistry()
    const ability = await this.caslFactory.createForUser(req.user)

    // Recursos visíveis: top-level (sem breadcrumb) OU filhos com privatePermissions
    const visible = resourceRegistry.filter((entry) => {
      const meta    = (entry.schema as any)._schemaMeta
      const isChild = !!meta?.breadcrumb?.length
      if (isChild && !meta?.privatePermissions) return false
      const subject = entry.resource[0].toUpperCase() + entry.resource.slice(1)
      return ability.can('read', subject)
    })

    // Agrupa por domain, mantém a ordem de registro dos domínios
    const grouped = new Map<string, DiscoveryResource[]>()
    for (const entry of visible) {
      const meta: any = (entry.schema as any)._schemaMeta ?? {}
      const resource: DiscoveryResource = {
        key:         entry.resource,
        label:       meta.label       ?? toTitleCase(entry.resource),
        labelPlural: meta.labelPlural ?? `${meta.label ?? toTitleCase(entry.resource)}s`,
        icon:        meta.icon        ?? '',
        ...(meta.isSingleton        ? { isSingleton: true }        : {}),
        ...(meta.privatePermissions ? { privatePermissions: true } : {}),
      }
      if (!grouped.has(entry.domain)) grouped.set(entry.domain, [])
      grouped.get(entry.domain)!.push(resource)
    }

    // Filtra domínios sem recursos visíveis para este usuário
    return domainRegistry
      .map((domain) => ({
        key:       domain.key,
        label:     domain.label,
        icon:      domain.icon,
        resources: grouped.get(domain.key) ?? [],
      }))
      .filter((domain) => domain.resources.length > 0)
  }
}
