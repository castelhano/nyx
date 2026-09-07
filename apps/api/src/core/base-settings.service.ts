import { BadRequestException, Injectable } from '@nestjs/common'
import { ZodObject } from 'zod'
import type { ResourceMetadata } from '@nyx/types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMetadata } from './metadata.builder'
import { resourceRegistry } from './resource-registry'
import { settingsRegistry } from './settings-registry'
import { getResourcePointerFields } from './settings-reference.utils'

// Base class for every Settings-backed module (Settings.value, apps/api/prisma/schema/
// core.prisma) — a singleton config living as one JSON blob per (key, scope). Extend this
// instead of hand-rolling get()/put() against `prisma.settings` directly:
//
// - Schema drift is handled for you: `get()` runs the field's `.default()` for anything
//   missing from the stored JSON (added a field after the fact? old rows just pick up the
//   default), and `put()` persists the full parsed object back, upgrading the stored shape on
//   the next save. This only holds if a field is never renamed — Zod silently strips unknown
//   keys on parse, so a rename is indistinguishable from delete-old+add-new and drops the old
//   value with zero warning. Add fields freely; never rename one that shipped.
// - A field whose value is another resource's id (this table has no real FK — it's JSON) must
//   carry `.meta({ resource, domain })`, the same meta a select-widget field already needs for
//   its dropdown. That's what lets put() reject a dangling id and lets deleting the referenced
//   record be blocked while still pointed at — see settings-reference.utils.ts.
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
    await this.assertReferencedRecordsExist(validated)
    // eslint's type-aware check disagrees with tsc here — `as object` looks redundant to it,
    // but the generic `T` really does make tsc reject `validated` against Prisma's Json input
    // type without it (confirmed: removing it breaks `tsc --noEmit`).
    const row = await this.prisma.settings.upsert({
      where:  { key_scope: { key: this.key, scope: scopeValue } },
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      update: { value: validated as object },
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      create: { key: this.key, scope: scopeValue, value: validated as object },
    })
    return row.value as T
  }

  getMetadata(): ResourceMetadata {
    return buildMetadata(this.key, this.schema)
  }

  // Settings-JSON pointer fields (meta.resource/domain) have no real FK — a save with a
  // stale/invalid id would otherwise persist silently. One indexed lookup per pointer field,
  // only on save (rare, admin-driven), against whatever model that resource resolves to via
  // resourceRegistry (see settings-reference.utils.ts).
  private async assertReferencedRecordsExist(value: Record<string, unknown>): Promise<void> {
    for (const field of getResourcePointerFields(this.schema)) {
      const id = value[field.fieldName]
      if (id == null) continue
      const entry = resourceRegistry.find(e => e.domain === field.domain && e.resource === field.resource)
      if (!entry?.modelName) continue
      const exists = await (this.prisma as any)[entry.modelName].findUnique({ where: { id }, select: { id: true } })
      if (!exists) throw new BadRequestException(`${field.label ?? field.fieldName}: registro não encontrado`)
    }
  }
}
