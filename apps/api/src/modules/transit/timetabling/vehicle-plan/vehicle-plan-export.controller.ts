import { Controller, Get, Post, Param, Body, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { PrismaService } from '../../../../prisma/prisma.service'
import { VehiclePlanExportService } from './vehicle-plan-export.service'

@Controller('transit/vehicle-plan/:id/oso')
@UseGuards(JwtAuthGuard)
export class VehiclePlanExportController {
  constructor(
    private readonly exportService: VehiclePlanExportService,
    private readonly prisma:        PrismaService,
  ) {}

  // Lines available for OSO export: every TransitLine of the plan's scope (not just the
  // ones currently loaded in the Gantt — see plan_oso_export_v1.md "Frontend"), flagged
  // with whether they have any BlockTrip in this plan yet.
  @Get('lines')
  async lines(@Param('id') id: string) {
    const db   = this.prisma as any
    const plan = await db.vehiclePlan.findUniqueOrThrow({ where: { id }, select: { scopeId: true } })

    const [lines, tripLines] = await Promise.all([
      db.transitLine.findMany({
        where:   { scopeId: plan.scopeId },
        select:  { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      db.blockTrip.findMany({
        where:    { vehicleBlock: { vehiclePlanId: id } },
        select:   { trip: { select: { route: { select: { lineId: true } } } } },
        distinct: ['tripId'],
      }),
    ])

    const linesWithTrips = new Set<string>(tripLines.map((bt: any) => bt.trip.route.lineId))
    return lines.map((l: any) => ({ ...l, hasTrips: linesWithTrips.has(l.id) }))
  }

  @Post('export')
  async export(
    @Param('id') id: string,
    @Body('lineIds') lineIds: string[],
    @Res() res: Response,
  ) {
    const workbook = await this.exportService.exportOso(id, lineIds)
    const buffer   = await workbook.xlsx.writeBuffer()

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="oso.xlsx"')
    res.send(Buffer.from(buffer))
  }
}
