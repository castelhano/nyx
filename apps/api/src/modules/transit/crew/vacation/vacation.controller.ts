import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common'
import { vacationLaunchSchema, vacationSchema } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { buildMetadata } from '../../../../core/metadata.builder'
import { VacationService } from './vacation.service'

type Req = { user?: AuthUser }

// No BaseController — férias are CrewOccurrences; this is their launch / list screen. The
// metadata endpoint gates the page on the 'Vacation' CASL subject.
@Controller('transit/vacation')
@UseGuards(JwtAuthGuard)
export class VacationController {
  constructor(
    private readonly vacations:   VacationService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get('metadata')
  async getMetadata(@Req() req: Req) {
    const meta = buildMetadata('vacation', vacationSchema)
    if (!req.user) return meta
    const ability = await this.caslFactory.createForUser(req.user)
    return {
      ...meta,
      permissions: {
        create: ability.can('create', 'Vacation'),
        read:   ability.can('read',   'Vacation'),
        update: ability.can('update', 'Vacation'),
        delete: ability.can('delete', 'Vacation'),
      },
    }
  }

  @Get()
  async list(
    @Req() req: Req,
    @Query('branchId') branchId?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('cover') cover?: string, @Query('search') search?: string,
  ) {
    await this.assert(req.user, 'read')
    return this.vacations.list({ branchId, from, to, cover, search })
  }

  @Post('check')
  async check(@Req() req: Req, @Body() body: unknown) {
    await this.assert(req.user, 'read')
    return this.vacations.check(this.parse(body))
  }

  @Post()
  async launch(@Req() req: Req, @Body() body: unknown) {
    await this.assert(req.user, 'create')
    return this.vacations.launch(this.parse(body), req.user?.id)
  }

  private parse(body: unknown) {
    const r = vacationLaunchSchema.safeParse(body)
    if (!r.success) throw new BadRequestException(r.error.issues.map(i => i.message))
    return r.data
  }

  private async assert(user: AuthUser | undefined, action: string) {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, 'Vacation')) throw new ForbiddenException()
  }
}
