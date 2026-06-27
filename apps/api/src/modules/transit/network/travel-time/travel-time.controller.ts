import { Controller, Post, HttpCode, UseGuards, Request, Body } from '@nestjs/common'
import { TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { TravelTimeService } from './travel-time.service'
import { OsrmService } from './osrm.service'
import { JobService } from '../../../core/job/job.service'

@Controller('transit/travel-time-matrix')
@UseGuards(JwtAuthGuard)
export class TravelTimeController extends BaseController<TravelTime, CreateTravelTimeDto, UpdateTravelTimeDto> {
  constructor(
    private readonly travelTimeService: TravelTimeService,
    private readonly osrm: OsrmService,
    private readonly jobService: JobService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(travelTimeService, caslFactory)
  }

  @Post('generate')
  @HttpCode(200)
  async generate(
    @Request() req: any,
    @Body() body: { source?: 'OSRM' | 'MANUAL' },
  ): Promise<{ jobId: string }> {
    const source = body?.source === 'MANUAL' ? 'MANUAL' : 'OSRM'

    const job = await this.jobService.createJob({
      type:        'osrm-matrix',
      domain:      'transit',
      resource:    'travel-time-matrix',
      createdById: req.user.id,
    })

    this.jobService.run(job.id, () => this.osrm.generateMatrix({ source }))

    return { jobId: job.id }
  }
}
