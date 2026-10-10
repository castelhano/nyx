import { Injectable } from '@nestjs/common'
import { crewAbsenceTypeSchema, CrewAbsenceType, CreateCrewAbsenceTypeDto, UpdateCrewAbsenceTypeDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class CrewAbsenceTypeService extends BaseService<CrewAbsenceType, CreateCrewAbsenceTypeDto, UpdateCrewAbsenceTypeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'crewAbsenceType', crewAbsenceTypeSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ code: stringContains(search) }, { name: stringContains(search) }] }
  }
}
