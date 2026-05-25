import { Injectable } from '@nestjs/common'
import { routeSchema, Route, CreateRouteDto, UpdateRouteDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class RouteService extends BaseService<Route, CreateRouteDto, UpdateRouteDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transitRoute', routeSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }
}
