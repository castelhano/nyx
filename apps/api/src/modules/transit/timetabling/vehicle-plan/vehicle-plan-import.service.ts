import { randomUUID } from 'crypto'
import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'
import { JobService } from '../../../core/job/job.service'
import { VehiclePlanService } from './vehicle-plan.service'
import { TransitPlanningConfigService } from '../../settings/transit-planning-config.service'
import { parseVehiclePlanFile, parseHHMM } from './vehicle-plan-import.parser'

interface ImportOutput {
  created: number  // VehicleBlock records created
  trips:   number  // TransitTrip records created
  errors:  Array<{ line: number; record: string; message: string }>
}

type ProductiveEntry = {
  kind:             'trip'
  id:               string
  routeId:          string
  lineDepartureId:  string
  departureMinutes: number
  arrivalMinutes:   number
  km:               number
}

type DeadrunEntry = {
  kind:                  'deadrun'
  id:                    string
  type:                  'ACCESS' | 'RETURN' | 'DISPLACEMENT'
  originLocalityId:      string
  destinationLocalityId: string
  departureMinutes:      number
  arrivalMinutes:        number
  km:                    number
}

type BlockEntry = ProductiveEntry | DeadrunEntry

@Injectable()
export class VehiclePlanImportService {
  constructor(
    private readonly prisma:          PrismaService,
    private readonly jobService:      JobService,
    private readonly vehiclePlanSvc:  VehiclePlanService,
    private readonly planningConfig:  TransitPlanningConfigService,
  ) {}

  async import(
    file:         Express.Multer.File,
    branchId:     string,
    dayTypeId:    string,
    depotId:      string,
    userId:       string,
    setupMinutes: number = 0,
    normalize:    boolean = false,
    planId?:      string,
  ): Promise<{ jobId: string }> {
    if (!file.buffer?.length) throw new BadRequestException('Arquivo vazio')

    const job = await this.jobService.createJob({
      type:        'vehicle-plan-import',
      domain:      'transit',
      resource:    'vehicle-plan',
      createdById: userId,
      input:       { filename: file.originalname, branchId, dayTypeId, depotId, setupMinutes, normalize, planId },
    })

    this.jobService.run(job.id, () => this.execute(file.buffer, branchId, dayTypeId, depotId, setupMinutes, normalize, planId))

    return { jobId: job.id }
  }

  private async execute(
    buffer:       Buffer,
    branchId:     string,
    dayTypeId:    string,
    depotId:      string,
    setupMinutes: number = 0,
    normalize:    boolean = false,
    planId?:      string,
  ): Promise<ImportOutput> {
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

    // Importing establishes a new, already-operating version of each touched line's
    // schedule — auto-approved (supersedes the previous APPROVED one, if any) rather
    // than left as DRAFT, since a re-sync represents the schedule as currently in force.
    const lineScheduleByLineId = new Map<string, string>()
    for (const line of transitLines as any[]) {
      lineScheduleByLineId.set(line.id, await this.resolveApprovedLineSchedule(line.id, dayTypeId))
    }

    const validLineIds = transitLines.map((l: any) => l.id)

    const routes = await (this.prisma as any).transitRoute.findMany({
      where:  { lineId: { in: validLineIds } },
      select: { id: true, lineId: true, direction: true, originLocalityId: true, destinationLocalityId: true },
    })
    const routeByKey = new Map<string, { id: string; originLocalityId: string; destinationLocalityId: string }>(
      routes.map((r: any) => [`${r.lineId}:${r.direction}`, r]),
    )

    let matrixMap: Record<string, { minutes: number; km: number }> = {}
    let idealIntervalMin = 5

    if (normalize) {
      const [matrix, planningCfg] = await Promise.all([
        (this.prisma as any).travelTimeMatrix.findMany(),
        this.planningConfig.get(),
      ])
      for (const m of matrix) {
        matrixMap[`${m.originId}:${m.destinationId}`] = { minutes: m.baseMinutes * m.speedRatio, km: m.distanceKm }
      }
      idealIntervalMin = planningCfg.range.tripInterval.idealMin
    }

    let plan: { id: string }
    let blockNumber = 1

    if (planId) {
      await this.clearLinesFromPlan(planId, validLineIds, dayTypeId)

      for (const line of transitLines as any[]) {
        const lineScheduleId = lineScheduleByLineId.get(line.id)
        await (this.prisma as any).vehiclePlanLine.upsert({
          where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId: line.id } },
          create: { vehiclePlanId: planId, lineId: line.id, lineScheduleId },
          update: { lineScheduleId },
        })
      }

      const maxBlock = await (this.prisma as any).vehicleBlock.aggregate({
        where: { vehiclePlanId: planId },
        _max:  { blockNumber: true },
      })
      blockNumber = (maxBlock._max.blockNumber ?? 0) + 1
      plan = { id: planId }
    } else {
      plan = await (this.prisma as any).vehiclePlan.create({
        data: {
          dayTypeId,
          status: 'DRAFT',
          lines: {
            create: transitLines.map((l: any) => ({ lineId: l.id, lineScheduleId: lineScheduleByLineId.get(l.id) })),
          },
        },
      })
    }

    const tripRows:          Array<{ id: string; routeId: string; dayTypeId: string; lineDepartureId: string; departureMinutes: number; arrivalMinutes: number }> = []
    const lineDepartureRows: Array<{ id: string; lineScheduleId: string; routeId: string; departureMinutes: number }> = []
    const deadrunRows:       Array<{ id: string; vehicleBlockId: string; type: string; originLocalityId: string; destinationLocalityId: string; departureMinutes: number; arrivalMinutes: number }> = []
    const blockRows:         Array<{ id: string; vehiclePlanId: string; branchId: string; blockNumber: number; depotId: string; vehicleType: string; summary?: object; isStale: boolean }> = []
    const blockTripRows:     Array<{ vehicleBlockId: string; tripId: string; sequence: number }> = []

    for (const [, tabRows] of blockMap.entries()) {
      tabRows.sort((a, b) => {
        const da   = parseHHMM(a.departureHHMM)
        const db   = parseHHMM(b.departureHHMM)
        const adjA = da < 180 ? da + 1440 : da
        const adjB = db < 180 ? db + 1440 : db
        return adjA - adjB
      })

      const blockId = randomUUID()
      const perBlockEntries: BlockEntry[] = []

      // Synthetic depot-departure deadhead (saída de garagem)
      const depotRow = tabRows.find(r => r.depotDepartureHHMM !== '')
      if (depotRow) {
        let firstRoute: { id: string; originLocalityId: string } | null = null
        for (const row of tabRows) {
          const line = lineByCode.get(row.lineCode)
          if (!line) continue
          const dir   = row.direction === 'I' ? 'OUTBOUND' : row.direction === 'C' ? 'CIRCULAR' : 'INBOUND'
          const route = routeByKey.get(`${line.id}:${dir}`)
          if (route) { firstRoute = route; break }
        }

        if (firstRoute) {
          const firstTripDep    = parseHHMM(tabRows[0].departureHHMM)
          const depotDepMinutes = parseHHMM(depotRow.depotDepartureHHMM)
          const startMinutes    = depotDepMinutes - setupMinutes

          if (startMinutes < firstTripDep) {
            perBlockEntries.push({
              kind:                  'deadrun',
              id:                    randomUUID(),
              type:                  'ACCESS',
              originLocalityId:      depotId,
              destinationLocalityId: firstRoute.originLocalityId,
              departureMinutes:      startMinutes,
              arrivalMinutes:        firstTripDep,
              km:                    0,
            })
          }
        }
      }

      let dayOffset          = 0
      let prevArrivalMinutes = -Infinity
      let firstRouteKey: string | null = null
      let lastRouteKey:  string | null = null

      for (const row of tabRows) {
        const line = lineByCode.get(row.lineCode)
        if (!line) continue

        const direction = row.direction === 'I' ? 'OUTBOUND' : row.direction === 'C' ? 'CIRCULAR' : 'INBOUND'
        const routeKey  = `${line.id}:${direction}`
        const route     = routeByKey.get(routeKey)

        if (!route) {
          errors.push({
            line:    row._lineNum,
            record:  `${row.lineCode} tab ${row.tabId}`,
            message: `Rota ${direction} não encontrada para linha ${row.lineCode}`,
          })
          continue
        }

        if (!firstRouteKey) firstRouteKey = routeKey
        lastRouteKey = routeKey

        const rawDep = parseHHMM(row.departureHHMM)
        const rawArr = parseHHMM(row.arrivalHHMM)

        if (rawDep + dayOffset < prevArrivalMinutes) dayOffset += 1440
        const departureMinutes = rawDep + dayOffset

        const arrivalDayOffset = row.arrDay > row.depDay ? dayOffset + 1440 : dayOffset
        let arrivalMinutes = rawArr + arrivalDayOffset
        if (arrivalMinutes < departureMinutes) arrivalMinutes += 1440

        prevArrivalMinutes = arrivalMinutes

        const km = (line.metrics?.extensionKm?.[direction] as number | undefined) ?? 0

        if (row.isProductive) {
          const lineDepartureId = randomUUID()
          lineDepartureRows.push({
            id:               lineDepartureId,
            lineScheduleId:   lineScheduleByLineId.get(line.id)!,
            routeId:          route.id,
            departureMinutes,
          })
          perBlockEntries.push({
            kind:             'trip',
            id:               randomUUID(),
            routeId:          route.id,
            lineDepartureId,
            departureMinutes,
            arrivalMinutes,
            km,
          })
        } else {
          perBlockEntries.push({
            kind:                  'deadrun',
            id:                    randomUUID(),
            type:                  'DISPLACEMENT',
            originLocalityId:      route.originLocalityId,
            destinationLocalityId: route.destinationLocalityId,
            departureMinutes,
            arrivalMinutes,
            km,
          })
        }
      }

      if (perBlockEntries.length === 0) continue

      // Reclassify deadruns by position relative to productive trips:
      // before first trip → ACCESS, after last trip → RETURN
      {
        const firstTripIdx = perBlockEntries.findIndex(e => e.kind === 'trip')
        const lastTripIdx  = perBlockEntries.reduce((last, e, i) => e.kind === 'trip' ? i : last, -1)
        for (let i = 0; i < perBlockEntries.length; i++) {
          const e = perBlockEntries[i]
          if (e.kind !== 'deadrun' || e.type !== 'DISPLACEMENT') continue
          if (firstTripIdx >= 0 && i < firstTripIdx) e.type = 'ACCESS'
          else if (lastTripIdx >= 0 && i > lastTripIdx) e.type = 'RETURN'
        }
      }

      if (normalize) {
        // 1. Interval: shorten productive trips where gap to next trip < idealIntervalMin
        for (let i = 0; i < perBlockEntries.length - 1; i++) {
          const curr = perBlockEntries[i]
          const next = perBlockEntries[i + 1]
          if (curr.kind === 'trip') {
            const gap = next.departureMinutes - curr.arrivalMinutes
            if (gap < idealIntervalMin) {
              const newArr = next.departureMinutes - idealIntervalMin
              if (newArr > curr.departureMinutes) curr.arrivalMinutes = newArr
            }
          }
        }

        // 2. Access deadrun: block doesn't start with a deadrun and matrix has depot→firstOrigin
        if (perBlockEntries[0].kind === 'trip' && firstRouteKey) {
          const firstRoute = routeByKey.get(firstRouteKey)
          if (firstRoute) {
            const edge = matrixMap[`${depotId}:${firstRoute.originLocalityId}`]
            if (edge && edge.minutes > 0) {
              const first = perBlockEntries[0]
              perBlockEntries.unshift({
                kind:                  'deadrun',
                id:                    randomUUID(),
                type:                  'ACCESS',
                originLocalityId:      depotId,
                destinationLocalityId: firstRoute.originLocalityId,
                departureMinutes:      first.departureMinutes - edge.minutes,
                arrivalMinutes:        first.departureMinutes,
                km:                    edge.km,
              })
            }
          }
        }

        // 3. Return deadrun: block doesn't end with a deadrun and matrix has lastDest→depot
        if (perBlockEntries[perBlockEntries.length - 1].kind === 'trip' && lastRouteKey) {
          const lastRoute = routeByKey.get(lastRouteKey)
          if (lastRoute) {
            const edge = matrixMap[`${lastRoute.destinationLocalityId}:${depotId}`]
            if (edge && edge.minutes > 0) {
              const last = perBlockEntries[perBlockEntries.length - 1]
              perBlockEntries.push({
                kind:                  'deadrun',
                id:                    randomUUID(),
                type:                  'RETURN',
                originLocalityId:      lastRoute.destinationLocalityId,
                destinationLocalityId: depotId,
                departureMinutes:      last.arrivalMinutes,
                arrivalMinutes:        last.arrivalMinutes + edge.minutes,
                km:                    edge.km,
              })
            }
          }
        }
      }

      let firstDep = Infinity, lastArr = -Infinity
      let productiveMinutes = 0, deadrunMinutes = 0
      let productiveKm = 0,      deadrunKm = 0

      for (const e of perBlockEntries) {
        if (e.departureMinutes < firstDep) firstDep = e.departureMinutes
        if (e.arrivalMinutes   > lastArr)  lastArr  = e.arrivalMinutes
        const mins = e.arrivalMinutes - e.departureMinutes
        if (e.kind === 'deadrun') {
          deadrunMinutes += mins
          deadrunKm      += e.km
        } else {
          productiveMinutes += mins
          productiveKm      += e.km
        }
      }

      blockRows.push({
        id:            blockId,
        vehiclePlanId: plan.id,
        branchId,
        blockNumber:   blockNumber++,
        depotId,
        vehicleType:   'STANDARD',
        isStale:       true,
      })

      let seqInBlock = 1
      for (const e of perBlockEntries) {
        if (e.kind === 'trip') {
          tripRows.push({ id: e.id, routeId: e.routeId, dayTypeId, lineDepartureId: e.lineDepartureId, departureMinutes: e.departureMinutes, arrivalMinutes: e.arrivalMinutes })
          blockTripRows.push({ vehicleBlockId: blockId, tripId: e.id, sequence: seqInBlock++ })
        } else {
          deadrunRows.push({ id: e.id, vehicleBlockId: blockId, type: e.type, originLocalityId: e.originLocalityId, destinationLocalityId: e.destinationLocalityId, departureMinutes: e.departureMinutes, arrivalMinutes: e.arrivalMinutes })
        }
      }
    }

    await (this.prisma as any).lineDeparture.createMany({ data: lineDepartureRows })
    await (this.prisma as any).transitTrip.createMany({ data: tripRows })
    await (this.prisma as any).vehicleBlock.createMany({ data: blockRows })
    await (this.prisma as any).blockTrip.createMany({ data: blockTripRows })
    await (this.prisma as any).blockDeadrun.createMany({ data: deadrunRows })

    await this.vehiclePlanSvc.scorePlan(plan.id)

    return { created: blockRows.length, trips: tripRows.length, errors }
  }

  private async resolveApprovedLineSchedule(lineId: string, dayTypeId: string): Promise<string> {
    const db = this.prisma as any

    const previous = await db.lineSchedule.findFirst({
      where:  { lineId, dayTypeId, status: 'APPROVED' },
      select: { id: true },
    })
    const last = await db.lineSchedule.aggregate({
      where: { lineId, dayTypeId },
      _max:  { version: true },
    })
    const now     = new Date()
    const created = await db.lineSchedule.create({
      data: {
        lineId, dayTypeId,
        version:    (last._max.version ?? 0) + 1,
        status:     'APPROVED',
        validFrom:  now,
        approvedAt: now,
      },
    })

    if (previous) {
      await db.lineSchedule.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED', validTo: now } })
    }

    return created.id
  }

  private async clearLinesFromPlan(
    planId:    string,
    lineIds:   string[],
    dayTypeId: string,
  ): Promise<void> {
    const affected = await (this.prisma as any).blockTrip.findMany({
      where: {
        vehicleBlock: { vehiclePlanId: planId },
        trip: {
          route:    { lineId: { in: lineIds } },
          dayTypeId,
        },
      },
      select: { id: true, vehicleBlockId: true, tripId: true },
    })

    if (affected.length === 0) return

    const blockTripIds = affected.map((bt: any) => bt.id)
    const tripIds      = [...new Set<string>(affected.map((bt: any) => bt.tripId))]
    const blockIds     = [...new Set<string>(affected.map((bt: any) => bt.vehicleBlockId))]

    await (this.prisma as any).blockTrip.deleteMany({ where: { id: { in: blockTripIds } } })

    for (const blockId of blockIds) {
      const remaining = await (this.prisma as any).blockTrip.count({ where: { vehicleBlockId: blockId } })
      if (remaining === 0) {
        // cascade deletes blockDeadruns too
        await (this.prisma as any).vehicleBlock.delete({ where: { id: blockId } })
      } else {
        await (this.prisma as any).vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
      }
    }

    await (this.prisma as any).transitTrip.deleteMany({
      where: { id: { in: tripIds }, blockTrips: { none: {} } },
    })
  }
}
