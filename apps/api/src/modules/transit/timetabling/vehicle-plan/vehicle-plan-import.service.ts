import { randomUUID } from 'crypto'
import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'
import { JobService } from '../../../core/job/job.service'
import { VehiclePlanService } from './vehicle-plan.service'
import { parseVehiclePlanFile, parseHHMM } from './vehicle-plan-import.parser'

interface ImportOutput {
  created: number  // VehicleBlock records created
  trips:   number  // TransitTrip records created
  errors:  Array<{ line: number; record: string; message: string }>
}

@Injectable()
export class VehiclePlanImportService {
  constructor(
    private readonly prisma:           PrismaService,
    private readonly jobService:       JobService,
    private readonly vehiclePlanSvc:   VehiclePlanService,
  ) {}

  async import(
    file:         Express.Multer.File,
    branchId:     string,
    dayTypeId:    string,
    depotId:      string,
    userId:       string,
    setupMinutes: number = 0,
    planId?:      string,
  ): Promise<{ jobId: string }> {
    if (!file.buffer?.length) throw new BadRequestException('Arquivo vazio')

    const job = await this.jobService.createJob({
      type:        'vehicle-plan-import',
      domain:      'transit',
      resource:    'vehicle-plan',
      createdById: userId,
      input:       { filename: file.originalname, branchId, dayTypeId, depotId, setupMinutes, planId },
    })

    this.jobService.run(job.id, () => this.execute(file.buffer, branchId, dayTypeId, depotId, setupMinutes, planId))

    return { jobId: job.id }
  }

  private async execute(
    buffer:       Buffer,
    branchId:     string,
    dayTypeId:    string,
    depotId:      string,
    setupMinutes: number = 0,
    planId?:      string,
  ): Promise<ImportOutput> {
    // In update mode the dayType comes from the existing plan
    if (planId) {
      const existing = await (this.prisma as any).vehiclePlan.findUnique({
        where:  { id: planId },
        select: { dayTypeId: true },
      })
      if (!existing) throw new Error('Planejamento não encontrado')
      dayTypeId = existing.dayTypeId
    }

    const { rows, skipped } = parseVehiclePlanFile(buffer)
    if (rows.length === 0) throw new Error('Nenhum registro encontrado no arquivo')

    const errors: ImportOutput['errors'] = skipped.map(s => ({
      line:    s.line,
      record:  s.record,
      message: `Linha ignorada: ${s.reason}`,
    }))

    // Group rows by vehicleNumber (c[22]) — the physical bus.
    // Falls back to lineCode when vehicleNumber is absent.
    const blockMap = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = row.vehicleNumber || row.lineCode
      if (!blockMap.has(key)) blockMap.set(key, [])
      blockMap.get(key)!.push(row)
    }

    const lineCodes = [...new Set(rows.map(r => r.lineCode))]

    const transitLines = await (this.prisma as any).transitLine.findMany({
      where: { code: { in: lineCodes } },
    })
    const lineByCode = new Map<string, { id: string; code: string; metrics: any }>(
      transitLines.map((l: any) => [l.code, l]),
    )
    for (const code of lineCodes) {
      if (!lineByCode.has(code)) {
        errors.push({ line: 0, record: code, message: `Linha ${code} não encontrada no cadastro` })
      }
    }

    const validLineIds = transitLines.map((l: any) => l.id)

    const routes = await (this.prisma as any).transitRoute.findMany({
      where:  { lineId: { in: validLineIds } },
      select: { id: true, lineId: true, direction: true },
    })
    const routeByKey = new Map<string, { id: string }>(
      routes.map((r: any) => [`${r.lineId}:${r.direction}`, r]),
    )

    let plan: { id: string }
    let blockNumber = 1

    if (planId) {
      // Update mode: clear existing data for the imported lines within this plan,
      // then add new blocks/trips. Lines not in this import are untouched.
      await this.clearLinesFromPlan(planId, validLineIds, dayTypeId)

      for (const line of transitLines) {
        await (this.prisma as any).vehiclePlanLine.upsert({
          where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId: line.id } },
          create: { vehiclePlanId: planId, lineId: line.id },
          update: {},
        })
      }

      // Continue blockNumber after the highest existing block in the plan
      const maxBlock = await (this.prisma as any).vehicleBlock.aggregate({
        where: { vehiclePlanId: planId },
        _max:  { blockNumber: true },
      })
      blockNumber = (maxBlock._max.blockNumber ?? 0) + 1
      plan = { id: planId }
    } else {
      // Create mode: brand-new DRAFT plan — no cleanup needed
      plan = await (this.prisma as any).vehiclePlan.create({
        data: {
          dayTypeId,
          status: 'DRAFT',
          lines: {
            create: transitLines.map((l: any) => ({ lineId: l.id })),
          },
        },
      })
    }

    // Collect all records in memory — no DB calls inside the loop
    const tripRows:      Array<{ id: string; routeId: string; departureMinutes: number; arrivalMinutes: number }> = []
    const tripDayTypes:  Array<{ tripId: string; dayTypeId: string }> = []
    const blockRows:     Array<{ id: string; vehiclePlanId: string; branchId: string; blockNumber: number; depotId: string; vehicleType: string; summary: object }> = []
    const blockTripRows: Array<{ vehicleBlockId: string; tripId: string; sequence: number; isDeadhead: boolean }> = []

    for (const [, tabRows] of blockMap.entries()) {
      // Sort purely chronologically by departure time.
      // tabId and sequence are scoped to a single line and unreliable for cross-line ordering.
      // Trips before 03:00 are end-of-operational-day — shifted +1440 so they sort after later trips.
      tabRows.sort((a, b) => {
        const da = parseHHMM(a.departureHHMM)
        const db = parseHHMM(b.departureHHMM)
        const adjA = da < 180 ? da + 1440 : da  // 180 = 03:00 operational day boundary
        const adjB = db < 180 ? db + 1440 : db
        return adjA - adjB
      })

      const blockId    = randomUUID()
      let   seqInBlock = 1
      let   hasTrips   = false

      let firstDep = Infinity, lastArr = -Infinity
      let productiveMinutes = 0, deadrunMinutes = 0
      let productiveKm = 0,      deadrunKm = 0

      // Synthetic depot-departure deadhead (saída de garagem)
      // c[17] carries the depot departure time on the vehicle's first trip row.
      const depotRow = tabRows.find(r => r.depotDepartureHHMM !== '')
      if (depotRow) {
        let firstRouteId: string | null = null
        for (const row of tabRows) {
          const line  = lineByCode.get(row.lineCode)
          if (!line) continue
          const dir   = row.direction === 'I' ? 'OUTBOUND' : row.direction === 'C' ? 'CIRCULAR' : 'INBOUND'
          const route = routeByKey.get(`${line.id}:${dir}`)
          if (route) { firstRouteId = route.id; break }
        }

        if (firstRouteId) {
          const firstTripDep    = parseHHMM(tabRows[0].departureHHMM)
          const depotDepMinutes = parseHHMM(depotRow.depotDepartureHHMM)
          const startMinutes    = depotDepMinutes - setupMinutes

          if (startMinutes < firstTripDep) {
            const depotTripId = randomUUID()
            if (startMinutes < firstDep) firstDep = startMinutes
            deadrunMinutes += firstTripDep - startMinutes

            tripRows.push({ id: depotTripId, routeId: firstRouteId, departureMinutes: startMinutes, arrivalMinutes: firstTripDep })
            tripDayTypes.push({ tripId: depotTripId, dayTypeId })
            blockTripRows.push({ vehicleBlockId: blockId, tripId: depotTripId, sequence: seqInBlock++, isDeadhead: true })
            hasTrips = true
          }
        }
      }

      let dayOffset          = 0
      let prevArrivalMinutes = -Infinity

      for (const row of tabRows) {
        const line = lineByCode.get(row.lineCode)
        if (!line) continue

        const direction = row.direction === 'I' ? 'OUTBOUND' : row.direction === 'C' ? 'CIRCULAR' : 'INBOUND'
        const route     = routeByKey.get(`${line.id}:${direction}`)

        if (!route) {
          errors.push({
            line:    row._lineNum,
            record:  `${row.lineCode} tab ${row.tabId}`,
            message: `Rota ${direction} não encontrada para linha ${row.lineCode}`,
          })
          continue
        }

        const tripId = randomUUID()
        const rawDep = parseHHMM(row.departureHHMM)
        const rawArr = parseHHMM(row.arrivalHHMM)

        // Sequential day inference: departure wraps before previous arrival → new calendar day
        if (rawDep + dayOffset < prevArrivalMinutes) dayOffset += 1440
        const departureMinutes = rawDep + dayOffset

        // arrDay > depDay signals this specific trip's arrival crosses midnight
        const arrivalDayOffset = row.arrDay > row.depDay ? dayOffset + 1440 : dayOffset
        let arrivalMinutes = rawArr + arrivalDayOffset
        if (arrivalMinutes < departureMinutes) arrivalMinutes += 1440  // safety guard

        prevArrivalMinutes = arrivalMinutes
        const tripMinutes  = arrivalMinutes - departureMinutes
        const km           = (line.metrics?.extensionKm?.[direction] as number | undefined) ?? 0

        if (departureMinutes < firstDep) firstDep = departureMinutes
        if (arrivalMinutes   > lastArr)  lastArr  = arrivalMinutes

        if (row.isProductive) {
          productiveMinutes += tripMinutes
          productiveKm      += km
        } else {
          deadrunMinutes += tripMinutes
          deadrunKm      += km
        }

        tripRows.push({ id: tripId, routeId: route.id, departureMinutes, arrivalMinutes })
        tripDayTypes.push({ tripId, dayTypeId })
        blockTripRows.push({ vehicleBlockId: blockId, tripId, sequence: seqInBlock++, isDeadhead: !row.isProductive })
        hasTrips = true
      }

      if (!hasTrips) continue

      blockRows.push({
        id:            blockId,
        vehiclePlanId: plan.id,
        branchId,
        blockNumber:   blockNumber++,
        depotId,
        vehicleType:   'BUS',
        summary: {
          totalMinutes: lastArr - firstDep,
          productiveMinutes,
          deadrunMinutes,
          totalKm:      productiveKm + deadrunKm,
          productiveKm,
          deadrunKm,
        },
      })
    }

    // 4 bulk inserts instead of O(n_trips) individual creates
    await (this.prisma as any).transitTrip.createMany({
      data: tripRows.map(r => ({ ...r, requiredVehicleType: 'BUS' })),
    })
    await (this.prisma as any).tripDayType.createMany({ data: tripDayTypes })
    await (this.prisma as any).vehicleBlock.createMany({ data: blockRows })
    await (this.prisma as any).blockTrip.createMany({ data: blockTripRows })

    await this.vehiclePlanSvc.scorePlan(plan.id)

    return { created: blockRows.length, trips: tripRows.length, errors }
  }

  // Removes all trips for the given lines from this specific plan.
  // Blocks that served only these lines are deleted; blocks that also serve
  // other lines have their remaining trips preserved and are marked isStale.
  private async clearLinesFromPlan(
    planId:    string,
    lineIds:   string[],
    dayTypeId: string,
  ): Promise<void> {
    // Find BlockTrips in this plan whose trips belong to the imported lines
    const affected = await (this.prisma as any).blockTrip.findMany({
      where: {
        vehicleBlock: { vehiclePlanId: planId },
        trip: {
          route:    { lineId: { in: lineIds } },
          dayTypes: { some: { dayTypeId } },
        },
      },
      select: { id: true, vehicleBlockId: true, tripId: true },
    })

    if (affected.length === 0) return

    const blockTripIds = affected.map((bt: any) => bt.id)
    const tripIds      = [...new Set<string>(affected.map((bt: any) => bt.tripId))]
    const blockIds     = [...new Set<string>(affected.map((bt: any) => bt.vehicleBlockId))]

    // Remove BlockTrips for the imported lines
    await (this.prisma as any).blockTrip.deleteMany({ where: { id: { in: blockTripIds } } })

    // Delete empty blocks; mark blocks with remaining trips as stale
    for (const blockId of blockIds) {
      const remaining = await (this.prisma as any).blockTrip.count({ where: { vehicleBlockId: blockId } })
      if (remaining === 0) {
        await (this.prisma as any).vehicleBlock.delete({ where: { id: blockId } })
      } else {
        await (this.prisma as any).vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
      }
    }

    // Remove TripDayType entries for this dayType
    await (this.prisma as any).tripDayType.deleteMany({
      where: { tripId: { in: tripIds }, dayTypeId },
    })

    // Delete trips that are now fully orphaned (no remaining blockTrip or dayType references)
    await (this.prisma as any).transitTrip.deleteMany({
      where: { id: { in: tripIds }, dayTypes: { none: {} } },
    })
  }
}
