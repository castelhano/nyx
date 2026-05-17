import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/policies.guard'
import { resourceRegistry } from '../../core/resource-registry'
import { getDomainRegistry } from '../../core/domain-registry'
import type { DiscoveryDomain, DiscoveryResource } from '@nyx/types'

function toTitleCase(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

@Controller('discovery')
@UseGuards(JwtAuthGuard)
export class DiscoveryController {
  @Get()
  getDiscovery(): DiscoveryDomain[] {
    const domainRegistry = getDomainRegistry()

    // Apenas recursos top-level: sem breadcrumb declarado no schema
    const topLevel = resourceRegistry.filter((entry) => {
      const meta = (entry.schema as any)._schemaMeta
      return !meta?.breadcrumb || meta.breadcrumb.length === 0
    })

    // Agrupa por domain, mantém a ordem de registro dos domínios
    const grouped = new Map<string, DiscoveryResource[]>()
    for (const entry of topLevel) {
      const meta: any = (entry.schema as any)._schemaMeta ?? {}
      const resource: DiscoveryResource = {
        key:         entry.resource,
        label:       meta.label       ?? toTitleCase(entry.resource),
        labelPlural: meta.labelPlural ?? `${meta.label ?? toTitleCase(entry.resource)}s`,
        icon:        meta.icon        ?? '',
        ...(meta.isSingleton ? { isSingleton: true } : {}),
      }
      if (!grouped.has(entry.domain)) grouped.set(entry.domain, [])
      grouped.get(entry.domain)!.push(resource)
    }

    return domainRegistry.map((domain) => ({
      key:       domain.key,
      label:     domain.label,
      icon:      domain.icon,
      resources: grouped.get(domain.key) ?? [],
    }))
  }
}
