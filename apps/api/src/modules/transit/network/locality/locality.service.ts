import { Injectable } from '@nestjs/common'
import { localitySchema, Locality, CreateLocalityDto, UpdateLocalityDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import { OsrmService } from '../travel-time/osrm.service'

@Injectable()
export class LocalityService extends BaseService<Locality, CreateLocalityDto, UpdateLocalityDto> {
  constructor(
    prisma: PrismaService,
    private readonly osrm: OsrmService,
  ) {
    super(prisma, 'transitLocality', localitySchema, 'transit', 'branchId')
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { name: stringContains(search) },
        { code: stringContains(search) },
      ],
    }
  }

  override async create(dto: CreateLocalityDto): Promise<Locality> {
    const result = await super.create(dto)
    this.osrm.generateMatrix(result.branchId).catch(() => {})
    return result
  }

  override async update(id: string, dto: UpdateLocalityDto): Promise<Locality> {
    const result = await super.update(id, dto)
    this.osrm.generateMatrix(result.branchId).catch(() => {})
    return result
  }
}
