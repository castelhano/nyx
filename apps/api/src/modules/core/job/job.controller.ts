import { Controller, Get, Param, Query, Req, ForbiddenException, UseGuards } from '@nestjs/common'
import { JobService } from './job.service'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import type { PaginationQuery, ResourceMetadata, AuthUser } from '@nyx/types'

@Controller('core/job')
@UseGuards(JwtAuthGuard)
export class JobController {
  constructor(
    private readonly service:      JobService,
    private readonly caslFactory:  CaslAbilityFactory,
  ) {}

  @Get('metadata')
  async getMetadata(@Req() req: { user?: AuthUser }): Promise<ResourceMetadata> {
    const meta = this.service.getMetadata()
    if (!req.user) return meta
    const ability = await this.caslFactory.createForUser(req.user)
    return {
      ...meta,
      permissions: {
        create: false,
        read:   ability.can('read', 'Job'),
        // Job has no real update endpoint (read-only) — but the generic AutoList
        // uses "update" to decide whether to show the row's open button, so
        // mirroring "read" here is what makes that button appear, without
        // opening any real write action (there is no PATCH).
        update: ability.can('read', 'Job'),
        delete: false,
      },
    }
  }

  @Get()
  async findAll(@Req() req: { user: AuthUser }, @Query() query: PaginationQuery) {
    return this.service.findAllForUser(query, req.user)
  }

  @Get(':id')
  async findOne(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    const job = await this.service.findOne(id)
    if (req.user.role !== 'admin' && (job as any).createdById !== req.user.id) {
      throw new ForbiddenException()
    }
    return job
  }
}
