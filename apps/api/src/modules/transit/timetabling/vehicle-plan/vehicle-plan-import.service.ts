import { randomUUID } from 'crypto'
import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'
import { JobService } from '../../../core/job/job.service'
import { parseVehiclePlanFile, parseHHMM } from './vehicle-plan-import.parser'

interface ImportOutput {
  created:     number  // VehicleBlock records created
  updated:     number  // BlockTrip records created
  deactivated: number  // lines cleared
  errors:      Array<{ line: number; record: string; message: string }>
}

@Injectable()
export class VehiclePlanImportService {
  constructor(
    private readonly prisma:      PrismaService,
    private readonly jobService:  JobService,
  ) {}

  async import(
    file:      Express.Multer.File,
    branchId:  string,
    dayTypeId: string,
    depotId:   string,
    userId:    string,
  ): Promise<{ jobId: string }> {
    if (!file.buffer?.length) throw new BadRequestException('Arquivo vazio')

    const job = await this.jobService.createJob({
      type:        'vehicle-plan-import',
      domain:      'transit',
      resource:    'vehicle-plan',
      createdById: userId,
      input:       { filename: file.originalname, branchId, dayTypeId, depotId },
    })

    this.jobService.run(job.id, () => this.execute(file.buffer, branchId, dayTypeId, depotId))

    return { jobId: job.id }
  }

  private async execute(
    buffer:    Buffer,
    branchId:  string,
    dayTypeId: string,
    depotId:   string,
  ): Promise<ImportOutput> {
    const rows = parseVehiclePlanFile(buffer)
    if (rows.length === 0) throw new Error('Nenhum registro encontrado no arquivo')

    const errors: ImportOutput['errors'] = []

    // Group rows by vehicleNumber → each unique vehicle = one VehicleBlock.
    // tabId identifies driver shifts within the same vehicle, not separate blocks.
    // Falls back to lineCode when vehicleNumber is absent.
    const blockMap = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = row.vehicleNumber || row.lineCode
      if (!blockMap.has(key)) blockMap.set(key, [])
      blockMap.get(key)!.push(row)
    }

    const lineCodes = [...new Set(rows.map(r => r.lineCode))]

    // Resolve TransitLine records
    const transitLines = await (this.prisma as any).transitLine.findMany({
      where: { code: { in: lineCodes } },
    })
    const lineByCode = new Map<string, { id: string; code: string }>(
      transitLines.map((l: any) => [l.code, l]),
    )
    for (const code of lineCodes) {
      if (!lineByCode.has(code)) {
        errors.push({ line: 0, record: code, message: `Linha ${code} não encontrada no cadastro` })
      }
    }

    const validLineIds = transitLines.map((l: any) => l.id)

    // Resolve TransitRoute records for all valid lines
    const routes = await (this.prisma as any).transitRoute.findMany({
      where: { lineId: { in: validLineIds } },
    })
    const routeByKey = new Map<string, { id: string }>(
      routes.map((r: any) => [`${r.lineId}:${r.direction}`, r]),
    )

    // Clear existing data for each found line in this daytype
    let linesCleared = 0
    for (const line of transitLines) {
      await this.clearLineForDayType(line.id, dayTypeId)
      linesCleared++
    }

    // Create a new DRAFT VehiclePlan for the daytype
    const plan = await (this.prisma as any).vehiclePlan.create({
      data: {
        dayTypeId,
        status: 'DRAFT',
        lines: {
          create: transitLines.map((l: any) => ({ lineId: l.id })),
        },
      },
    })

    // Collect all records to insert — no DB calls in this loop
    const tripRows:      Array<{ id: string; routeId: string; departureMinutes: number; arrivalMinutes: number }> = []
    const tripDayTypes:  Array<{ tripId: string; dayTypeId: string }> = []
    const blockRows:     Array<{ id: string; vehiclePlanId: string; branchId: string; blockNumber: number; depotId: string; vehicleType: string }> = []
    const blockTripRows: Array<{ vehicleBlockId: string; tripId: string; sequence: number; isDeadhead: boolean }> = []

    let blockNumber = 1

    for (const [, tabRows] of blockMap.entries()) {
      // Sort trips chronologically within the block
      tabRows.sort((a, b) => {
        const aMin = parseHHMM(a.departureHHMM) + (a.depDay - 1) * 1440
        const bMin = parseHHMM(b.departureHHMM) + (b.depDay - 1) * 1440
        return aMin - bMin
      })

      const blockId    = randomUUID()
      let   seqInBlock = 1
      let   hasTrips   = false

      for (const row of tabRows) {
        const line = lineByCode.get(row.lineCode)
        if (!line) continue

        // I = IDA = OUTBOUND, V = VOLTA = INBOUND
        const direction = row.direction === 'I' ? 'OUTBOUND' : 'INBOUND'
        const route     = routeByKey.get(`${line.id}:${direction}`)

        if (!route) {
          errors.push({
            line:    row._lineNum,
            record:  `${row.lineCode} tab ${row.tabId}`,
            message: `Rota ${direction} não encontrada para linha ${row.lineCode}`,
          })
          continue
        }

        const tripId           = randomUUID()
        const departureMinutes = parseHHMM(row.departureHHMM) + (row.depDay - 1) * 1440
        const arrivalMinutes   = parseHHMM(row.arrivalHHMM)   + (row.arrDay - 1) * 1440

        tripRows.push({ id: tripId, routeId: route.id, departureMinutes, arrivalMinutes })
        tripDayTypes.push({ tripId, dayTypeId })
        blockTripRows.push({ vehicleBlockId: blockId, tripId, sequence: seqInBlock++, isDeadhead: !row.isProductive })
        hasTrips = true
      }

      if (!hasTrips) continue

      blockRows.push({ id: blockId, vehiclePlanId: plan.id, branchId, blockNumber: blockNumber++, depotId, vehicleType: 'BUS' })
    }

    // 4 bulk inserts instead of O(n_trips) individual creates
    await (this.prisma as any).transitTrip.createMany({
      data: tripRows.map(r => ({ ...r, requiredVehicleType: 'BUS' })),
    })
    await (this.prisma as any).tripDayType.createMany({ data: tripDayTypes })
    await (this.prisma as any).vehicleBlock.createMany({ data: blockRows })
    await (this.prisma as any).blockTrip.createMany({ data: blockTripRows })

    return { created: blockRows.length, updated: tripRows.length, deactivated: linesCleared, errors }
  }

  private async clearLineForDayType(lineId: string, dayTypeId: string): Promise<void> {
    // All TransitTrip IDs for this line + daytype
    const trips = await (this.prisma as any).transitTrip.findMany({
      where: {
        route:    { lineId },
        dayTypes: { some: { dayTypeId } },
      },
      select: { id: true },
    })
    const tripIds: string[] = trips.map((t: any) => t.id)
    if (tripIds.length === 0) return

    // Find BlockTrips that reference these trips
    const affected = await (this.prisma as any).blockTrip.findMany({
      where:  { tripId: { in: tripIds } },
      select: { vehicleBlockId: true },
    })
    const blockIds = [...new Set<string>(affected.map((bt: any) => bt.vehicleBlockId))]

    // Remove the BlockTrips
    await (this.prisma as any).blockTrip.deleteMany({ where: { tripId: { in: tripIds } } })

    // Handle each affected VehicleBlock
    for (const blockId of blockIds) {
      const remaining = await (this.prisma as any).blockTrip.count({ where: { vehicleBlockId: blockId } })
      if (remaining === 0) {
        await (this.prisma as any).vehicleBlock.delete({ where: { id: blockId } })
      } else {
        await (this.prisma as any).vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
      }
    }

    // Remove TripDayType entries for this daytype
    await (this.prisma as any).tripDayType.deleteMany({ where: { tripId: { in: tripIds }, dayTypeId } })

    // Delete TransitTrip records with no remaining daytype associations
    const orphans = await (this.prisma as any).transitTrip.findMany({
      where:  { id: { in: tripIds }, dayTypes: { none: {} } },
      select: { id: true },
    })
    if (orphans.length > 0) {
      await (this.prisma as any).transitTrip.deleteMany({
        where: { id: { in: orphans.map((t: any) => t.id) } },
      })
    }

    // Remove VehiclePlanLine entries for this line in plans with this daytype
    const plans = await (this.prisma as any).vehiclePlan.findMany({
      where:  { dayTypeId },
      select: { id: true },
    })
    if (plans.length > 0) {
      await (this.prisma as any).vehiclePlanLine.deleteMany({
        where: { vehiclePlanId: { in: plans.map((p: any) => p.id) }, lineId },
      })
    }
  }
}
