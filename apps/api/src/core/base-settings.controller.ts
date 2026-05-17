import { Get, Put, Body, Req } from '@nestjs/common'
import type { ResourceMetadata, AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../auth/casl.factory'
import { BaseSettingsService } from './base-settings.service'

export abstract class BaseSettingsController<T> {
  constructor(
    protected readonly service:      BaseSettingsService<T>,
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
  get(@Req() req: { user?: AuthUser }): Promise<T> {
    return this.service.get()
  }

  @Put()
  put(@Body() dto: unknown, @Req() req: { user?: AuthUser }): Promise<T> {
    return this.service.put(dto)
  }
}
