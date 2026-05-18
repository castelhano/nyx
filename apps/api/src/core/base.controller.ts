import { Get, Post, Patch, Delete, Param, Body, Query, Req, ForbiddenException } from '@nestjs/common'
import type { PaginatedResult, PaginationQuery, ResourceMetadata, AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../auth/casl.factory'
import { BaseService } from './base.service'

export abstract class BaseController<T, CreateDTO, UpdateDTO> {
  constructor(
    protected readonly service:      BaseService<T, CreateDTO, UpdateDTO>,
    protected readonly caslFactory?: CaslAbilityFactory,
  ) {}

  private async assertAbility(user: AuthUser | undefined, action: string): Promise<void> {
    if (!this.caslFactory || !user) return
    const meta    = this.service.getMetadata()
    const subject = meta.resource[0].toUpperCase() + meta.resource.slice(1)
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, subject)) throw new ForbiddenException()
  }

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
  async findAll(@Req() req: { user?: AuthUser }, @Query() query: PaginationQuery): Promise<PaginatedResult<T>> {
    await this.assertAbility(req.user, 'read')
    return this.service.findAll(query)
  }

  @Get(':id')
  async findOne(@Req() req: { user?: AuthUser }, @Param('id') id: string): Promise<T> {
    await this.assertAbility(req.user, 'read')
    return this.service.findOne(id)
  }

  @Post()
  async create(@Req() req: { user?: AuthUser }, @Body() dto: CreateDTO): Promise<T> {
    await this.assertAbility(req.user, 'create')
    return this.service.create(dto)
  }

  @Patch(':id')
  async update(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() dto: UpdateDTO): Promise<T> {
    await this.assertAbility(req.user, 'update')
    return this.service.update(id, dto)
  }

  @Delete(':id')
  async remove(@Req() req: { user?: AuthUser }, @Param('id') id: string): Promise<void> {
    await this.assertAbility(req.user, 'delete')
    return this.service.remove(id)
  }
}
