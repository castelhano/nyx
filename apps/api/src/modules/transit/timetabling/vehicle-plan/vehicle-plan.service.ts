import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { Worker } from 'worker_threads'
import path from 'path'
import { PrismaService } from '../../../../prisma/prisma.service'
import { PlanningConfigService } from '../settings/planning-config/planning-config.service'
import type { SolverConfig, SolverMessage, SolverResult } from './solver/solver.types'

interface Job {
  worker: Worker
  best: SolverResult | null
  planId: string
  messages$: Subject<SolverMessage>
}

@Injectable()
export class VehiclePlanService {
  private readonly logger = new Logger(VehiclePlanService.name)
  private readonly jobs = new Map<string, Job>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly planningConfig: PlanningConfigService,
  ) {}

  async generate(planId: string, jobId: string): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({ where: { id: planId } })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if ((plan.constraints as any)?.locked) throw new BadRequestException('Plan is locked')
    if (plan.status === 'CONFIRMED') throw new BadRequestException('Confirmed plan cannot be regenerated')

    const [trips, matrix, depotFleets, config] = await Promise.all([
      this.prisma.transitTrip.findMany({
        where: { branchId: plan.branchId, servicePeriodId: plan.servicePeriodId, dayTypeId: plan.dayTypeId },
        include: { route: { select: { originLocalityId: true, destinationLocalityId: true } } },
      }),
      this.prisma.travelTimeMatrix.findMany({ where: { branchId: plan.branchId } }),
      this.prisma.depotFleet.findMany({ where: { branchId: plan.branchId } }),
      this.planningConfig.get(),
    ])

    if (trips.length === 0) throw new BadRequestException('No trips found for this plan')

    const matrixMap: Record<string, { minutes: number; km: number }> = {}
    for (const m of matrix) {
      matrixMap[`${m.originId}:${m.destinationId}`] = {
        minutes: m.baseMinutes,
        km: m.distanceKm,
      }
    }

    const solverConfig: SolverConfig = {
      planId,
      config,
      trips: trips.map(t => ({
        id: t.id,
        originLocalityId: t.route.originLocalityId,
        destinationLocalityId: t.route.destinationLocalityId,
        departureMinutes: t.departureMinutes,
        arrivalMinutes: t.arrivalMinutes,
        requiredVehicleType: t.requiredVehicleType ?? null,
        constraints: t.constraints as any ?? null,
      })),
      matrix: matrixMap,
      depots: depotFleets.map(d => ({
        localityId: d.localityId,
        vehicleType: d.vehicleType,
        quantity: d.quantity,
      })),
    }

    await this.prisma.vehiclePlan.update({
      where: { id: planId },
      data: { status: 'PROCESSING' },
    })

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
        this.jobs.delete(jobId)
        this.prisma.vehiclePlan
          .update({ where: { id: planId }, data: { status: job.best ? 'READY' : 'DRAFT' } })
          .catch(err => this.logger.error('Failed to update plan status after done', err))
      }
    })

    worker.on('error', err => {
      this.logger.error(`Solver worker error for job ${jobId}`, err)
      messages$.error(err)
      this.jobs.delete(jobId)
      this.prisma.vehiclePlan
        .update({ where: { id: planId }, data: { status: 'DRAFT' } })
        .catch(() => {})
    })
  }

  streamProgress(jobId: string): Observable<{ data: string }> {
    const job = this.jobs.get(jobId)
    if (!job) return new Observable(s => s.complete())

    return new Observable(subscriber => {
      const sub = job.messages$.subscribe({
        next: msg => subscriber.next({ data: JSON.stringify(msg) }),
        error: err => subscriber.error(err),
        complete: () => subscriber.complete(),
      })
      return () => sub.unsubscribe()
    })
  }

  async assumeBest(planId: string, jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job?.best) throw new NotFoundException('No result available yet')

    const best = job.best

    await this.prisma.$transaction(async tx => {
      await tx.vehicleBlock.deleteMany({ where: { vehiclePlanId: planId } })

      for (const block of best.blocks) {
        const created = await tx.vehicleBlock.create({
          data: {
            vehiclePlanId: planId,
            blockNumber:   block.blockNumber,
            depotId:       block.depotId,
            vehicleType:   block.vehicleType as any,
            totalMinutes:  block.totalMinutes,
            totalKm:       block.totalKm,
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

      await tx.vehiclePlan.update({
        where: { id: planId },
        data: {
          status:      'READY',
          fleetCount:  best.fleetCount,
          score:       best.score,
          deadrunKm:   best.deadrunKm,
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

  async confirm(planId: string): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({ where: { id: planId } })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'READY') throw new BadRequestException('Only READY plans can be confirmed')

    await this.prisma.$transaction(async tx => {
      // Deconfirm any existing confirmed plan for the same (servicePeriod, dayType, branch)
      await tx.vehiclePlan.updateMany({
        where: {
          branchId:       plan.branchId,
          servicePeriodId: plan.servicePeriodId,
          dayTypeId:      plan.dayTypeId,
          status:         'CONFIRMED',
          NOT: { id: planId },
        },
        data: { status: 'READY' },
      })

      await tx.vehiclePlan.update({
        where: { id: planId },
        data:  { status: 'CONFIRMED' },
      })
    })
  }
}
