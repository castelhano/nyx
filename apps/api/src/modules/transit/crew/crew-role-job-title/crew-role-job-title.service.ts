import { Injectable } from '@nestjs/common'
import { crewRoleJobTitleSchema, CrewRoleJobTitle, CreateCrewRoleJobTitleDto, UpdateCrewRoleJobTitleDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class CrewRoleJobTitleService extends BaseService<CrewRoleJobTitle, CreateCrewRoleJobTitleDto, UpdateCrewRoleJobTitleDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'crewRoleJobTitle', crewRoleJobTitleSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { jobTitle: { name: stringContains(search) } }
  }
}
