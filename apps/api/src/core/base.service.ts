import { Injectable, NotFoundException } from '@nestjs/common'
import { ZodObject } from 'zod'
import type { PaginatedResult, PaginationQuery, ResourceMetadata } from '@nyx/types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMetadata } from './metadata.builder'

@Injectable()
export abstract class BaseService<T, CreateDTO, UpdateDTO> {
  constructor(
    protected readonly prisma: PrismaService,
    private readonly modelName: string,
    private readonly schema: ZodObject<any>,
  ) {}

  private get model() {
    return (this.prisma as any)[this.modelName]
  }

  async findAll(query: PaginationQuery): Promise<PaginatedResult<T>> {
    const page     = Number(query.page)     || 1
    const pageSize = Number(query.pageSize) || 20
    const where    = query.search ? this.buildSearchWhere(query.search) : {}
    const orderBy  = query.sortField
      ? { [query.sortField]: query.sortOrder ?? 'asc' }
      : { createdAt: 'desc' as const }

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
