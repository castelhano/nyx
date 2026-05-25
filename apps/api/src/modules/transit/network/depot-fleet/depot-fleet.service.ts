import { Injectable } from '@nestjs/common'
import { depotFleetSchema, DepotFleet, CreateDepotFleetDto, UpdateDepotFleetDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class DepotFleetService extends BaseService<DepotFleet, CreateDepotFleetDto, UpdateDepotFleetDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'depotFleet', depotFleetSchema, 'transit', 'branchId')
  }

  protected buildSearchWhere(_search: string) {
    return {}
  }
}
