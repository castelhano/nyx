import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { Worker } from 'worker_threads'
import path from 'path'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitGeneralConfigService }  from '../../settings/transit-general-config.service'
import { TransitPlanningConfigService } from '../../settings/transit-planning-config.service'
import { BaseService } from '../../../../core/base.service'
import { vehiclePlanSchema, VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto } from '@nyx/schemas'
import type { SolverConfig, SolverMessage, SolverResult, SolverParams, SolverPlanningConfig } from './solver/solver.types'
import type { VehiclePlanSummary } from '@nyx/schemas'
import type { VehicleBlockSummary } from '@nyx/schemas'

interface Job {
  worker:    Worker | null
  best:      SolverResult | null
  planId:    string
  messages$: Subject<SolverMessage>
}

@Injectable()
export class VehiclePlanService extends BaseService<VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto> {
  private readonly logger = new Logger(VehiclePlanService.name)
  private readonly jobs = new Map<string, Job>()

  constructor(
    prisma: PrismaService,
    private readonly generalConfig:  TransitGeneralConfigService,
    private readonly planningConfig: TransitPlanningConfigService,
  ) {
    super(prisma, 'vehiclePlan', vehiclePlanSchema, 'transit')
  }

  async generate(
    planId:        string,
    jobId:         string,
    rawParams:     SolverParams | undefined,
    userBranchIds: string[],
    userRole:      string,
  ): Promise<void> {
    const params: SolverParams = rawParams ?? {
      mode:                       'expanded',
      redistributeTrips:          true,
      allowSharedOperation:       false,
      includeAccessAndCollection: true,
      direction:                  'automatic',
    }
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:   { id: planId },
      include: { lines: { select: { lineId: true } } },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if ((plan.constraints as any)?.locked) throw new BadRequestException('Plan is locked')
    if (plan.status === 'ACTIVE') throw new BadRequestException('Active plan cannot be regenerated')

    const lineIds = plan.lines.map(l => l.lineId)
    if (lineIds.length === 0) throw new BadRequestException('Plan has no lines defined')

    const [trips, matrix, depotLocalities, generalCfg, globalPlanningCfg, existingBlocks] = await Promise.all([
      this.prisma.transitTrip.findMany({
        where:   { dayTypeId: plan.dayTypeId, route: { lineId: { in: lineIds } } },
        include: { route: { select: { originLocalityId: true, destinationLocalityId: true, lineId: true, direction: true, line: { select: { metrics: true } } } } },
      }),
      this.prisma.travelTimeMatrix.findMany(),
      this.prisma.transitLocality.findMany({ where: { isDepot: true }, select: { id: true } }),
      this.generalConfig.get(),
      this.planningConfig.get(),
      this.prisma.vehicleBlock.findMany({
        where:   { vehiclePlanId: planId },
        orderBy: { blockNumber: 'asc' },
        include: { blockTrips: { orderBy: { sequence: 'asc' }, select: { tripId: true } } },
      }),
    ])

    if (trips.length === 0) throw new BadRequestException('No trips found for this plan')

    const matrixMap: Record<string, { minutes: number; km: number }> = {}
    for (const m of matrix) {
      matrixMap[`${m.originId}:${m.destinationId}`] = { minutes: m.baseMinutes * m.speedRatio, km: m.distanceKm }
    }

    const tripSet = new Set(trips.map(t => t.id))
    const isAdmin = userRole === 'ADMIN'

    const initialBlocks = existingBlocks
      .filter(b => isAdmin || !b.branchId || userBranchIds.includes(b.branchId))
      .map(b => ({
        depotId:     b.depotId,
        vehicleType: b.vehicleType as string,
        tripIds:     b.blockTrips.map(bt => bt.tripId).filter(id => tripSet.has(id)),
        locked:      !!(b.constraints as any)?.locked,
      }))
      .filter(b => b.tripIds.length > 0)

    // plan-level metrics override the global planning config
    const planMetrics  = plan.metrics as Partial<SolverPlanningConfig> | null
    const resolvedCfg  = planMetrics
      ? { ...globalPlanningCfg, ...planMetrics }
      : globalPlanningCfg

    // apply direction weight adjustments
    const adjustedCfg  = this.applyDirectionWeights(resolvedCfg as SolverPlanningConfig, params.direction)

    const planSummary = plan.summary as VehiclePlanSummary | null

    const solverConfig: SolverConfig = {
      planId,
      initialBlocks,
      currentPlanScore:      planSummary?.score,
      currentPlanFleetCount: planSummary?.fleetCount,
      config: {
        operationalDayStartHour:  generalCfg.operationalDayStartHour,
        demandModifier:           generalCfg.demandModifier,
        stopNoImprovementMinutes: adjustedCfg.stopNoImprovementMinutes,
        stopMaxTotalMinutes:      adjustedCfg.stopMaxTotalMinutes,
        flat:                     adjustedCfg.flat,
        range:                    adjustedCfg.range,
      },
      trips: trips.map(t => {
        const metrics = t.route.line.metrics as { extensionKm?: Record<string, number> } | null
        const tripKm  = metrics?.extensionKm?.[t.route.direction]
          ?? matrixMap[`${t.route.originLocalityId}:${t.route.destinationLocalityId}`]?.km
          ?? 0
        return {
          id:                    t.id,
          lineId:                t.route.lineId,
          originLocalityId:      t.route.originLocalityId,
          destinationLocalityId: t.route.destinationLocalityId,
          departureMinutes:      t.departureMinutes,
          arrivalMinutes:        t.arrivalMinutes,
          tripKm,
          requiredVehicleType:   t.requiredVehicleType ?? null,
          constraints:           t.constraints as any ?? null,
        }
      }),
      matrix: matrixMap,
      depots: depotLocalities.map(d => d.id),
    }

    const messages$ = new Subject<SolverMessage>()
    const job: Job  = { worker: null, best: null, planId, messages$ }
    this.jobs.set(jobId, job)

    // when redistributeTrips is false, skip construction — score current plan only
    if (!params.redistributeTrips) {
      setImmediate(async () => {
        try {
          await this.scorePlan(planId)
          const plan = await this.prisma.vehiclePlan.findUnique({ where: { id: planId } })
          if (!plan?.summary) { messages$.complete(); return }

          const summary = plan.summary as VehiclePlanSummary
          const syntheticResult: SolverResult = {
            blocks:            [],
            score:             summary.score,
            fleetCount:        summary.fleetCount,
            deadrunKm:         summary.deadrunKm,
            productiveKm:      summary.productiveKm,
            totalKm:           summary.totalKm,
            deadrunMinutes:    summary.deadrunMinutes,
            productiveMinutes: summary.productiveMinutes,
            totalMinutes:      summary.totalMinutes,
          }
          job.best = syntheticResult
          messages$.next({ type: 'proposal', stage: 0, stageLabel: 'Plano atual', scenario: syntheticResult, proposalIndex: 1 })
          messages$.next({ type: 'done', stopReason: 'max_time', totalAttempts: 0 })
          messages$.complete()
          setTimeout(() => this.jobs.delete(jobId), 30 * 60 * 1000)
        } catch (err) {
          messages$.error(err)
          this.jobs.delete(jobId)
        }
      })
      return
    }

    const isTs       = __filename.endsWith('.ts')
    const workerName = params.mode === 'quick' ? 'solver.deterministic.worker' : 'solver.stochastic.worker'
    const workerFile = path.join(__dirname, 'solver', `${workerName}${isTs ? '.ts' : '.js'}`)
    const execArgv   = isTs ? ['-r', '@swc-node/register', '-r', 'tsconfig-paths/register'] : []

    const worker = new Worker(workerFile, { workerData: solverConfig, execArgv })
    job.worker   = worker

    worker.on('message', (msg: SolverMessage) => {
      if (msg.type === 'proposal' || msg.type === 'improvement') job.best = msg.scenario
      messages$.next(msg)
      if (msg.type === 'done') {
        messages$.complete()
        setTimeout(() => this.jobs.delete(jobId), 30 * 60 * 1000)
      }
    })

    worker.on('error', err => {
      this.logger.error(`Solver worker error for job ${jobId}`, err)
      messages$.error(err)
      this.jobs.delete(jobId)
    })
  }

  private applyDirectionWeights(config: SolverPlanningConfig, direction: SolverParams['direction']): SolverPlanningConfig {
    if (direction === 'automatic') return config
    const result = JSON.parse(JSON.stringify(config)) as SolverPlanningConfig
    if (direction === 'optimize_fleet') {
      result.flat.fleetUsage.active = true
      result.flat.fleetUsage.weight = Math.round(result.flat.fleetUsage.weight * 2)
    } else if (direction === 'optimize_drivers') {
      result.flat.driverUsage.active = true
      result.flat.driverUsage.weight = Math.round(result.flat.driverUsage.weight * 2)
    }
    return result
  }

  streamProgress(jobId: string): Observable<{ data: string }> {
    const job = this.jobs.get(jobId)
    if (!job) return new Observable(s => s.complete())

    return new Observable(subscriber => {
      const sub = job.messages$.subscribe({
        next:     msg => subscriber.next({ data: JSON.stringify(msg) }),
        error:    err => subscriber.error(err),
        complete: () => subscriber.complete(),
      })
      return () => sub.unsubscribe()
    })
  }

  async assumeBest(planId: string, jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job?.best) throw new NotFoundException('No result available yet')

    try { job.worker?.postMessage({ type: 'stop' }) } catch { /* already terminated */ }
    this.jobs.delete(jobId)

    const best = job.best

    // build a lineId lookup from planId scope to detect cross-line blocks after the solve
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:   { id: planId },
      include: { lines: { select: { lineId: true } } },
    })
    const scopeLineIds = new Set(plan?.lines.map(l => l.lineId) ?? [])

    // build tripId → lineId map from the solver result trips
    const tripLineMap = new Map<string, string>()
    if (best.blocks.length > 0) {
      const tripIds    = best.blocks.flatMap(b => b.trips.map(t => t.tripId))
      const tripRoutes = await this.prisma.transitTrip.findMany({
        where:   { id: { in: tripIds } },
        select:  { id: true, route: { select: { lineId: true } } },
      })
      for (const t of tripRoutes) tripLineMap.set(t.id, t.route.lineId)
    }

    await this.prisma.$transaction(async tx => {
      // delete all non-locked blocks for this plan
      const existingBlocks = await tx.vehicleBlock.findMany({
        where:  { vehiclePlanId: planId },
        select: { id: true, constraints: true },
      })
      const nonLockedIds = existingBlocks
        .filter(b => !(b.constraints as any)?.locked)
        .map(b => b.id)

      if (nonLockedIds.length > 0) {
        await tx.blockTrip.deleteMany({ where: { vehicleBlockId: { in: nonLockedIds } } })
        await tx.vehicleBlock.deleteMany({ where: { id: { in: nonLockedIds } } })
      }

      for (const block of best.blocks) {
        const blockSummary: VehicleBlockSummary = {
          totalMinutes:      block.totalMinutes,
          productiveMinutes: block.productiveMinutes,
          deadrunMinutes:    block.deadrunMinutes,
          totalKm:           block.totalKm,
          productiveKm:      block.productiveKm,
          deadrunKm:         block.deadrunKm,
        }

        // a block is stale when it contains trips from lines outside the solver scope
        const hasCrossLineTrip = block.trips.some(bt => {
          const lineId = tripLineMap.get(bt.tripId)
          return lineId && !scopeLineIds.has(lineId)
        })

        const created = await tx.vehicleBlock.create({
          data: {
            vehiclePlanId: planId,
            blockNumber:   block.blockNumber,
            depotId:       block.depotId,
            vehicleType:   block.vehicleType as any,
            summary:       blockSummary,
            isStale:       hasCrossLineTrip,
          },
        })

        await tx.blockTrip.createMany({
          data: block.trips.map(bt => ({
            vehicleBlockId: created.id,
            tripId:         bt.tripId,
            sequence:       bt.sequence,
          })),
        })
      }

      const r2 = (n: number) => Math.round(n * 100) / 100
      const planSummary: VehiclePlanSummary = {
        fleetCount:        best.fleetCount,
        score:             best.score,
        deadrunKm:         r2(best.deadrunKm),
        productiveKm:      r2(best.productiveKm),
        totalKm:           r2(best.totalKm),
        deadrunMinutes:    best.deadrunMinutes,
        productiveMinutes: best.productiveMinutes,
        totalMinutes:      best.totalMinutes,
      }

      await tx.vehiclePlan.update({
        where: { id: planId },
        data: {
          summary:     planSummary,
          generatedAt: new Date(),
        },
      })
    })
  }

  async scorePlan(planId: string): Promise<void> {
    const [plan, blocks, matrix] = await Promise.all([
      this.prisma.vehiclePlan.findUnique({ where: { id: planId }, select: { summary: true } }),
      this.prisma.vehicleBlock.findMany({
        where:   { vehiclePlanId: planId },
        include: {
          blockTrips: {
            orderBy: { sequence: 'asc' },
            include: {
              trip: {
                select: {
                  departureMinutes: true,
                  arrivalMinutes:   true,
                  route: {
                    select: {
                      originLocalityId:      true,
                      destinationLocalityId: true,
                      direction:             true,
                      line: { select: { metrics: true } },
                    },
                  },
                },
              },
            },
          },
          blockDeadruns: {
            select: {
              originLocalityId:      true,
              destinationLocalityId: true,
              departureMinutes:      true,
              arrivalMinutes:        true,
            },
          },
          blockIntervals: {
            select: { departureMinutes: true, arrivalMinutes: true },
          },
        },
      }),
      this.prisma.travelTimeMatrix.findMany(),
    ])

    if (!plan || blocks.length === 0) return

    const matrixKm: Record<string, number> = {}
    for (const m of matrix) {
      matrixKm[`${m.originId}:${m.destinationId}`] = m.distanceKm
    }

    const blocksWithTrips = blocks.filter(b => b.blockTrips.length > 0)
    const staleWithTrips  = blocksWithTrips.filter(b => b.isStale)
    const emptyStale      = blocks.filter(b => b.isStale && b.blockTrips.length === 0)

    if (staleWithTrips.length === 0 && emptyStale.length === 0) return

    const r2 = (n: number) => Math.round(n * 100) / 100

    const freshSummaries = staleWithTrips.map(block => {
      let productiveMinutes = 0
      let productiveKm      = 0
      let deadrunMinutes    = 0
      let deadrunKm         = 0

      for (const bt of block.blockTrips) {
        const route   = bt.trip.route
        const metrics = route.line.metrics as { extensionKm?: Record<string, number> } | null
        const tripKm  = metrics?.extensionKm?.[route.direction]
          ?? matrixKm[`${route.originLocalityId}:${route.destinationLocalityId}`]
          ?? 0
        productiveMinutes += bt.trip.arrivalMinutes - bt.trip.departureMinutes
        productiveKm      += tripKm
      }

      for (const dr of block.blockDeadruns) {
        deadrunMinutes += dr.arrivalMinutes - dr.departureMinutes
        deadrunKm      += matrixKm[`${dr.originLocalityId}:${dr.destinationLocalityId}`] ?? 0
      }

      const allDepartures = [
        ...block.blockTrips.map(bt => bt.trip.departureMinutes),
        ...block.blockDeadruns.map(dr => dr.departureMinutes),
        ...block.blockIntervals.map(bi => bi.departureMinutes),
      ]
      const allArrivals = [
        ...block.blockTrips.map(bt => bt.trip.arrivalMinutes),
        ...block.blockDeadruns.map(dr => dr.arrivalMinutes),
        ...block.blockIntervals.map(bi => bi.arrivalMinutes),
      ]
      const totalMinutes = Math.max(...allArrivals) - Math.min(...allDepartures)

      const summary: VehicleBlockSummary = {
        totalMinutes,
        productiveMinutes,
        deadrunMinutes,
        totalKm:      r2(productiveKm + deadrunKm),
        productiveKm: r2(productiveKm),
        deadrunKm:    r2(deadrunKm),
      }
      return { block, summary }
    })

    // Aggregate plan totals: fresh stale + stored non-stale
    let totalDeadrunKm         = 0
    let totalDeadrunMinutes    = 0
    let totalProductiveKm      = 0
    let totalProductiveMinutes = 0
    let totalKm                = 0
    let totalMinutes           = 0

    for (const { summary } of freshSummaries) {
      totalDeadrunKm         += summary.deadrunKm
      totalDeadrunMinutes    += summary.deadrunMinutes
      totalProductiveKm      += summary.productiveKm
      totalProductiveMinutes += summary.productiveMinutes
      totalKm                += summary.totalKm
      totalMinutes           += summary.totalMinutes
    }

    for (const block of blocksWithTrips) {
      if (block.isStale) continue
      const s = block.summary as VehicleBlockSummary | null
      if (!s) continue
      totalDeadrunKm         += s.deadrunKm         ?? 0
      totalDeadrunMinutes    += s.deadrunMinutes     ?? 0
      totalProductiveKm      += s.productiveKm      ?? 0
      totalProductiveMinutes += s.productiveMinutes  ?? 0
      totalKm                += s.totalKm            ?? 0
      totalMinutes           += s.totalMinutes       ?? 0
    }

    const existingScore = (plan.summary as VehiclePlanSummary | null)?.score ?? 0

    const planSummary: VehiclePlanSummary = {
      fleetCount:        blocksWithTrips.length,
      score:             existingScore,
      deadrunKm:         r2(totalDeadrunKm),
      productiveKm:      r2(totalProductiveKm),
      totalKm:           r2(totalKm),
      deadrunMinutes:    totalDeadrunMinutes,
      productiveMinutes: totalProductiveMinutes,
      totalMinutes:      totalMinutes,
    }

    await Promise.all([
      this.prisma.vehiclePlan.update({
        where: { id: planId },
        data:  { summary: planSummary, generatedAt: new Date() },
      }),
      ...freshSummaries.map(({ block, summary }) =>
        this.prisma.vehicleBlock.update({
          where: { id: block.id },
          data:  { summary, isStale: false },
        })
      ),
      ...emptyStale.map(block =>
        this.prisma.vehicleBlock.update({
          where: { id: block.id },
          data:  { isStale: false },
        })
      ),
    ])
  }

  async duplicate(planId: string): Promise<VehiclePlan> {
    const plan = await (this.prisma as any).vehiclePlan.findUnique({
      where:   { id: planId },
      include: {
        lines:  { select: { lineId: true, lineScheduleId: true } },
        blocks: {
          include: {
            blockTrips: {
              select: {
                sequence: true,
                trip: {
                  select: {
                    id: true, routeId: true, dayTypeId: true, lineDepartureId: true,
                    departureMinutes: true, arrivalMinutes: true,
                    requiredVehicleType: true, constraints: true, notes: true,
                  },
                },
              },
            },
            blockDeadruns:  { select: { type: true, originLocalityId: true, destinationLocalityId: true, departureMinutes: true, arrivalMinutes: true } },
            blockIntervals: { select: { intervalTypeId: true, departureMinutes: true, arrivalMinutes: true } },
          },
        },
      },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')

    return this.prisma.$transaction(async tx => {
      const newPlan = await tx.vehiclePlan.create({
        data: {
          scopeId:     plan.scopeId,
          dayTypeId:   plan.dayTypeId,
          description: plan.description ?? undefined,
          status:      'DRAFT',
          metrics:     plan.metrics     ?? undefined,
          summary:     plan.summary     ?? undefined,
          generatedAt: plan.generatedAt ?? undefined,
          constraints: plan.constraints ?? undefined,
        },
      })

      if (plan.lines.length > 0) {
        await tx.vehiclePlanLine.createMany({
          data: plan.lines.map((l: any) => ({ vehiclePlanId: newPlan.id, lineId: l.lineId, lineScheduleId: l.lineScheduleId ?? undefined })),
        })
      }

      // Build a map of original tripId → new tripId to deduplicate trips that
      // appear in more than one block (e.g. after manual reassignments).
      const tripIdMap = new Map<string, string>()

      for (const block of plan.blocks) {
        const newBlock = await tx.vehicleBlock.create({
          data: {
            vehiclePlanId: newPlan.id,
            blockNumber:   block.blockNumber,
            depotId:       block.depotId,
            vehicleType:   block.vehicleType,
            summary:       block.summary ?? undefined,
          },
        })

        if (block.blockTrips.length > 0) {
          const newBlockTrips: { vehicleBlockId: string; tripId: string; sequence: number }[] = []

          for (const bt of block.blockTrips as any[]) {
            const origId = bt.trip.id
            if (!tripIdMap.has(origId)) {
              const newTrip = await tx.transitTrip.create({
                data: {
                  routeId:             bt.trip.routeId,
                  dayTypeId:           bt.trip.dayTypeId,
                  lineDepartureId:     bt.trip.lineDepartureId ?? undefined,
                  departureMinutes:    bt.trip.departureMinutes,
                  arrivalMinutes:      bt.trip.arrivalMinutes,
                  requiredVehicleType: bt.trip.requiredVehicleType ?? undefined,
                  constraints:         bt.trip.constraints ?? undefined,
                  notes:               bt.trip.notes ?? undefined,
                },
              })
              tripIdMap.set(origId, newTrip.id)
            }
            newBlockTrips.push({ vehicleBlockId: newBlock.id, tripId: tripIdMap.get(origId)!, sequence: bt.sequence })
          }

          await tx.blockTrip.createMany({ data: newBlockTrips })
        }

        if (block.blockDeadruns.length > 0) {
          await (tx as any).blockDeadrun.createMany({
            data: block.blockDeadruns.map((d: any) => ({
              vehicleBlockId:        newBlock.id,
              type:                  d.type,
              originLocalityId:      d.originLocalityId,
              destinationLocalityId: d.destinationLocalityId,
              departureMinutes:      d.departureMinutes,
              arrivalMinutes:        d.arrivalMinutes,
            })),
          })
        }

        if (block.blockIntervals.length > 0) {
          await (tx as any).blockInterval.createMany({
            data: block.blockIntervals.map((bi: any) => ({
              vehicleBlockId:   newBlock.id,
              intervalTypeId:   bi.intervalTypeId,
              departureMinutes: bi.departureMinutes,
              arrivalMinutes:   bi.arrivalMinutes,
            })),
          })
        }
      }

      return newPlan as unknown as VehiclePlan
    })
  }

  async remove(id: string): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({ where: { id } })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be deleted')

    const blockTrips = await this.prisma.blockTrip.findMany({
      where:  { vehicleBlock: { vehiclePlanId: id } },
      select: { tripId: true },
    })
    const tripIds = [...new Set(blockTrips.map(bt => bt.tripId))]

    await this.prisma.$transaction(async tx => {
      await tx.blockTrip.deleteMany({ where: { vehicleBlock: { vehiclePlanId: id } } })
      await tx.vehicleBlock.deleteMany({ where: { vehiclePlanId: id } })
      await tx.vehiclePlanLine.deleteMany({ where: { vehiclePlanId: id } })
      await tx.vehiclePlan.delete({ where: { id } })

      if (tripIds.length) {
        const still      = await tx.blockTrip.findMany({ where: { tripId: { in: tripIds } }, select: { tripId: true } })
        const referenced = new Set(still.map(bt => bt.tripId))
        const toDelete   = tripIds.filter(tid => !referenced.has(tid))
        if (toDelete.length) {
          await tx.transitTrip.deleteMany({ where: { id: { in: toDelete } } })
        }
      }
    })
  }

  async stop(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.worker?.postMessage({ type: 'stop' })
  }

  async addTrip(planId: string, dto: {
    routeId:                string
    departureMinutes:       number
    arrivalMinutes:         number
    blockId?:               string
    accessDepotLocalityId?: string
    returnDepotLocalityId?: string
  }): Promise<{ blockId: string }> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, dayTypeId: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    const db = this.prisma as any

    const result = await db.$transaction(async (tx: any) => {
      const route = await tx.transitRoute.findUnique({
        where:  { id: dto.routeId },
        select: { lineId: true, originLocalityId: true, destinationLocalityId: true },
      })
      if (!route) throw new NotFoundException('Route not found')

      // Marca a linha como presente no plano mesmo sem quadro de horários pinado —
      // uma viagem avulsa ("Adicionar viagem") não tem LineSchedule por trás, mas
      // a linha passa a existir no plano (indicador laranja no LinesPanel).
      await tx.vehiclePlanLine.upsert({
        where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId: route.lineId } },
        create: { vehiclePlanId: planId, lineId: route.lineId },
        update: {},
      })

      const trip = await tx.transitTrip.create({
        data: {
          dayTypeId:        plan.dayTypeId,
          routeId:          dto.routeId,
          departureMinutes: dto.departureMinutes,
          arrivalMinutes:   dto.arrivalMinutes,
        },
      })

      let resolvedBlockId: string

      if (dto.blockId) {
        const block = await tx.vehicleBlock.findFirst({
          where:   { id: dto.blockId, vehiclePlanId: planId },
          include: { blockTrips: { select: { sequence: true }, orderBy: { sequence: 'desc' }, take: 1 } },
        })
        if (!block) throw new NotFoundException('VehicleBlock not found in this plan')
        const nextSeq = (block.blockTrips[0]?.sequence ?? -1) + 1
        await tx.blockTrip.create({ data: { vehicleBlockId: block.id, tripId: trip.id, sequence: nextSeq } })
        await tx.vehicleBlock.update({ where: { id: block.id }, data: { isStale: true } })
        resolvedBlockId = block.id
      } else {
        const lastBlock = await tx.vehicleBlock.findFirst({
          where:   { vehiclePlanId: planId },
          orderBy: { blockNumber: 'desc' },
          select:  { blockNumber: true, depotId: true },
        })

        let depotId: string
        if (lastBlock?.depotId) {
          depotId = lastBlock.depotId
        } else {
          const depot = await tx.transitLocality.findFirst({ where: { isDepot: true }, select: { id: true } })
          if (!depot) throw new BadRequestException('No depot locality configured')
          depotId = depot.id
        }

        const newBlock = await tx.vehicleBlock.create({
          data: {
            vehiclePlanId: planId,
            blockNumber:   (lastBlock?.blockNumber ?? 0) + 1,
            depotId,
            vehicleType:   'STANDARD',
          },
        })
        await tx.blockTrip.create({ data: { vehicleBlockId: newBlock.id, tripId: trip.id, sequence: 0 } })
        resolvedBlockId = newBlock.id
      }

      if (dto.accessDepotLocalityId || dto.returnDepotLocalityId) {
        if (dto.accessDepotLocalityId) {
          const tt = await tx.travelTimeMatrix.findUnique({
            where: { originId_destinationId: { originId: dto.accessDepotLocalityId, destinationId: route.originLocalityId } },
          })
          if (!tt) throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')
          const minutes = Math.round(tt.baseMinutes * tt.speedRatio)
          await tx.blockDeadrun.create({
            data: {
              vehicleBlockId:        resolvedBlockId,
              type:                  'ACCESS',
              originLocalityId:      dto.accessDepotLocalityId,
              destinationLocalityId: route.originLocalityId,
              departureMinutes:      dto.departureMinutes - minutes - 1,
              arrivalMinutes:        dto.departureMinutes - 1,
            },
          })
        }

        if (dto.returnDepotLocalityId) {
          const tt = await tx.travelTimeMatrix.findUnique({
            where: { originId_destinationId: { originId: route.destinationLocalityId, destinationId: dto.returnDepotLocalityId } },
          })
          if (!tt) throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')
          const minutes = Math.round(tt.baseMinutes * tt.speedRatio)
          await tx.blockDeadrun.create({
            data: {
              vehicleBlockId:        resolvedBlockId,
              type:                  'RETURN',
              originLocalityId:      route.destinationLocalityId,
              destinationLocalityId: dto.returnDepotLocalityId,
              departureMinutes:      dto.arrivalMinutes + 1,
              arrivalMinutes:        dto.arrivalMinutes + minutes + 1,
            },
          })
        }

        await tx.vehicleBlock.update({ where: { id: resolvedBlockId }, data: { isStale: true } })
      }

      return { blockId: resolvedBlockId }
    })

    await this.scorePlan(planId)
    return result
  }

  async addDeadrun(planId: string, dto: {
    originLocalityId:      string
    destinationLocalityId: string
    departureMinutes:      number
    arrivalMinutes:        number
    blockId?:             string
  }): Promise<{ blockId: string }> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    const db = this.prisma as any

    const result = await db.$transaction(async (tx: any) => {
      let blockId = dto.blockId

      if (blockId) {
        const block = await tx.vehicleBlock.findFirst({
          where: { id: blockId, vehiclePlanId: planId },
        })
        if (!block) throw new NotFoundException('VehicleBlock not found in this plan')
      } else {
        const lastBlock = await tx.vehicleBlock.findFirst({
          where:   { vehiclePlanId: planId },
          orderBy: { blockNumber: 'desc' },
          select:  { blockNumber: true, depotId: true },
        })

        let depotId: string
        if (lastBlock?.depotId) {
          depotId = lastBlock.depotId
        } else {
          const depot = await tx.transitLocality.findFirst({ where: { isDepot: true }, select: { id: true } })
          if (!depot) throw new BadRequestException('No depot locality configured')
          depotId = depot.id
        }

        const newBlock = await tx.vehicleBlock.create({
          data: {
            vehiclePlanId: planId,
            blockNumber:   (lastBlock?.blockNumber ?? 0) + 1,
            depotId,
            vehicleType:   'STANDARD',
          },
        })
        blockId = newBlock.id
      }

      await tx.blockDeadrun.create({
        data: {
          vehicleBlockId:        blockId,
          type:                  'DISPLACEMENT',
          originLocalityId:      dto.originLocalityId,
          destinationLocalityId: dto.destinationLocalityId,
          departureMinutes:      dto.departureMinutes,
          arrivalMinutes:        dto.arrivalMinutes,
        },
      })

      await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })

      return { blockId }
    })

    await this.scorePlan(planId)
    return result
  }

  async addInterval(planId: string, dto: {
    intervalTypeId:   string
    departureMinutes: number
    arrivalMinutes:   number
    blockId?:        string
  }): Promise<{ blockId: string }> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    const db = this.prisma as any

    const result = await db.$transaction(async (tx: any) => {
      let blockId = dto.blockId

      if (blockId) {
        const block = await tx.vehicleBlock.findFirst({
          where: { id: blockId, vehiclePlanId: planId },
        })
        if (!block) throw new NotFoundException('VehicleBlock not found in this plan')
      } else {
        const lastBlock = await tx.vehicleBlock.findFirst({
          where:   { vehiclePlanId: planId },
          orderBy: { blockNumber: 'desc' },
          select:  { blockNumber: true, depotId: true },
        })

        let depotId: string
        if (lastBlock?.depotId) {
          depotId = lastBlock.depotId
        } else {
          const depot = await tx.transitLocality.findFirst({ where: { isDepot: true }, select: { id: true } })
          if (!depot) throw new BadRequestException('No depot locality configured')
          depotId = depot.id
        }

        const newBlock = await tx.vehicleBlock.create({
          data: {
            vehiclePlanId: planId,
            blockNumber:   (lastBlock?.blockNumber ?? 0) + 1,
            depotId,
            vehicleType:   'STANDARD',
          },
        })
        blockId = newBlock.id
      }

      await tx.blockInterval.create({
        data: {
          vehicleBlockId:   blockId,
          intervalTypeId:   dto.intervalTypeId,
          departureMinutes: dto.departureMinutes,
          arrivalMinutes:   dto.arrivalMinutes,
        },
      })

      await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })

      return { blockId }
    })

    await this.scorePlan(planId)
    return result
  }

  // "Limpa" uma linha do plano: remove os blocos/viagens materializados (dayType-scoped)
  // e o registro de VehiclePlanLine, se existir. A linha continua disponível pra
  // materializar de novo mais tarde — pertencer ao plano depende só do Scope agora.
  async clearLine(planId: string, lineId: string): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, dayTypeId: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    await this.clearLinesFromPlan(planId, [lineId], plan.dayTypeId)
    await this.prisma.vehiclePlanLine.deleteMany({ where: { vehiclePlanId: planId, lineId } })
  }

  // Removes this plan's blocks/trips for the given lines (dayType-scoped) — used
  // by re-import (wholesale replacement is the correct semantics there). Delegates
  // the actual safe-removal to removeTripsFromPlan.
  async clearLinesFromPlan(
    planId:    string,
    lineIds:   string[],
    dayTypeId: string,
  ): Promise<void> {
    const trips = await (this.prisma as any).transitTrip.findMany({
      where: {
        dayTypeId,
        route:      { lineId: { in: lineIds } },
        blockTrips: { some: { vehicleBlock: { vehiclePlanId: planId } } },
      },
      select: { id: true },
    })
    await this.removeTripsFromPlan(planId, trips.map((t: any) => t.id))
  }

  // Removes specific trips from this plan's blocks. TransitTrip rows are a pool
  // potentially shared across plans, so a trip is only deleted once no block
  // anywhere references it anymore; otherwise it's left in place for whoever else
  // still uses it. A block left empty is deleted (cascades blockDeadruns); a block
  // that still has other trips is just flagged stale.
  // Accepts an optional transaction client so callers that need this to participate
  // in a larger atomic operation (e.g. switchLineSchedule) can pass their `tx`.
  private async removeTripsFromPlan(planId: string, tripIds: string[], db: any = this.prisma): Promise<void> {
    if (tripIds.length === 0) return

    const affected = await db.blockTrip.findMany({
      where:  { tripId: { in: tripIds }, vehicleBlock: { vehiclePlanId: planId } },
      select: { id: true, vehicleBlockId: true },
    })
    if (affected.length === 0) return

    const blockTripIds = affected.map((bt: any) => bt.id)
    const blockIds      = [...new Set<string>(affected.map((bt: any) => bt.vehicleBlockId))]

    await db.blockTrip.deleteMany({ where: { id: { in: blockTripIds } } })

    for (const blockId of blockIds) {
      const remaining = await db.blockTrip.count({ where: { vehicleBlockId: blockId } })
      if (remaining === 0) {
        await db.vehicleBlock.delete({ where: { id: blockId } })
      } else {
        await db.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
      }
    }

    await db.transitTrip.deleteMany({
      where: { id: { in: tripIds }, blockTrips: { none: {} } },
    })
  }

  // Cycle time (minutes) for a departure from TransitLine.metrics.windows — same
  // resolution logic as the frontend's resolveCycleWindow (vehicles.view.ts), kept
  // in sync manually since one runs in the browser and the other server-side.
  private resolveCycleMinutes(
    metrics:          Record<string, any> | null | undefined,
    direction:        string,
    departureMinutes: number,
  ): number | null {
    const windows = metrics?.windows?.[direction] ?? metrics?.windows?.['OUTBOUND'] ?? []
    const slot     = (Math.floor(departureMinutes / 30) / 2) % 24
    const window   = (windows as any[]).find(w => slot >= w.from && slot <= w.to)
    return window?.minutes ?? null
  }

  // Cria uma OSO (LineSchedule DRAFT) nova a partir do modal de troca de quadro,
  // já semeada com as partidas (LineDeparture) das viagens que a linha já tem
  // *neste plano* — inclusive avulsas ("Adicionar viagem"), sem lineDepartureId.
  // Sem isso, aplicar essa OSO recém-criada via switchLineSchedule zeraria a
  // operação da linha (LineDeparture vazia → clearLinesFromPlan sem nada pra recriar).
  async createLineSchedule(
    planId: string,
    lineId: string,
    dto: { approvalRef: string; notes?: string },
  ): Promise<{ id: string }> {
    if (!dto.approvalRef?.trim()) throw new BadRequestException('OSO obrigatória')

    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, scopeId: true, dayTypeId: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    const line = await this.prisma.transitLine.findUnique({ where: { id: lineId }, select: { scopeId: true } })
    if (!line || line.scopeId !== plan.scopeId) throw new BadRequestException('Linha não pertence ao escopo deste planejamento')

    const existingTrips = await (this.prisma as any).transitTrip.findMany({
      where: {
        dayTypeId:  plan.dayTypeId,
        route:      { lineId },
        blockTrips: { some: { vehicleBlock: { vehiclePlanId: planId } } },
      },
      select: { routeId: true, departureMinutes: true, requiredVehicleType: true },
    })

    const departureByKey = new Map<string, { routeId: string; departureMinutes: number; requiredVehicleType: string | null }>()
    for (const t of existingTrips as any[]) {
      const key = `${t.routeId}:${t.departureMinutes}`
      if (!departureByKey.has(key)) departureByKey.set(key, t)
    }

    return this.prisma.$transaction(async (tx) => {
      const schedule = await (tx as any).lineSchedule.create({
        data: {
          lineId, dayTypeId: plan.dayTypeId,
          approvalRef: dto.approvalRef.trim(),
          notes:       dto.notes,
          status:      'DRAFT',
        },
      })

      if (departureByKey.size > 0) {
        await (tx as any).lineDeparture.createMany({
          data: [...departureByKey.values()].map(d => ({
            lineScheduleId:      schedule.id,
            routeId:             d.routeId,
            departureMinutes:    d.departureMinutes,
            requiredVehicleType: d.requiredVehicleType ?? undefined,
          })),
        })
      }

      return { id: schedule.id }
    })
  }

  // Swaps which LineSchedule version backs a line within this plan. For each target
  // departure, reuses the existing TransitTrip when one already matches exactly
  // (same routeId + departureMinutes) — just relinks lineDepartureId, keeping its
  // arrivalMinutes/requiredVehicleType/block placement untouched, no recomputation.
  // Only genuinely new departures (no matching trip yet) get materialized from
  // scratch — duration from TransitLine.metrics.windows first, travel-time matrix
  // as fallback. Trips that no longer correspond to any departure in the target
  // schedule are removed. Newly-created trips are left unassigned to any block —
  // the plan must be regenerated ("Gerar") afterward to (re)block them.
  async switchLineSchedule(planId: string, lineId: string, lineScheduleId: string): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, scopeId: true, dayTypeId: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    const line = await this.prisma.transitLine.findUnique({ where: { id: lineId }, select: { scopeId: true, metrics: true } })
    if (!line || line.scopeId !== plan.scopeId) throw new BadRequestException('Linha não pertence ao escopo deste planejamento')

    const schedule = await (this.prisma as any).lineSchedule.findUnique({
      where:   { id: lineScheduleId },
      include: { departures: { include: { route: { select: { direction: true, originLocalityId: true, destinationLocalityId: true } } } } },
    })
    if (!schedule) throw new NotFoundException('LineSchedule not found')
    if (schedule.lineId !== lineId) throw new BadRequestException('LineSchedule does not belong to this line')
    if (schedule.dayTypeId !== plan.dayTypeId) throw new BadRequestException('LineSchedule dayType does not match this plan')

    const existingTrips = await (this.prisma as any).transitTrip.findMany({
      where: {
        dayTypeId:  plan.dayTypeId,
        route:      { lineId },
        blockTrips: { some: { vehicleBlock: { vehiclePlanId: planId } } },
      },
      select: { id: true, routeId: true, departureMinutes: true },
    })
    const existingByKey = new Map<string, string>(existingTrips.map((t: any) => [`${t.routeId}:${t.departureMinutes}`, t.id]))

    const reuseUpdates: Array<{ tripId: string; lineDepartureId: string }> = []
    const toCreate: any[] = []
    const matchedTripIds  = new Set<string>()

    for (const d of schedule.departures as any[]) {
      const existingTripId = existingByKey.get(`${d.routeId}:${d.departureMinutes}`)
      if (existingTripId) {
        reuseUpdates.push({ tripId: existingTripId, lineDepartureId: d.id })
        matchedTripIds.add(existingTripId)
      } else {
        toCreate.push(d)
      }
    }

    const unmatchedTripIds = existingTrips
      .map((t: any) => t.id as string)
      .filter((id: string) => !matchedTripIds.has(id))

    let tripRows: Array<{ routeId: string; dayTypeId: string; lineDepartureId: string; departureMinutes: number; arrivalMinutes: number; requiredVehicleType?: string }> = []
    if (toCreate.length > 0) {
      const matrix    = await this.prisma.travelTimeMatrix.findMany()
      const matrixMap = new Map(matrix.map(m => [`${m.originId}:${m.destinationId}`, m.baseMinutes * m.speedRatio]))

      const missingRoutes = new Set<string>()
      tripRows = toCreate.map(d => {
        const cycleMinutes  = this.resolveCycleMinutes(line.metrics as any, d.route.direction, d.departureMinutes)
        const matrixMinutes = matrixMap.get(`${d.route.originLocalityId}:${d.route.destinationLocalityId}`)
        const minutes       = cycleMinutes ?? matrixMinutes
        if (minutes === undefined) missingRoutes.add(d.routeId)
        return {
          routeId:             d.routeId,
          dayTypeId:           plan.dayTypeId,
          lineDepartureId:     d.id,
          departureMinutes:    d.departureMinutes,
          arrivalMinutes:      d.departureMinutes + Math.round(minutes ?? 0),
          requiredVehicleType: d.requiredVehicleType ?? undefined,
        }
      })

      if (missingRoutes.size > 0) {
        throw new BadRequestException(
          `Faltam dados de ciclo/tempo de viagem para ${missingRoutes.size} trecho(s) desta linha — configure as métricas da linha ou a matriz de tempos antes de trocar de versão`,
        )
      }
    }

    // Tudo daqui pra baixo é uma unidade só: remover as viagens que sobraram, religar
    // as reaproveitadas, materializar as novas e fixar o VehiclePlanLine — ou tudo,
    // ou nada, sem estado parcial se cair no meio.
    await this.prisma.$transaction(async (tx) => {
      await this.removeTripsFromPlan(planId, unmatchedTripIds, tx)

      for (const u of reuseUpdates) {
        await (tx as any).transitTrip.update({ where: { id: u.tripId }, data: { lineDepartureId: u.lineDepartureId } })
      }

      if (tripRows.length > 0) {
        await (tx as any).transitTrip.createMany({ data: tripRows })
      }

      await (tx as any).vehiclePlanLine.upsert({
        where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
        create: { vehiclePlanId: planId, lineId, lineScheduleId, isDrifted: false },
        update: { lineScheduleId, isDrifted: false },
      })
    })
  }

  async getGanttData(planId: string) {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:   { id: planId },
      include: {
        dayType: { select: { id: true, name: true, code: true } },
        scope: {
          include: {
            lines: { orderBy: { code: 'asc' }, select: { id: true, name: true, code: true, metrics: true } },
          },
        },
        lines: {
          include: {
            lineSchedule: { select: { id: true, status: true, approvalRef: true } },
          },
        },
      },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')

    // Universo de linhas vem do Scope; VehiclePlanLine só existe pras já materializadas
    // neste plano (lineScheduleId/isDrifted) — mesmo shape que o frontend já consome.
    const materializedByLineId = new Map(plan.lines.map(l => [l.lineId, l]))
    const lines = plan.scope.lines.map(line => {
      const materialized = materializedByLineId.get(line.id)
      return {
        lineId:         line.id,
        line,
        inPlan:         materialized != null,
        lineScheduleId: materialized?.lineScheduleId ?? null,
        lineSchedule:   materialized?.lineSchedule ?? null,
        isDrifted:      materialized?.isDrifted ?? false,
      }
    })
    const planWithLines = { ...plan, lines }

    const blocks = await (this.prisma as any).vehicleBlock.findMany({
      where:   { vehiclePlanId: planId },
      orderBy: { blockNumber: 'asc' },
      include: {
        branch: { select: { id: true, name: true } },
        depot:  { select: { id: true, name: true } },
        blockTrips: {
          orderBy: { sequence: 'asc' },
          include: {
            trip: {
              include: {
                route: {
                  include: {
                    line:                { select: { id: true, name: true, code: true, metrics: true } },
                    originLocality:      { select: { id: true, name: true } },
                    destinationLocality: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
        blockDeadruns: {
          orderBy: { departureMinutes: 'asc' },
          include: {
            originLocality:      { select: { id: true, name: true } },
            destinationLocality: { select: { id: true, name: true } },
          },
        },
        blockIntervals: {
          orderBy: { departureMinutes: 'asc' },
          include: {
            intervalType: true,
          },
        },
      },
    })

    return { plan: planWithLines, blocks }
  }

  async activate(planId: string, force = false): Promise<{ conflict: { id: string; description: string | null } } | null> {
    const plan = await this.prisma.vehiclePlan.findUnique({ where: { id: planId } })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status === 'ACTIVE') throw new BadRequestException('Plan is already active')

    const conflict = await this.prisma.vehiclePlan.findFirst({
      where:  { id: { not: planId }, scopeId: plan.scopeId, dayTypeId: plan.dayTypeId, status: 'ACTIVE' },
      select: { id: true, description: true },
    })

    if (conflict && !force) {
      return { conflict: { id: conflict.id, description: conflict.description } }
    }

    await this.prisma.$transaction(async (tx) => {
      if (conflict) {
        await tx.vehiclePlan.update({ where: { id: conflict.id }, data: { status: 'DRAFT' } })
      }
      await tx.vehiclePlan.update({ where: { id: planId }, data: { status: 'ACTIVE' } })
    })

    return null
  }
}
