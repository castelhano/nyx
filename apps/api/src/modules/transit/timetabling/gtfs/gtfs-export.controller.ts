import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { GtfsExportService } from './gtfs-export.service'

@Controller('transit/gtfs')
@UseGuards(JwtAuthGuard)
export class GtfsExportController {
  constructor(private readonly service: GtfsExportService) {}

  @Get('options')
  options() {
    return this.service.options()
  }

  @Post('preview')
  preview(@Body() body: unknown) {
    return this.service.preview(body)
  }

  @Post('export')
  async export(@Body() body: unknown, @Res() res: Response) {
    const { fileName, zip } = await this.service.export(body)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(zip)
  }
}
