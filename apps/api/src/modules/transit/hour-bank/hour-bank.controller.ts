import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { hourBankEntryInputSchema, hourBankSchema } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { buildMetadata } from '../../../core/metadata.builder'
import { HourBankService } from './hour-bank.service'
import { TimesheetImportService } from './timesheet-import.service'
import { decodeTimesheet } from './timesheet-parser'

type Req = { user?: AuthUser }

// No BaseController — the hour bank is computed; the metadata endpoint gates its page on the
// 'Hour-bank' CASL subject. Closing / reopening a month: anyone who may edit it.
@Controller('transit/hour-bank')
@UseGuards(JwtAuthGuard)
export class HourBankController {
  constructor(
    private readonly bank:        HourBankService,
    private readonly imports:     TimesheetImportService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get('metadata')
  async getMetadata(@Req() req: Req) {
    const meta = buildMetadata('hour-bank', hourBankSchema)
    if (!req.user) return meta
    const ability = await this.caslFactory.createForUser(req.user)
    return {
      ...meta,
      permissions: {
        create: ability.can('create', 'Hour-bank'),
        read:   ability.can('read',   'Hour-bank'),
        update: ability.can('update', 'Hour-bank'),
        delete: ability.can('delete', 'Hour-bank'),
      },
    }
  }

  @Get()
  async overview(@Req() req: Req, @Query('branchId') branchId: string, @Query('month') month: string) {
    await this.assert(req.user, 'read')
    if (!branchId) throw new BadRequestException('Informe a empresa')
    return this.bank.overview(branchId, month)
  }

  @Get('statement/:crewMemberId')
  async statement(@Req() req: Req, @Param('crewMemberId') crewMemberId: string, @Query('month') month: string) {
    await this.assert(req.user, 'read')
    return this.bank.statement(crewMemberId, month)
  }

  @Post('close')
  @HttpCode(204)
  async close(@Req() req: Req, @Body('branchId') branchId: string, @Body('month') month: string) {
    await this.assert(req.user, 'update')
    await this.bank.close(branchId, month, req.user?.id)
  }

  @Post('reopen')
  @HttpCode(204)
  async reopen(@Req() req: Req, @Body('branchId') branchId: string, @Body('month') month: string) {
    await this.assert(req.user, 'update')
    await this.bank.reopen(branchId, month)
  }

  @Post('entry')
  @HttpCode(204)
  async addEntry(@Req() req: Req, @Body() body: unknown) {
    await this.assert(req.user, 'create')
    const r = hourBankEntryInputSchema.safeParse(body)
    if (!r.success) throw new BadRequestException(r.error.issues.map(i => i.message))
    await this.bank.addEntry(r.data, req.user?.id)
  }

  @Delete('entry/:id')
  @HttpCode(204)
  async removeEntry(@Req() req: Req, @Param('id') id: string) {
    await this.assert(req.user, 'delete')
    await this.bank.removeEntry(id)
  }

  @Post('opening')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async importOpening(@Req() req: Req, @UploadedFile() file: Express.Multer.File, @Body('branchId') branchId: string) {
    await this.assert(req.user, 'create')
    if (!file) throw new BadRequestException('Arquivo não enviado')
    if (!branchId) throw new BadRequestException('Informe a empresa')
    return this.bank.importOpening(branchId, decodeTimesheet(file.buffer), req.user?.id)
  }

  @Get('imports')
  async history(@Req() req: Req, @Query('branchId') branchId: string) {
    await this.assert(req.user, 'read')
    return this.imports.history(branchId)
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  async import(@Req() req: Req, @UploadedFile() file: Express.Multer.File, @Body('branchId') branchId: string) {
    await this.assert(req.user, 'update')
    if (!file) throw new BadRequestException('Arquivo não enviado')
    if (!branchId) throw new BadRequestException('Informe a empresa')
    return this.imports.import(branchId, file, req.user?.id)
  }

  private async assert(user: AuthUser | undefined, action: string) {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, 'Hour-bank')) throw new ForbiddenException()
  }
}
