import { Injectable, NotFoundException } from '@nestjs/common'
import { ZodObject, ZodType, ZodDate, ZodNumber, ZodBoolean, ZodOptional, ZodNullable, ZodDefault } from 'zod'
import type { PaginatedResult, PaginationQuery, ResourceMetadata } from '@nyx/types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMetadata } from './metadata.builder'
import { buildFilterWhere } from './filter.builder'
import { resourceRegistry } from './resource-registry'

@Injectable()
export abstract class BaseService<T, CreateDTO, UpdateDTO> {
  private readonly resourceKey: string

  constructor(
    protected readonly prisma: PrismaService,
    private readonly modelName: string,
    private readonly schema: ZodObject<any>,
    domain: string,
    private readonly scopeField?: string,
  ) {
    this.resourceKey = modelName.replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`)
    resourceRegistry.push({ domain, resource: this.resourceKey, schema })
  }

  protected get model() {
    return (this.prisma as any)[this.modelName]
  }

  private buildRelationIncludes(): Record<string, unknown> {
    const include: Record<string, unknown> = {}
    for (const [fieldName, rawField] of Object.entries(this.schema.shape)) {
      const meta = (rawField as any).meta?.() ?? {}
      if (meta.widget !== 'select' || !meta.labelField || meta.virtual) continue
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

  async findAll(query: PaginationQuery): Promise<PaginatedResult<T>> {
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

    const where = {
      ...(query.search ? this.buildSearchWhere(query.search) : {}),
      ...contextFilters,
      ...buildFilterWhere(this.schema, query as Record<string, unknown>),
    }

    const include    = this.buildRelationIncludes()
    const includeOpt = Object.keys(include).length ? { include } : {}

    const [data, total] = await Promise.all([
      this.model.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, ...includeOpt }),
      this.model.count({ where }),
    ])

    return { data, total, page, pageSize }
  }

  async findOne(id: string): Promise<T> {
    const include    = this.buildRelationIncludes()
    const includeOpt = Object.keys(include).length ? { include } : {}
    const item = await this.model.findUnique({ where: { id }, ...includeOpt })
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
      const unwrapped = this.unwrapField(rawField as ZodType)
      const isOptional = (rawField as ZodType) instanceof ZodOptional || (rawField as ZodType) instanceof ZodNullable
      if (unwrapped instanceof ZodDate) {
        if (!dto[name]) continue
        result[name] = typeof dto[name] === 'string' ? new Date(dto[name] as string) : dto[name]
      } else if (unwrapped instanceof ZodNumber && typeof dto[name] === 'string') {
        if (dto[name] === '') continue
        const isInt = (unwrapped._def.checks as unknown as { kind: string }[])?.some((c) => c.kind === 'int') ?? false
        result[name] = isInt ? parseInt(dto[name] as string, 10) : parseFloat(dto[name] as string)
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

  async create(dto: CreateDTO): Promise<T> {
    return this.model.create({ data: this.sanitizeDto(dto as Record<string, unknown>) })
  }

  async update(id: string, dto: UpdateDTO): Promise<T> {
    await this.findOne(id)
    return this.model.update({ where: { id }, data: this.sanitizeDto(dto as Record<string, unknown>) })
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id)
    await this.model.delete({ where: { id } })
  }

  getMetadata(): ResourceMetadata {
    return buildMetadata(this.resourceKey, this.schema)
  }

  protected buildSearchWhere(_search: string): Record<string, unknown> {
    return {}
  }
}
