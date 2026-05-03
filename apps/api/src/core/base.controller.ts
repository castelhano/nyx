import { Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common'
import type { PaginatedResult, PaginationQuery, ResourceMetadata } from '@nyx/types'
import { BaseService } from './base.service'

export abstract class BaseController<T, CreateDTO, UpdateDTO> {
  constructor(protected readonly service: BaseService<T, CreateDTO, UpdateDTO>) {}

  @Get('metadata')
  getMetadata(): ResourceMetadata {
    return this.service.getMetadata()
  }

  @Get()
  findAll(@Query() query: PaginationQuery): Promise<PaginatedResult<T>> {
    return this.service.findAll(query)
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<T> {
    return this.service.findOne(id)
  }

  @Post()
  create(@Body() dto: CreateDTO): Promise<T> {
    return this.service.create(dto)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDTO): Promise<T> {
    return this.service.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.service.remove(id)
  }
}
