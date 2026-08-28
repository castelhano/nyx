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
    scopeId:      string,
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
      input:       { filename: file.originalname, branchId, scopeId, dayTypeId, depotId, setupMinutes, normalize, planId },
    })

    this.jobService.run(job.id, () => this.execute(file.buffer, branchId, scopeId, dayTypeId, depotId, setupMinutes, normalize, planId))

    return { jobId: job.id }
  }

  private async execute(
    buffer:       Buffer,
    branchId:     string,
    scopeId:      string,
    dayTypeId:    string,
    depotId:      string,
    setupMinutes: number = 0,
    normalize:    boolean = false,
    planId?:      string,
  ): Promise<ImportOutput> {
    if (planId) {
      const existing = await (this.prisma as any).vehiclePlan.findUnique({
        where:  { id: planId },
        select: { scopeId: true, dayTypeId: true },
      })
      if (!existing) throw new Error('Planejamento não encontrado')
      scopeId   = existing.scopeId
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

    const inScopeLines: any[] = []
    for (const line of transitLines as any[]) {
      if (line.scopeId !== scopeId) {
        errors.push({ line: 0, record: line.code, message: `Linha ${line.code} não pertence ao escopo deste planejamento` })
        continue
      }
      inScopeLines.push(line)
    }
    for (const code of lineCodes) {
      if (!transitLines.some((l: any) => l.code === code)) {
        errors.push({ line: 0, record: code, message: `Linha ${code} não encontrada no cadastro` })
      }
    }

    const approvalRefByLineCode = new Map<string, string>()
    for (const row of rows) {
      if (row.blockCode && !approvalRefByLineCode.has(row.lineCode)) {
        approvalRefByLineCode.set(row.lineCode, row.blockCode)
      }
    }

    // Some ERPs omit the OSO code for a variant line whose trips are recorded under the
    // parent line's own OSO (e.g. "308B" rows with a blank blockCode, alongside "308"
    // rows carrying "308U08") — inherit it via the cadastro relationship instead of
    // failing the line. Falls back to the parent's currently APPROVED schedule when the
    // parent itself isn't present in this file (e.g. a re-sync scoped to the variant only).
    const transitLineById = new Map<string, any>((transitLines as any[]).map(l => [l.id, l]))
    for (const line of transitLines as any[]) {
      if (approvalRefByLineCode.has(line.code) || !line.parentLineId) continue

      const parent = transitLineById.get(line.parentLineId)
      const parentApprovalRef = parent ? approvalRefByLineCode.get(parent.code) : undefined
      if (parentApprovalRef) {
        approvalRefByLineCode.set(line.code, parentApprovalRef)
        continue
      }

      const parentSchedule = await (this.prisma as any).lineSchedule.findFirst({
        where:  { lineId: line.parentLineId, dayTypeId, status: 'APPROVED' },
        select: { approvalRef: true },
      })
      if (parentSchedule) approvalRefByLineCode.set(line.code, parentSchedule.approvalRef)
    }

    // Importing establishes a new, already-operating version of each touched line's
    // schedule — auto-approved (supersedes the previous APPROVED one, if any) rather
    // than left as DRAFT, since a re-sync represents the schedule as currently in force.
    // Reimporting a schedule whose approvalRef already exists for this line+dayType
    // reuses that record as-is (idempotent) instead of creating a duplicate/superseding.
    const lineScheduleByLineId = new Map<string, { id: string; reused: boolean }>()
    const resolvedLines: any[] = []
    for (const line of inScopeLines) {
      const approvalRef = approvalRefByLineCode.get(line.code)
      if (!approvalRef) {
        errors.push({ line: 0, record: line.code, message: `Linha ${line.code} sem referência de OSO no arquivo` })
        continue
      }
      lineScheduleByLineId.set(line.id, await this.resolveApprovedLineSchedule(line.id, dayTypeId, approvalRef))
      resolvedLines.push(line)
    }

    const lineByCode = new Map<string, { id: string; code: string; metrics: any }>(
      resolvedLines.map((l: any) => [l.code, l]),
    )

    const validLineIds = resolvedLines.map((l: any) => l.id)

    const routes = await (this.prisma as any).transitRoute.findMany({
      where:  { lineId: { in: validLineIds } },
      select: { id: true, lineId: true, direction: true, originLocalityId: true, destinationLocalityId: true },
    })
    const routeByKey = new Map<string, { id: string; originLocalityId: string; destinationLocalityId: string }>(
      routes.map((r: any) => [`${r.lineId}:${r.direction}`, r]),
    )

    const reusedScheduleIds = [...lineScheduleByLineId.values()].filter(s => s.reused).map(s => s.id)
    const existingDeparturesByKey = new Map<string, string>()
    if (reusedScheduleIds.length > 0) {
      const existingDepartures = await (this.prisma as any).lineDeparture.findMany({
        where:  { lineScheduleId: { in: reusedScheduleIds } },
        select: { id: true, lineScheduleId: true, routeId: true, departureMinutes: true },
      })
      for (const d of existingDepartures as any[]) {
        existingDeparturesByKey.set(`${d.lineScheduleId}:${d.routeId}:${d.departureMinutes}`, d.id)
      }
    }

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
      await this.vehiclePlanSvc.clearLinesFromPlan(planId, validLineIds, dayTypeId)

      for (const line of resolvedLines) {
        const lineScheduleId = lineScheduleByLineId.get(line.id)!.id
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
          scopeId,
          dayTypeId,
          status: 'DRAFT',
          lines: {
            create: resolvedLines.map((l: any) => ({ lineId: l.id, lineScheduleId: lineScheduleByLineId.get(l.id)!.id })),
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
          const scheduleInfo = lineScheduleByLineId.get(line.id)!
          let lineDepartureId: string

          if (scheduleInfo.reused) {
            const key       = `${scheduleInfo.id}:${route.id}:${departureMinutes}`
            const existing  = existingDeparturesByKey.get(key)
            if (!existing) {
              errors.push({
                line:    row._lineNum,
                record:  `${row.lineCode} tab ${row.tabId}`,
                message: `Partida não encontrada na OSO já cadastrada para ${row.lineCode} — arquivo diverge do quadro aprovado`,
              })
              continue
            }
            lineDepartureId = existing
          } else {
            lineDepartureId = randomUUID()
            lineDepartureRows.push({
              id:               lineDepartureId,
              lineScheduleId:   scheduleInfo.id,
              routeId:          route.id,
              departureMinutes,
            })
          }

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

    await this.vehiclePlanSvc.recalculate(plan.id)

    return { created: blockRows.length, trips: tripRows.length, errors }
  }

  private async resolveApprovedLineSchedule(
    lineId: string, dayTypeId: string, approvalRef: string,
  ): Promise<{ id: string; reused: boolean }> {
    const db = this.prisma as any

    const existing = await db.lineSchedule.findUnique({
      where:  { lineId_dayTypeId_approvalRef: { lineId, dayTypeId, approvalRef } },
      select: { id: true },
    })
    if (existing) return { id: existing.id, reused: true }

    const previous = await db.lineSchedule.findFirst({
      where:  { lineId, dayTypeId, status: 'APPROVED' },
      select: { id: true },
    })
    const now     = new Date()
    const created = await db.lineSchedule.create({
      data: {
        lineId, dayTypeId, approvalRef,
        status:     'APPROVED',
        validFrom:  now,
        approvedAt: now,
      },
    })

    if (previous) {
      await db.lineSchedule.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED', validTo: now } })
    }

    return { id: created.id, reused: false }
  }

}
