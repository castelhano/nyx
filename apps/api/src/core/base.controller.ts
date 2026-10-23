import { Get, Post, Patch, Delete, Param, Body, Query, Req, ForbiddenException, BadRequestException, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import type { PaginatedResult, PaginationQuery, ResourceMetadata, AuthUser, ImportResult } from '@nyx/types'
import { CaslAbilityFactory } from '../auth/casl.factory'
import { BaseService } from './base.service'

export abstract class BaseController<T, CreateDTO, UpdateDTO> {
  constructor(
    protected readonly service:      BaseService<T, CreateDTO, UpdateDTO>,
    protected readonly caslFactory?: CaslAbilityFactory,
  ) {}

  protected async assertAbility(user: AuthUser | undefined, action: string): Promise<void> {
    if (!this.caslFactory || !user) return
    const meta    = this.service.getMetadata()
    const subject = meta.resource[0].toUpperCase() + meta.resource.slice(1)
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, subject)) throw new ForbiddenException()
  }

  @Get('metadata')
  async getMetadata(@Req() req: { user?: AuthUser }): Promise<ResourceMetadata> {
    const meta = this.service.getMetadata()

    if (!this.caslFactory || !req.user) return meta

    const ability = await this.caslFactory.createForUser(req.user)
    const subject = meta.resource[0].toUpperCase() + meta.resource.slice(1)

    return {
      ...meta,
      permissions: {
        create: ability.can('create', subject),
        read:   ability.can('read',   subject),
        update: ability.can('update', subject),
        delete: ability.can('delete', subject),
      },
    }
  }

  @Get()
  async findAll(@Req() req: { user?: AuthUser }, @Query() query: PaginationQuery): Promise<PaginatedResult<T>> {
    await this.assertAbility(req.user, 'read')
    return this.service.findAll(query, req.user)
  }

  @Get('lookup')
  async lookup(@Req() req: { user?: AuthUser }, @Query('value') value: string): Promise<T | null> {
    await this.assertAbility(req.user, 'read')
    if (!value) return null
    return this.service.lookupByNameField(value, req.user)
  }

  @Get('import/template')
  async importTemplate(@Req() req: { user?: AuthUser }): Promise<{ headers: string[]; rows: string[][] }> {
    await this.assertAbility(req.user, 'read')
    return this.service.importTemplate()
  }

  // CSV import — a dry run unless dryRun=false; anyone who may edit the resource may import
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async import(
    @Req() req: { user?: AuthUser },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun?: string,
  ): Promise<ImportResult> {
    await this.assertAbility(req.user, 'update')
    if (!file) throw new BadRequestException('Arquivo não enviado')
    return this.service.importCsv(file.buffer, dryRun !== 'false', req.user)
  }

  @Get(':id')
  async findOne(@Req() req: { user?: AuthUser }, @Param('id') id: string): Promise<T> {
    await this.assertAbility(req.user, 'read')
    return this.service.findOne(id, req.user)
  }

  @Post()
  async create(@Req() req: { user?: AuthUser }, @Body() dto: CreateDTO): Promise<T> {
    await this.assertAbility(req.user, 'create')
    return this.service.create(dto, req.user)
  }

  @Patch(':id')
  async update(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() dto: UpdateDTO): Promise<T> {
    await this.assertAbility(req.user, 'update')
    return this.service.update(id, dto, req.user)
  }

  @Delete(':id')
  async remove(@Req() req: { user?: AuthUser }, @Param('id') id: string): Promise<void> {
    await this.assertAbility(req.user, 'delete')
    return this.service.remove(id, req.user)
  }
}
