import { Injectable } from '@nestjs/common'
import { scopeSchema, Scope, CreateScopeDto, UpdateScopeDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class ScopeService extends BaseService<Scope, CreateScopeDto, UpdateScopeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'scope', scopeSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }

  async update(id: string, dto: UpdateScopeDto): Promise<Scope> {
    const current = await this.findOne(id) as Scope
    const result  = await super.update(id, dto)

    const oldUrl = current.logoUrl
    const newUrl = (result as Scope).logoUrl
    if (oldUrl && oldUrl !== newUrl && oldUrl.startsWith('/api/uploads/')) {
      const filePath = path.join(process.cwd(), oldUrl.replace('/api/', ''))
      fs.promises.unlink(filePath).catch(() => {})
    }

    return result
  }
}
