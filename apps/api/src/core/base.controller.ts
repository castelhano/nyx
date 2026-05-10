import { Get, Post, Patch, Delete, Param, Body, Query, Req } from '@nestjs/common'
import type { PaginatedResult, PaginationQuery, ResourceMetadata, AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../auth/casl.factory'
import { BaseService } from './base.service'

export abstract class BaseController<T, CreateDTO, UpdateDTO> {
  constructor(
    protected readonly service:      BaseService<T, CreateDTO, UpdateDTO>,
    protected readonly caslFactory?: CaslAbilityFactory,
  ) {}

  @Get('metadata')
  async getMetadata(@Req() req: { user?: AuthUser }): Promise<ResourceMetadata> {
    const meta = this.service.getMetadata()

    if (!this.caslFactory || !req.user) return meta

    const ability = await this.caslFactory.createForUser(req.user)
    const subject = meta.resource[0].toUpperCase() + meta.resource.slice(1)

    return {
      ...meta,
      permissions: {
        create: ability.can('create', subject),
        read:   ability.can('read',   subject),
        update: ability.can('update', subject),
        delete: ability.can('delete', subject),
      },
    }
  }

  @Get()
  findAll(@Query() query: PaginationQuery): Promise<PaginatedResult<T>> {
    return this.service.findAll(query)
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<T> {
    return this.service.findOne(id)
  }

  @Post()
  create(@Body() dto: CreateDTO): Promise<T> {
    return this.service.create(dto)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDTO): Promise<T> {
    return this.service.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.service.remove(id)
  }
}
