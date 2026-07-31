import { Injectable } from '@nestjs/common'
import { scopeSchema, Scope, CreateScopeDto, UpdateScopeDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class ScopeService extends BaseService<Scope, CreateScopeDto, UpdateScopeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'scope', scopeSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }
}
