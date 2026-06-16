import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { Worker } from 'worker_threads'
import path from 'path'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitGeneralConfigService }  from '../../settings/transit-general-config.service'
import { TransitPlanningConfigService } from '../../settings/transit-planning-config.service'
import { BaseService } from '../../../../core/base.service'
import { vehiclePlanSchema, VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto } from '@nyx/schemas'
import type { SolverConfig, SolverMessage, SolverResult, SolverParams, SolverPlanningConfig } from './solver/solver.types'
import { scoreBlocks, findMatrixMisses, type ScoringBlock } from './solver/solver.scoring'
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
    const [blocks, matrix, planningCfg] = await Promise.all([
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
                  route: { select: { originLocalityId: true, destinationLocalityId: true, lineId: true, direction: true, line: { select: { metrics: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.travelTimeMatrix.findMany(),
      this.planningConfig.get(),
    ])

    if (blocks.length === 0) return

    const matrixMap: Record<string, { minutes: number; km: number }> = {}
    for (const m of matrix) {
      matrixMap[`${m.originId}:${m.destinationId}`] = { minutes: m.baseMinutes * m.speedRatio, km: m.distanceKm }
    }

    const scoringBlocks: ScoringBlock[] = blocks.map((b, idx) => ({
      id:          idx,
      depotId:     b.depotId,
      vehicleType: b.vehicleType,
      trips:       b.blockTrips.map(bt => {
        const route   = bt.trip.route
        const metrics = route.line.metrics as { extensionKm?: Record<string, number> } | null
        const tripKm  = metrics?.extensionKm?.[route.direction]
          ?? matrixMap[`${route.originLocalityId}:${route.destinationLocalityId}`]?.km
          ?? 0
        return {
          id:                    bt.tripId,
          lineId:                route.lineId,
          originLocalityId:      route.originLocalityId,
          destinationLocalityId: route.destinationLocalityId,
          departureMinutes:      bt.trip.departureMinutes,
          arrivalMinutes:        bt.trip.arrivalMinutes,
          tripKm,
          requiredVehicleType:   null,
          constraints:           null,
        }
      }),
    }))

    const result      = scoreBlocks(scoringBlocks, matrixMap, planningCfg)
    const matrixMisses = findMatrixMisses(scoringBlocks, matrixMap)

    const r2 = (n: number) => Math.round(n * 100) / 100
    const summary: VehiclePlanSummary = {
      fleetCount:        result.fleetCount,
      score:             result.score,
      deadrunKm:         r2(result.deadrunKm),
      productiveKm:      r2(result.productiveKm),
      totalKm:           r2(result.totalKm),
      deadrunMinutes:    result.deadrunMinutes,
      productiveMinutes: result.productiveMinutes,
      totalMinutes:      result.totalMinutes,
      ...(matrixMisses.length > 0 && { errors: { missingMatrix: matrixMisses } }),
    }

    await this.prisma.vehiclePlan.update({
      where: { id: planId },
      data:  { summary, generatedAt: new Date() },
    })
  }

  async duplicate(planId: string): Promise<VehiclePlan> {
    const plan = await (this.prisma as any).vehiclePlan.findUnique({
      where:   { id: planId },
      include: {
        lines:  { select: { lineId: true } },
        blocks: {
          include: {
            blockTrips:    { select: { tripId: true, sequence: true } },
            blockDeadruns: { select: { type: true, originLocalityId: true, destinationLocalityId: true, departureMinutes: true, arrivalMinutes: true } },
          },
        },
      },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')

    return this.prisma.$transaction(async tx => {
      const newPlan = await tx.vehiclePlan.create({
        data: {
          dayTypeId:   plan.dayTypeId,
          status:      'DRAFT',
          constraints: plan.constraints ?? undefined,
        },
      })

      if (plan.lines.length > 0) {
        await tx.vehiclePlanLine.createMany({
          data: plan.lines.map((l: any) => ({ vehiclePlanId: newPlan.id, lineId: l.lineId })),
        })
      }

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
          await tx.blockTrip.createMany({
            data: block.blockTrips.map((bt: any) => ({
              vehicleBlockId: newBlock.id,
              tripId:         bt.tripId,
              sequence:       bt.sequence,
            })),
          })
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

  async addLine(planId: string, lineId: string): Promise<void> {
    await this.prisma.vehiclePlanLine.create({ data: { vehiclePlanId: planId, lineId } })
  }

  async removeLine(planId: string, lineId: string): Promise<void> {
    await this.prisma.vehiclePlanLine.delete({
      where: { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
    })
  }

  async getGanttData(planId: string) {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:   { id: planId },
      include: {
        dayType: { select: { id: true, name: true, code: true } },
        lines: {
          include: { line: { select: { id: true, name: true, code: true } } },
        },
      },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')

    const blocks = await (this.prisma as any).vehicleBlock.findMany({
      where:   { vehiclePlanId: planId },
      orderBy: { blockNumber: 'asc' },
      include: {
        blockTrips: {
          orderBy: { sequence: 'asc' },
          include: {
            trip: {
              include: {
                route: {
                  include: {
                    line:                { select: { id: true, name: true, code: true } },
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
      },
    })

    return { plan, blocks }
  }

  async activate(planId: string): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:   { id: planId },
      include: { lines: { select: { lineId: true } } },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status === 'ACTIVE') throw new BadRequestException('Plan is already active')

    const lineIds  = plan.lines.map(l => l.lineId)
    const conflict = await this.prisma.vehiclePlan.findFirst({
      where: {
        id:        { not: planId },
        dayTypeId: plan.dayTypeId,
        status:    'ACTIVE',
        lines:     { some: { lineId: { in: lineIds } } },
      },
    })
    if (conflict) throw new ConflictException('Somente um planejamento pode estar ativo para um tipo de dia')

    await this.prisma.vehiclePlan.update({
      where: { id: planId },
      data:  { status: 'ACTIVE' },
    })
  }
}
