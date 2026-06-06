import { Injectable } from '@nestjs/common'
import { ZodObject } from 'zod'
import type { ResourceMetadata } from '@nyx/types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMetadata } from './metadata.builder'
import { resourceRegistry } from './resource-registry'
import { settingsRegistry } from './settings-registry'

@Injectable()
export abstract class BaseSettingsService<T> {
  constructor(
    protected readonly prisma: PrismaService,
    private readonly key: string,
    private readonly domain: string,
    private readonly schema: ZodObject<any>,
    private readonly scope: 'global' | 'branch' = 'global',
  ) {
    // Marca o schema como singleton para que discovery e metadata o reflitam
    ;(schema as any)._schemaMeta = {
      ...(schema as any)._schemaMeta,
      isSingleton: true,
    }
    settingsRegistry.push({ key, domain, schema, scope })
    resourceRegistry.push({ domain, resource: key, schema })
  }

  async get(branchId?: string): Promise<T> {
    const scopeValue = this.scope === 'branch' && branchId ? branchId : 'global'
    const row = await this.prisma.settings.findUnique({
      where: { key_scope: { key: this.key, scope: scopeValue } },
    })
    if (!row && this.scope === 'branch' && branchId) {
      const globalRow = await this.prisma.settings.findUnique({
        where: { key_scope: { key: this.key, scope: 'global' } },
      })
      return this.schema.parse(globalRow?.value ?? {}) as T
    }
    // schema.parse preenche defaults para campos ausentes — consistência lazy sem migration
    return this.schema.parse(row?.value ?? {}) as T
  }

  async put(dto: unknown, branchId?: string): Promise<T> {
    const scopeValue = this.scope === 'branch' && branchId ? branchId : 'global'
    const validated  = this.schema.parse(dto)
    const row = await this.prisma.settings.upsert({
      where:  { key_scope: { key: this.key, scope: scopeValue } },
      update: { value: validated as object },
      create: { key: this.key, scope: scopeValue, value: validated as object },
    })
    return row.value as T
  }

  getMetadata(): ResourceMetadata {
    return buildMetadata(this.key, this.schema)
  }
}
