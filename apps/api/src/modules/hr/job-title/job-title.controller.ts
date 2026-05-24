import { Controller, UseGuards } from '@nestjs/common'
import { JobTitle, CreateJobTitleDto, UpdateJobTitleDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { JobTitleService } from './job-title.service'

@Controller('hr/job-title')
@UseGuards(JwtAuthGuard)
export class JobTitleController extends BaseController<JobTitle, CreateJobTitleDto, UpdateJobTitleDto> {
  constructor(
    private readonly jobTitleService: JobTitleService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(jobTitleService, caslFactory)
  }
}
