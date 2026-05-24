import { Injectable } from '@nestjs/common'
import { jobTitleSchema, JobTitle, CreateJobTitleDto, UpdateJobTitleDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

@Injectable()
export class JobTitleService extends BaseService<JobTitle, CreateJobTitleDto, UpdateJobTitleDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'jobTitle', jobTitleSchema, 'hr')
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ name: stringContains(search) }] }
  }
}
