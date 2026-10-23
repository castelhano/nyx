import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { ZodObject, ZodType, ZodDate, ZodNumber, ZodBoolean, ZodOptional, ZodNullable, ZodDefault } from 'zod'
import type { AuthUser, ImportResult, ImportValue, PaginatedResult, PaginationQuery, ResourceMetadata } from '@nyx/types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMetadata } from './metadata.builder'
import { buildFilterWhere } from './filter.builder'
import { stringEquals } from './db.utils'
import { resourceRegistry } from './resource-registry'
import { settingsRegistry } from './settings-registry'
import { getResourcePointerFields } from './settings-reference.utils'
import { buildImportTemplate, runImport, type ImportOp } from './import/import.engine'

@Injectable()
export abstract class BaseService<T, CreateDTO, UpdateDTO> {
  private readonly resourceKey: string

  constructor(
    protected readonly prisma: PrismaService,
    private readonly modelName: string,
    private readonly schema: ZodObject<any>,
    private readonly domain: string,
    private readonly scopeField?: string,
  ) {
    this.resourceKey = modelName.replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`)
    resourceRegistry.push({ domain, resource: this.resourceKey, schema, modelName })
  }

  protected get model() {
    return (this.prisma as any)[this.modelName]
  }

  private buildRelationIncludes(): Record<string, unknown> {
    const include: Record<string, unknown> = {}
    for (const [fieldName, rawField] of Object.entries(this.schema.shape)) {
      const meta = (rawField as any).meta?.() ?? {}
      if ((meta.widget !== 'select' && meta.widget !== 'combobox') || !meta.labelField || meta.virtual || meta.computed) continue
      const relationName = fieldName.replace(/Id$/, '')
      const select: Record<string, boolean> = { id: true, [meta.labelField]: true }
      if (Array.isArray(meta.relatedDisplayFields)) {
        for (const f of meta.relatedDisplayFields) select[f] = true
      }
      include[relationName] = {
        select,
        ...(meta.relatedWhere ? { where: meta.relatedWhere } : {}),
      }
    }
    return include
  }

  // Branch scoping: with a scopeField, non-admins only reach records of their own branches.
  // No user (internal calls) means no scoping.
  private scopeWhere(user?: AuthUser): Record<string, unknown> | null {
    if (!this.scopeField || !user || user.role === 'admin') return null
    return { [this.scopeField]: { in: user.branchIds } }
  }

  private withScope(where: Record<string, unknown>, user?: AuthUser): Record<string, unknown> {
    const scope = this.scopeWhere(user)
    return scope ? { AND: [where, scope] } : where
  }

  private assertInScope(dto: unknown, user?: AuthUser): void {
    if (!this.scopeWhere(user)) return
    const branchId = (dto as Record<string, unknown>)[this.scopeField!]
    if (typeof branchId === 'string' && !user!.branchIds.includes(branchId)) {
      throw new ForbiddenException('Filial fora do seu acesso')
    }
  }

  async findAll(query: PaginationQuery, user?: AuthUser): Promise<PaginatedResult<T>> {
    const page     = Number(query.page)     || 1
    const pageSize = Number(query.pageSize) || 20
    const defaultSort = (this.schema as any)._schemaMeta?.defaultSort
    const orderBy = query.sortField
      ? { [query.sortField]: query.sortOrder ?? 'asc' }
      : defaultSort
        ? { [defaultSort.field]: defaultSort.order }
        : { createdAt: 'desc' as const }

    const KNOWN_KEYS = new Set(['page', 'pageSize', 'search', 'sortField', 'sortOrder'])
    const contextFilters: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(query)) {
      if (!KNOWN_KEYS.has(k) && !k.startsWith('f_') && v !== undefined) contextFilters[k] = v
    }

    const where = this.withScope({
      ...(query.search ? this.buildSearchWhere(query.search) : {}),
      ...contextFilters,
      ...this.buildFilterWhere(query),
    }, user)

    const include    = this.buildRelationIncludes()
    const includeOpt = Object.keys(include).length ? { include } : {}

    const [data, total] = await Promise.all([
      this.model.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, ...includeOpt }),
      this.model.count({ where }),
    ])

    return { data, total, page, pageSize }
  }

  async lookupByNameField(value: string, user?: AuthUser): Promise<T | null> {
    const nameField   = (this.schema as any)._schemaMeta?.nameField ?? 'name'
    const fieldSchema = this.unwrapField(this.schema.shape[nameField] as ZodType)
    const include      = this.buildRelationIncludes()
    const includeOpt   = Object.keys(include).length ? { include } : {}

    try {
      if (fieldSchema instanceof ZodNumber) {
        const num = Number(value)
        if (Number.isNaN(num)) return null
        return await this.model.findFirst({ where: this.withScope({ [nameField]: num }, user), ...includeOpt })
      }

      return await this.model.findFirst({ where: this.withScope({ [nameField]: stringEquals(value) }, user), ...includeOpt })
    } catch {
      // nameField pode não suportar o filtro (ex.: enum) — trata como "não encontrado"
      return null
    }
  }

  async findOne(id: string, user?: AuthUser): Promise<T> {
    const include    = this.buildRelationIncludes()
    const includeOpt = Object.keys(include).length ? { include } : {}
    // out of the user's branches reads as not found, not as forbidden
    const item = this.scopeWhere(user)
      ? await this.model.findFirst({ where: this.withScope({ id }, user), ...includeOpt })
      : await this.model.findUnique({ where: { id }, ...includeOpt })
    if (!item) throw new NotFoundException(`${this.modelName} not found`)
    return item
  }

  private unwrapField(field: ZodType): ZodType {
    if (field instanceof ZodOptional || field instanceof ZodNullable || field instanceof ZodDefault) {
      return this.unwrapField((field as any)._def.innerType)
    }
    return field
  }

  private static readonly IMMUTABLE_FIELDS = new Set(['id', 'createdAt', 'updatedAt'])

  protected sanitizeDto(dto: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [name, rawField] of Object.entries(this.schema.shape)) {
      if (BaseService.IMMUTABLE_FIELDS.has(name) || !(name in dto)) continue
      if ((rawField as any).meta?.()?.computed) continue
      const unwrapped = this.unwrapField(rawField as ZodType)
      const isOptional = (rawField as ZodType) instanceof ZodOptional || (rawField as ZodType) instanceof ZodNullable
      if (unwrapped instanceof ZodDate) {
        if (!dto[name]) continue
        result[name] = typeof dto[name] === 'string' ? new Date(dto[name]) : dto[name]
      } else if (unwrapped instanceof ZodNumber && typeof dto[name] === 'string') {
        if (dto[name] === '') continue
        const isInt = (unwrapped._def.checks as unknown as { kind: string }[])?.some((c) => c.kind === 'int') ?? false
        result[name] = isInt ? parseInt(dto[name], 10) : parseFloat(dto[name])
      } else if (unwrapped instanceof ZodBoolean && typeof dto[name] === 'string') {
        result[name] = dto[name] === 'true'
      } else if (isOptional && dto[name] === '') {
        // skip — don't send empty string for optional fields (e.g. enums)
      } else {
        result[name] = dto[name]
      }
    }
    return result
  }

  create(dto: CreateDTO, user?: AuthUser): Promise<T> {
    this.assertInScope(dto, user)
    return this.model.create({ data: this.sanitizeDto(dto as Record<string, unknown>) })
  }

  async update(id: string, dto: UpdateDTO, user?: AuthUser): Promise<T> {
    await this.findOne(id, user)
    this.assertInScope(dto, user)
    return this.model.update({ where: { id }, data: this.sanitizeDto(dto as Record<string, unknown>) })
  }

  async remove(id: string, user?: AuthUser): Promise<void> {
    await this.findOne(id, user)
    await this.assertNotReferencedBySettings(id)
    await this.model.delete({ where: { id } })
  }

  // Mirrors the friendly 409 a real Prisma FK violation already gets (exception.filter.ts,
  // P2003) for the one relation Prisma can't see: a Settings-JSON field pointing at this
  // resource (meta.resource/domain on a select field — see settings-reference.utils.ts).
  // Settings has at most a handful of rows total, so this is a handful of tiny queries, not
  // a scan of anything user-data-sized.
  private async assertNotReferencedBySettings(id: string): Promise<void> {
    for (const settingsEntry of settingsRegistry) {
      const pointerFields = getResourcePointerFields(settingsEntry.schema)
        .filter(f => f.domain === this.domain && f.resource === this.resourceKey)
      if (pointerFields.length === 0) continue

      const rows = await this.prisma.settings.findMany({ where: { key: settingsEntry.key } })
      for (const row of rows) {
        const value = row.value as Record<string, unknown>
        const hit = pointerFields.find(f => value[f.fieldName] === id)
        if (hit) throw new ConflictException(`Não é possível excluir: em uso em Configurações (${hit.label ?? hit.fieldName})`)
      }
    }
  }

  // CSV import (docs/FLOW.md) — available when the schema declares importKey
  private assertImportable(): void {
    if (!(this.schema as any)._schemaMeta?.importKey) throw new NotFoundException('Importação não disponível para este recurso')
  }

  async importCsv(buffer: Uint8Array, dryRun: boolean, user?: AuthUser): Promise<ImportResult> {
    this.assertImportable()
    const result = await runImport(buffer, {
      prisma:     this.prisma,
      modelName:  this.modelName,
      schema:     this.schema,
      scopeField: this.scopeField,
      user,
      dryRun,
      write:      (tx, op) => this.importWrite(tx, op),
    })
    if (!dryRun && !result.errors.length && !result.invalid && result.created + result.updated > 0) await this.afterImport()
    return result
  }

  // once after an import that wrote something — for work a resource does on each save that
  // shouldn't run per row (e.g. the localities' travel-time matrix)
  protected async afterImport(): Promise<void> {}

  importTemplate(): { headers: string[]; rows: string[][] } {
    this.assertImportable()
    return buildImportTemplate(this.schema)
  }

  // one validated row of an import, inside its transaction — override for resources whose
  // writes carry more than their own columns (e.g. Employee + Contract)
  protected async importWrite(tx: Prisma.TransactionClient, op: ImportOp): Promise<void> {
    if (Object.keys(op.nested).length || Object.keys(op.extra).length) throw new Error(`${this.modelName}: importNested/importFields need an importWrite override`)
    const model = (tx as any)[this.modelName]
    if (op.action === 'create') await model.create({ data: op.data })
    else await model.update({ where: { id: op.id }, data: op.data })
  }

  // accepted values of import columns that the schema can't list (e.g. the registered resources),
  // by column name — the import modal shows them; validation stays in importWrite
  protected importValues(): Record<string, ImportValue[]> {
    return {}
  }

  getMetadata(): ResourceMetadata {
    const meta   = buildMetadata(this.resourceKey, this.schema)
    const values = meta.import ? this.importValues() : {}
    if (meta.import && Object.keys(values).length) {
      meta.import.columns = meta.import.columns.map(c => (values[c.name] ? { ...c, values: values[c.name] } : c))
    }
    return meta
  }

  protected buildSearchWhere(_search: string): Record<string, unknown> {
    return {}
  }

  // override to translate filters on computed fields (f_<field>) into relation conditions
  protected buildFilterWhere(query: Record<string, unknown>): Record<string, unknown> {
    return buildFilterWhere(this.schema, query)
  }
}
