import { Injectable, NotFoundException } from '@nestjs/common'
import { ZodObject } from 'zod'
import type { PaginatedResult, PaginationQuery, ResourceMetadata } from '@nyx/types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMetadata } from './metadata.builder'
import { resourceRegistry } from './resource-registry'

@Injectable()
export abstract class BaseService<T, CreateDTO, UpdateDTO> {
  constructor(
    protected readonly prisma: PrismaService,
    private readonly modelName: string,
    private readonly schema: ZodObject<any>,
    private readonly domain: string,
    private readonly scopeField?: string,
  ) {
    resourceRegistry.push({ domain, resource: modelName, schema })
  }

  private get model() {
    return (this.prisma as any)[this.modelName]
  }

  async findAll(query: PaginationQuery): Promise<PaginatedResult<T>> {
    const page     = Number(query.page)     || 1
    const pageSize = Number(query.pageSize) || 20
    const orderBy  = query.sortField
      ? { [query.sortField]: query.sortOrder ?? 'asc' }
      : { createdAt: 'desc' as const }

    const KNOWN_KEYS = new Set(['page', 'pageSize', 'search', 'sortField', 'sortOrder'])
    const contextFilters: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(query)) {
      if (!KNOWN_KEYS.has(k) && v !== undefined) contextFilters[k] = v
    }

    const where = {
      ...(query.search ? this.buildSearchWhere(query.search) : {}),
      ...contextFilters,
    }

    const [data, total] = await Promise.all([
      this.model.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.model.count({ where }),
    ])

    return { data, total, page, pageSize }
  }

  async findOne(id: string): Promise<T> {
    const item = await this.model.findUnique({ where: { id } })
    if (!item) throw new NotFoundException(`${this.modelName} not found`)
    return item
  }

  async create(dto: CreateDTO): Promise<T> {
    return this.model.create({ data: dto })
  }

  async update(id: string, dto: UpdateDTO): Promise<T> {
    await this.findOne(id)
    return this.model.update({ where: { id }, data: dto })
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id)
    await this.model.delete({ where: { id } })
  }

  getMetadata(): ResourceMetadata {
    return buildMetadata(this.modelName, this.schema)
  }

  protected buildSearchWhere(_search: string): Record<string, unknown> {
    return {}
  }
}
