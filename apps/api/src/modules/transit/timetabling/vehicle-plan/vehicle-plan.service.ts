import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { Worker } from 'worker_threads'
import path from 'path'
import { PrismaService } from '../../../../prisma/prisma.service'
import { PlanningConfigService } from '../settings/planning-config/planning-config.service'
import { BaseService } from '../../../../core/base.service'
import { vehiclePlanSchema, VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto } from '@nyx/schemas'
import type { SolverConfig, SolverMessage, SolverResult } from './solver/solver.types'
import type { VehiclePlanSummary } from '@nyx/schemas'
import type { VehicleBlockSummary } from '@nyx/schemas'

interface Job {
  worker: Worker
  best: SolverResult | null
  planId: string
  messages$: Subject<SolverMessage>
}

@Injectable()
export class VehiclePlanService extends BaseService<VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto> {
  private readonly logger = new Logger(VehiclePlanService.name)
  private readonly jobs = new Map<string, Job>()

  constructor(
    prisma: PrismaService,
    private readonly planningConfig: PlanningConfigService,
  ) {
    super(prisma, 'vehiclePlan', vehiclePlanSchema, 'transit')
  }

  async generate(planId: string, jobId: string): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:   { id: planId },
      include: { lines: { select: { lineId: true } } },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if ((plan.constraints as any)?.locked) throw new BadRequestException('Plan is locked')
    if (plan.status === 'ACTIVE') throw new BadRequestException('Active plan cannot be regenerated')

    const lineIds = plan.lines.map(l => l.lineId)
    if (lineIds.length === 0) throw new BadRequestException('Plan has no lines defined')

    const [trips, matrix, depotLocalities, config] = await Promise.all([
      this.prisma.transitTrip.findMany({
        where:   { dayTypeId: plan.dayTypeId, route: { lineId: { in: lineIds } } },
        include: { route: { select: { originLocalityId: true, destinationLocalityId: true } } },
      }),
      this.prisma.travelTimeMatrix.findMany(),
      this.prisma.transitLocality.findMany({ where: { isDepot: true }, select: { id: true } }),
      this.planningConfig.get(),
    ])

    if (trips.length === 0) throw new BadRequestException('No trips found for this plan')

    const matrixMap: Record<string, { minutes: number; km: number }> = {}
    for (const m of matrix) {
      matrixMap[`${m.originId}:${m.destinationId}`] = { minutes: m.baseMinutes, km: m.distanceKm }
    }

    const solverConfig: SolverConfig = {
      planId,
      config,
      trips: trips.map(t => ({
        id:                   t.id,
        originLocalityId:     t.route.originLocalityId,
        destinationLocalityId: t.route.destinationLocalityId,
        departureMinutes:     t.departureMinutes,
        arrivalMinutes:       t.arrivalMinutes,
        requiredVehicleType:  t.requiredVehicleType ?? null,
        constraints:          t.constraints as any ?? null,
      })),
      matrix: matrixMap,
      depots: depotLocalities.map(d => d.id),
    }

    const isTs = __filename.endsWith('.ts')
    const workerFile = path.join(__dirname, 'solver', `solver.worker${isTs ? '.ts' : '.js'}`)
    const execArgv = isTs ? ['-r', 'ts-node/register/transpile-only'] : []

    const worker = new Worker(workerFile, { workerData: solverConfig, execArgv })
    const messages$ = new Subject<SolverMessage>()
    const job: Job = { worker, best: null, planId, messages$ }
    this.jobs.set(jobId, job)

    worker.on('message', (msg: SolverMessage) => {
      if (msg.type === 'improvement') job.best = msg.scenario
      messages$.next(msg)
      if (msg.type === 'done') {
        messages$.complete()
        // keep job in map so assumeBest can still access job.best after the stream closes;
        // schedule cleanup to avoid indefinite memory retention
        setTimeout(() => this.jobs.delete(jobId), 30 * 60 * 1000)
      }
    })

    worker.on('error', err => {
      this.logger.error(`Solver worker error for job ${jobId}`, err)
      messages$.error(err)
      this.jobs.delete(jobId)
    })
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

    // stop the worker if it's still running, then clean up the job
    try { job.worker.postMessage({ type: 'stop' }) } catch { /* already terminated */ }
    this.jobs.delete(jobId)

    const best = job.best

    await this.prisma.$transaction(async tx => {
      await tx.vehicleBlock.deleteMany({ where: { vehiclePlanId: planId } })

      for (const block of best.blocks) {
        const blockSummary: VehicleBlockSummary = {
          totalMinutes:      block.totalMinutes,
          productiveMinutes: block.productiveMinutes,
          deadrunMinutes:    block.deadrunMinutes,
          totalKm:           block.totalKm,
          productiveKm:      block.productiveKm,
          deadrunKm:         block.deadrunKm,
        }

        const created = await tx.vehicleBlock.create({
          data: {
            vehiclePlanId: planId,
            blockNumber:   block.blockNumber,
            depotId:       block.depotId,
            vehicleType:   block.vehicleType as any,
            summary:       blockSummary,
          },
        })

        await tx.blockTrip.createMany({
          data: block.trips.map(bt => ({
            vehicleBlockId:  created.id,
            tripId:          bt.tripId,
            sequence:        bt.sequence,
            isDeadhead:      bt.isDeadhead,
            deadheadMinutes: bt.deadheadMinutes,
            deadheadKm:      bt.deadheadKm,
          })),
        })
      }

      const planSummary: VehiclePlanSummary = {
        fleetCount:        best.fleetCount,
        score:             best.score,
        deadrunKm:         best.deadrunKm,
        productiveKm:      best.productiveKm,
        totalKm:           best.totalKm,
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

  async stop(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.worker.postMessage({ type: 'stop' })
  }

  async addLine(planId: string, lineId: string): Promise<void> {
    await this.prisma.vehiclePlanLine.create({
      data: { vehiclePlanId: planId, lineId },
    })
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

    const blocks = await this.prisma.vehicleBlock.findMany({
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

    const lineIds = plan.lines.map(l => l.lineId)

    const conflict = await this.prisma.vehiclePlan.findFirst({
      where: {
        id:        { not: planId },
        dayTypeId: plan.dayTypeId,
        status:    'ACTIVE',
        lines:     { some: { lineId: { in: lineIds } } },
      },
    })
    if (conflict) throw new ConflictException('One or more lines are already covered by an active plan for this day type')

    await this.prisma.vehiclePlan.update({
      where: { id: planId },
      data:  { status: 'ACTIVE' },
    })
  }
}
