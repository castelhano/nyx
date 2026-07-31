import { Injectable } from '@nestjs/common'
import { scopeOperatorSchema, ScopeOperator, CreateScopeOperatorDto, UpdateScopeOperatorDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class ScopeOperatorService extends BaseService<ScopeOperator, CreateScopeOperatorDto, UpdateScopeOperatorDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'scopeOperator', scopeOperatorSchema, 'transit')
  }
}
