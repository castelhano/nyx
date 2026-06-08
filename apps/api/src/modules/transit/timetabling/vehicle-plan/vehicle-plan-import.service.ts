import { randomUUID } from 'crypto'
import { Injectable, BadRequestException, Logger } from '@nestjs/common'
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

function minutesToHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

@Injectable()
export class VehiclePlanImportService {
  private readonly logger = new Logger(VehiclePlanImportService.name)

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
      select: { id: true, lineId: true, direction: true, originLocalityId: true, destinationLocalityId: true },
    })
    const routeByKey = new Map<string, { id: string; originLocalityId: string; destinationLocalityId: string }>(
      routes.map((r: any) => [`${r.lineId}:${r.direction}`, r]),
    )

    // Load matrix + idealMin only when normalize is requested
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

    for (const [blockKey, tabRows] of blockMap.entries()) {
      // Sort purely chronologically by departure time.
      // tabId and sequence are scoped to a single line and unreliable for cross-line ordering.
      // Trips before 03:00 are end-of-operational-day — shifted +1440 so they sort after later trips.
      tabRows.sort((a, b) => {
        const da   = parseHHMM(a.departureHHMM)
        const db   = parseHHMM(b.departureHHMM)
        const adjA = da < 180 ? da + 1440 : da  // 180 = 03:00 operational day boundary
        const adjB = db < 180 ? db + 1440 : db
        return adjA - adjB
      })

      const blockId = randomUUID()

      type BlockTripEntry = {
        tripId:           string
        routeId:          string
        departureMinutes: number
        arrivalMinutes:   number
        isDeadhead:       boolean
        km:               number
        lineCode:         string
        direction:        string
      }
      const perBlockTrips: BlockTripEntry[] = []

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
            perBlockTrips.push({
              tripId:           randomUUID(),
              routeId:          firstRouteId,
              departureMinutes: startMinutes,
              arrivalMinutes:   firstTripDep,
              isDeadhead:       true,
              km:               0,
              lineCode:         'depot',
              direction:        '-',
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

        // Sequential day inference: departure wraps before previous arrival → new calendar day
        if (rawDep + dayOffset < prevArrivalMinutes) dayOffset += 1440
        const departureMinutes = rawDep + dayOffset

        // arrDay > depDay signals this specific trip's arrival crosses midnight
        const arrivalDayOffset = row.arrDay > row.depDay ? dayOffset + 1440 : dayOffset
        let arrivalMinutes = rawArr + arrivalDayOffset
        if (arrivalMinutes < departureMinutes) arrivalMinutes += 1440  // safety guard

        prevArrivalMinutes = arrivalMinutes

        perBlockTrips.push({
          tripId:           randomUUID(),
          routeId:          route.id,
          departureMinutes,
          arrivalMinutes,
          isDeadhead:       !row.isProductive,
          km:               (line.metrics?.extensionKm?.[direction] as number | undefined) ?? 0,
          lineCode:         row.lineCode,
          direction,
        })
      }

      if (perBlockTrips.length === 0) continue

      if (normalize) {
        const tag = `[NORMALIZE] block=${blockKey}`

        // 1. Interval: shorten productive trips where gap to next trip < idealIntervalMin
        for (let i = 0; i < perBlockTrips.length - 1; i++) {
          const curr = perBlockTrips[i]
          const next = perBlockTrips[i + 1]
          if (!curr.isDeadhead) {
            const gap = next.departureMinutes - curr.arrivalMinutes
            if (gap < idealIntervalMin) {
              const newArr = next.departureMinutes - idealIntervalMin
              if (newArr > curr.departureMinutes) curr.arrivalMinutes = newArr
            }
          }
        }

        // 2. Access deadrun: block doesn't start with a deadrun and matrix has depot→firstOrigin
        if (!perBlockTrips[0].isDeadhead && firstRouteKey) {
          const firstRoute = routeByKey.get(firstRouteKey)
          if (firstRoute) {
            const edge = matrixMap[`${depotId}:${firstRoute.originLocalityId}`]
            if (edge && edge.minutes > 0) {
              const first = perBlockTrips[0]
              this.logger.log(
                `${tag} | access deadrun | depot(${depotId}) → ${firstRoute.originLocalityId} | ` +
                `${minutesToHHMM(first.departureMinutes - edge.minutes)}-${minutesToHHMM(first.departureMinutes)} | ` +
                `${edge.minutes}min ${edge.km}km`,
              )
              perBlockTrips.unshift({
                tripId:           randomUUID(),
                routeId:          first.routeId,
                departureMinutes: first.departureMinutes - edge.minutes,
                arrivalMinutes:   first.departureMinutes,
                isDeadhead:       true,
                km:               edge.km,
                lineCode:         'access',
                direction:        '-',
              })
            }
          }
        }

        // 3. Return deadrun: block doesn't end with a deadrun and matrix has lastDest→depot
        if (!perBlockTrips[perBlockTrips.length - 1].isDeadhead && lastRouteKey) {
          const lastRoute = routeByKey.get(lastRouteKey)
          if (lastRoute) {
            const edge = matrixMap[`${lastRoute.destinationLocalityId}:${depotId}`]
            if (edge && edge.minutes > 0) {
              const last = perBlockTrips[perBlockTrips.length - 1]
              this.logger.log(
                `${tag} | return deadrun | ${lastRoute.destinationLocalityId} → depot(${depotId}) | ` +
                `${minutesToHHMM(last.arrivalMinutes)}-${minutesToHHMM(last.arrivalMinutes + edge.minutes)} | ` +
                `${edge.minutes}min ${edge.km}km`,
              )
              perBlockTrips.push({
                tripId:           randomUUID(),
                routeId:          last.routeId,
                departureMinutes: last.arrivalMinutes,
                arrivalMinutes:   last.arrivalMinutes + edge.minutes,
                isDeadhead:       true,
                km:               edge.km,
                lineCode:         'return',
                direction:        '-',
              })
            }
          }
        }
      }

      // Compute block summary from perBlockTrips
      let firstDep = Infinity, lastArr = -Infinity
      let productiveMinutes = 0, deadrunMinutes = 0
      let productiveKm = 0,      deadrunKm = 0

      for (const t of perBlockTrips) {
        if (t.departureMinutes < firstDep) firstDep = t.departureMinutes
        if (t.arrivalMinutes   > lastArr)  lastArr  = t.arrivalMinutes
        const mins = t.arrivalMinutes - t.departureMinutes
        if (t.isDeadhead) {
          deadrunMinutes += mins
          deadrunKm      += t.km
        } else {
          productiveMinutes += mins
          productiveKm      += t.km
        }
      }

      blockRows.push({
        id:            blockId,
        vehiclePlanId: plan.id,
        branchId,
        blockNumber:   blockNumber++,
        depotId,
        vehicleType:   'STANDARD',
        summary: {
          totalMinutes: lastArr - firstDep,
          productiveMinutes,
          deadrunMinutes,
          totalKm:      productiveKm + deadrunKm,
          productiveKm,
          deadrunKm,
        },
      })

      let seqInBlock = 1
      for (const t of perBlockTrips) {
        tripRows.push({ id: t.tripId, routeId: t.routeId, departureMinutes: t.departureMinutes, arrivalMinutes: t.arrivalMinutes })
        tripDayTypes.push({ tripId: t.tripId, dayTypeId })
        blockTripRows.push({ vehicleBlockId: blockId, tripId: t.tripId, sequence: seqInBlock++, isDeadhead: t.isDeadhead })
      }
    }

    // 4 bulk inserts instead of O(n_trips) individual creates
    await (this.prisma as any).transitTrip.createMany({
      data: tripRows,
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
