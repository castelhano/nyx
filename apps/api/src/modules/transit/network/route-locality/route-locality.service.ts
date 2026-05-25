import { Injectable } from '@nestjs/common'
import { routeLocalitySchema, RouteLocality, CreateRouteLocalityDto, UpdateRouteLocalityDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class RouteLocalityService extends BaseService<RouteLocality, CreateRouteLocalityDto, UpdateRouteLocalityDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'routeLocality', routeLocalitySchema, 'transit')
  }

  protected buildSearchWhere(_search: string) {
    return {}
  }
}
