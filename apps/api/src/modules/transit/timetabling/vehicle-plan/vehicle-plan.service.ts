import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { Worker } from 'worker_threads'
import path from 'path'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitGeneralConfigService }  from '../../settings/transit-general-config.service'
import { TransitPlanningConfigService } from '../../settings/transit-planning-config.service'
import { JobService } from '../../../core/job/job.service'
import { BaseService } from '../../../../core/base.service'
import { vehiclePlanSchema, VehiclePlan, CreateVehiclePlanDto, UpdateVehiclePlanDto } from '@nyx/schemas'
import { generateDraftRef } from '../line-schedule/line-schedule.util'
import type { SolverConfig, SolverMessage, SolverResult, SolverParams, SolverPlanningConfig } from './solver/solver.types'
import type { VehiclePlanSummary } from '@nyx/schemas'
import type { VehicleBlockSummary } from '@nyx/schemas'
import type { VehiclePlanLineSummary } from '@nyx/schemas'
import type { VehiclePlanDiff } from '@nyx/schemas'
import { VEHICLE_TYPE_CAPACITY } from './vehicle-plan.constants'
import { buildAggregateFromPersisted } from './scoring/block-aggregate'
import { scoreFromAggregates, buildLineAggregates, computeLineSummary } from './scoring/plan-scoring.calc'
import { applyAddAccess, applyAddReturn, applyMoveTrip } from './block-mutation.utils'
import { beforeTripUpdate, afterTripUpdate, applyTripRemoval } from '../trip/trip-mutation.utils'

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

  // Approximate peak bands used to consolidate cycle windows and bucket hourly
  // demand/supply for the line comparativo — see docs/proposal/linha-comparativo-simulacao-indicadores.md
  // dúvida 2 (rare per-line variation gets handled if/when it shows up).
  private readonly PEAK_MORNING:   [number, number] = [5.5, 8]
  private readonly PEAK_AFTERNOON: [number, number] = [15.5, 18]

  constructor(
    prisma: PrismaService,
    private readonly generalConfig:  TransitGeneralConfigService,
    private readonly planningConfig: TransitPlanningConfigService,
    private readonly jobService:     JobService,
  ) {
    super(prisma, 'vehiclePlan', vehiclePlanSchema, 'transit')
  }

  // summary/constraints/metrics are only ever written by recalculate()/applyDiff — a
  // generic PATCH here must not be able to overwrite them directly (they'd go stale
  // with no isStale marker to signal it). See docs/proposal/vehicle-plan-summary-
  // score-consolidation.md §2.3.
  override async update(id: string, dto: UpdateVehiclePlanDto): Promise<VehiclePlan> {
    const { summary: _summary, constraints: _constraints, metrics: _metrics, ...rest } = dto as any
    return super.update(id, rest)
  }

  // Validation log for the per-line schedule generator (Fase 3, 100% client-side) —
  // not a real async job, just reuses the Job table as a queryable record of what
  // got generated (trips/blocks/frequency) while the algorithm is still being
  // tuned. See docs/proposal/vehicle-plan-fleet-window-redesign.md for context.
  async logGeneration(
    planId:      string,
    lineId:      string,
    dayTypeCode: string,
    output:      unknown,
    userId:      string,
  ): Promise<{ id: string }> {
    const job = await this.jobService.createJob({
      type:        'line-schedule-generation',
      domain:      'transit',
      resource:    'vehicle-plan',
      createdById: userId,
      input:       { planId, lineId, dayTypeCode },
    })
    await this.prisma.job.update({
      where: { id: job.id },
      data:  {
        status:      'COMPLETED',
        startedAt:   new Date(),
        completedAt: new Date(),
        durationMs:  0,
        output:      output as any,
      },
    })
    return { id: job.id }
  }

  async optimize(
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
        range:                    adjustedCfg.range,
        anchored:                 adjustedCfg.anchored,
        line:                     adjustedCfg.line,
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
          await this.recalculate(planId)
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

  // 'optimize_drivers'/'optimize_overtime' are currently no-ops — the criteria they
  // used to boost (driverUsage/overtime) were removed from SolverPlanningConfig along
  // with `flat` (see docs/proposal/vehicle_plan_score_formula_v1.md §4.4); they belong
  // to the future CrewPlan, not VehiclePlan. Left as valid SolverParams.direction
  // values pending that implementation.
  private applyDirectionWeights(config: SolverPlanningConfig, direction: SolverParams['direction']): SolverPlanningConfig {
    if (direction !== 'optimize_fleet') return config
    const result = JSON.parse(JSON.stringify(config)) as SolverPlanningConfig
    result.anchored.fleetUsage.active = true
    result.anchored.fleetUsage.weight = Math.round(result.anchored.fleetUsage.weight * 2)
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
    })

    // summary/score are never written from the SolverResult directly — recalculate()
    // is the single place that derives them, from the blocks just committed above.
    await this.recalculate(planId)
  }

  // The single write path for VehiclePlan.summary, VehiclePlanLine.summary and
  // VehicleBlock.summary (score included) — see docs/proposal/vehicle-plan-summary-
  // score-consolidation.md §2.1/§2.2. Recomputes every block with trips (not just
  // isStale ones): score is a function of the whole block set (mean/stdDev of
  // duration feed into it), so it can't be composed from a partial recalculation.
  // Accepts an optional transaction client so applyDiff can run this as the closing
  // step of its own atomic batch instead of opening a second transaction.
  async recalculate(planId: string, db: any = this.prisma): Promise<void> {
    const [plan, blocks, matrix, planLines, planningCfg] = await Promise.all([
      db.vehiclePlan.findUnique({
        where:  { id: planId },
        select: { dayType: { select: { code: true } }, metrics: true },
      }),
      db.vehicleBlock.findMany({
        where:   { vehiclePlanId: planId },
        include: {
          blockTrips: {
            orderBy: { sequence: 'asc' },
            include: {
              trip: {
                select: {
                  departureMinutes:    true,
                  arrivalMinutes:      true,
                  requiredVehicleType: true,
                  route: {
                    select: {
                      lineId:                true,
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
      db.travelTimeMatrix.findMany(),
      db.vehiclePlanLine.findMany({
        where:  { vehiclePlanId: planId },
        select: { lineId: true },
      }),
      this.planningConfig.get(),
    ])

    if (!plan) return

    const matrixKm: Record<string, number> = {}
    for (const m of matrix) matrixKm[`${m.originId}:${m.destinationId}`] = m.distanceKm

    const blocksWithTrips = blocks.filter((b: any) => b.blockTrips.length > 0)

    // ── VehiclePlanLine.summary — always recomputed in full from raw trip data ──
    const dayTypeCode = plan.dayType?.code
    const lineAgg      = buildLineAggregates(blocksWithTrips, matrixKm, dayTypeCode, VEHICLE_TYPE_CAPACITY)

    // ── VehicleBlock.summary + VehiclePlan.summary — from BlockAggregate ────────
    const planMetrics = plan.metrics as Partial<SolverPlanningConfig> | null
    const resolvedCfg = (planMetrics ? { ...planningCfg, ...planMetrics } : planningCfg) as SolverPlanningConfig

    const lineSummaries = new Map<string, VehiclePlanLineSummary>()
    for (const { lineId } of planLines) {
      lineSummaries.set(lineId, computeLineSummary(lineAgg.get(lineId), resolvedCfg.line))
    }

    const planTrips = blocksWithTrips.flatMap((b: any) =>
      b.blockTrips.map((bt: any) => ({
        departureMinutes: bt.trip.departureMinutes,
        arrivalMinutes:   bt.trip.arrivalMinutes,
      })),
    )
    const aggregates = blocksWithTrips.map((b: any) => buildAggregateFromPersisted(b, matrixKm))
    const scored      = scoreFromAggregates(aggregates, planTrips, resolvedCfg)

    const planSummary: VehiclePlanSummary = { ...scored, fleetCount: blocksWithTrips.length }

    await Promise.all([
      db.vehiclePlan.update({
        where: { id: planId },
        data:  { summary: planSummary, generatedAt: new Date() },
      }),
      ...Array.from(lineSummaries.entries()).map(([lineId, summary]) =>
        db.vehiclePlanLine.update({
          where: { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
          data:  { summary },
        })
      ),
      ...blocksWithTrips.map((block: any, i: number) => {
        const a = aggregates[i]
        const summary: VehicleBlockSummary = {
          totalMinutes:      a.totalMinutes,
          productiveMinutes: a.productiveMinutes,
          deadrunMinutes:    a.deadrunMinutes,
          totalKm:           a.deadrunKm + a.productiveKm,
          productiveKm:      a.productiveKm,
          deadrunKm:         a.deadrunKm,
        }
        return db.vehicleBlock.update({ where: { id: block.id }, data: { summary, isStale: false } })
      }),
      ...blocks
        .filter((b: any) => b.blockTrips.length === 0 && b.isStale)
        .map((b: any) => db.vehicleBlock.update({ where: { id: b.id }, data: { isStale: false } })),
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

  // Shared by applyDiff's 'adds' processing — resolves an existing block by id
  // (scoped to this plan) or spawns a new one off the last block's depot, mirroring
  // what used to be duplicated three times across addTrip/addDeadrun/addInterval.
  private async resolveOrCreateBlock(tx: any, planId: string, blockId?: string): Promise<string> {
    if (blockId) {
      const block = await tx.vehicleBlock.findFirst({ where: { id: blockId, vehiclePlanId: planId }, select: { id: true } })
      if (!block) throw new NotFoundException('VehicleBlock not found in this plan')
      return block.id
    }

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
      data: { vehiclePlanId: planId, blockNumber: (lastBlock?.blockNumber ?? 0) + 1, depotId, vehicleType: 'STANDARD' },
    })
    return newBlock.id
  }

  // The single write path for every Gantt edit (trip/deadrun/interval patches and
  // deletes, adds, moves) — applies the whole diff inside one transaction, closing
  // with recalculate() before commit. Nothing above ever persists without an
  // up-to-date summary, and a mid-batch failure rolls back everything instead of
  // leaving isStale blocks with no guaranteed follow-up recalculation. Replaces the
  // old N-HTTP-calls-plus-final-rescore flow. See docs/proposal/vehicle-plan-
  // summary-score-consolidation.md §2.4.
  async applyDiff(planId: string, diff: VehiclePlanDiff): Promise<{ blockIdMap: Record<string, string> }> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, dayTypeId: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    const newBlockIds = new Map<string, string>()
    const resolveBlockRef = (ref: string): string =>
      ref.startsWith('pending:') ? (newBlockIds.get(ref.slice('pending:'.length)) ?? ref) : ref

    await this.prisma.$transaction(async (tx: any) => {
      // 1. trip time patches
      for (const u of diff.tripUpdates) {
        // constraints (field-level lock) is excluded from `patch` — it never marks
        // isStale/drift (afterTripUpdate keys off departure/arrival only, same as
        // TripService.update), only departure/arrival timing does.
        const patch: { departureMinutes?: number; arrivalMinutes?: number } = {}
        if (u.departureMinutes !== undefined) patch.departureMinutes = u.departureMinutes
        if (u.arrivalMinutes   !== undefined) patch.arrivalMinutes   = u.arrivalMinutes
        const data: typeof patch & { constraints?: unknown } = { ...patch }
        if (u.constraints !== undefined) data.constraints = u.constraints
        const existing = await beforeTripUpdate(tx, u.id)
        const result   = await tx.transitTrip.update({ where: { id: u.id }, data })
        await afterTripUpdate(tx, u.id, existing, patch, result)
      }

      // 2. deadrun time patches
      for (const u of diff.deadrunUpdates) {
        const dr = await tx.blockDeadrun.findUnique({ where: { id: u.id }, select: { vehicleBlockId: true } })
        if (!dr) throw new NotFoundException('Vazio não encontrado')
        await tx.blockDeadrun.update({ where: { id: u.id }, data: { departureMinutes: u.departureMinutes, arrivalMinutes: u.arrivalMinutes } })
        await tx.vehicleBlock.update({ where: { id: dr.vehicleBlockId }, data: { isStale: true } })
      }

      // 3. interval time patches — tolerant of a missing id: the anchor trip may
      // already have been deleted earlier in this same diff, cascading it away
      // (block-interval.utils.ts) before this loop runs.
      for (const u of diff.intervalUpdates) {
        const bi = await tx.blockInterval.findUnique({ where: { id: u.id }, select: { vehicleBlockId: true } })
        if (!bi) continue
        await tx.blockInterval.update({ where: { id: u.id }, data: { departureMinutes: u.departureMinutes, arrivalMinutes: u.arrivalMinutes } })
        await tx.vehicleBlock.update({ where: { id: bi.vehicleBlockId }, data: { isStale: true } })
      }

      // 4. trip deletes
      for (const tripId of diff.tripDeletes) {
        await applyTripRemoval(tx, tripId)
      }

      // 5. deadrun deletes
      if (diff.deadrunDeletes.length > 0) {
        const found     = await tx.blockDeadrun.findMany({ where: { id: { in: diff.deadrunDeletes } }, select: { id: true, vehicleBlockId: true } })
        const blockIds  = [...new Set(found.map((f: any) => f.vehicleBlockId))]
        await tx.blockDeadrun.deleteMany({ where: { id: { in: found.map((f: any) => f.id) } } })
        for (const blockId of blockIds) await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
      }

      // 6. interval deletes (tolerant, same reasoning as step 3)
      if (diff.intervalDeletes.length > 0) {
        const found = await tx.blockInterval.findMany({ where: { id: { in: diff.intervalDeletes } }, select: { id: true, vehicleBlockId: true } })
        if (found.length > 0) {
          const blockIds = [...new Set(found.map((f: any) => f.vehicleBlockId))]
          await tx.blockInterval.deleteMany({ where: { id: { in: found.map((f: any) => f.id) } } })
          for (const blockId of blockIds) await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
        }
      }

      // 7. adds — walked in order so a 'new' entry's server-assigned block id is
      // available to any later 'pending:<tempId>' entry in the same batch that
      // references it (mirrors the old client-side newBlockIds map).
      for (const entry of diff.adds) {
        const rawBlockId = entry.blockId === 'new' ? undefined : resolveBlockRef(entry.blockId)
        let resolvedBlockId: string

        if (entry._kind === 'trip') {
          const route = await tx.transitRoute.findUnique({
            where:  { id: entry.routeId },
            select: { lineId: true, originLocalityId: true, destinationLocalityId: true },
          })
          if (!route) throw new NotFoundException('Route not found')

          // Marks the line as present in the plan even without a pinned schedule; if
          // a schedule is pinned and this departure doesn't match any LineDeparture,
          // marks isDrifted.
          const currentLine = await tx.vehiclePlanLine.findUnique({
            where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId: route.lineId } },
            select: { lineScheduleId: true },
          })
          let driftUpdate: Record<string, unknown> = {}
          if (currentLine?.lineScheduleId) {
            const matches = await tx.lineDeparture.findFirst({
              where:  { lineScheduleId: currentLine.lineScheduleId, routeId: entry.routeId, departureMinutes: entry.departureMinutes },
              select: { id: true },
            })
            if (!matches) driftUpdate = { isDrifted: true }
          }
          await tx.vehiclePlanLine.upsert({
            where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId: route.lineId } },
            create: { vehiclePlanId: planId, lineId: route.lineId, ...driftUpdate },
            update: driftUpdate,
          })

          const trip = await tx.transitTrip.create({
            data: { dayTypeId: plan.dayTypeId, routeId: entry.routeId, departureMinutes: entry.departureMinutes, arrivalMinutes: entry.arrivalMinutes },
          })

          resolvedBlockId = await this.resolveOrCreateBlock(tx, planId, rawBlockId)
          const maxSeq = await tx.blockTrip.aggregate({ where: { vehicleBlockId: resolvedBlockId }, _max: { sequence: true } })
          await tx.blockTrip.create({ data: { vehicleBlockId: resolvedBlockId, tripId: trip.id, sequence: (maxSeq._max.sequence ?? -1) + 1 } })

          // Deadrun timing is always re-derived server-side from the matrix — the
          // client's precomputed travelMinutes (used for its own optimistic render)
          // is display-only and never trusted for what gets persisted.
          if (entry.access) {
            const tt = await tx.travelTimeMatrix.findUnique({
              where: { originId_destinationId: { originId: entry.access.localityId, destinationId: route.originLocalityId } },
            })
            if (!tt) throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')
            const minutes = Math.round(tt.baseMinutes * tt.speedRatio)
            await tx.blockDeadrun.create({
              data: {
                vehicleBlockId: resolvedBlockId, type: 'ACCESS',
                originLocalityId: entry.access.localityId, destinationLocalityId: route.originLocalityId,
                departureMinutes: entry.departureMinutes - minutes - 1, arrivalMinutes: entry.departureMinutes - 1,
              },
            })
          }
          if (entry.return) {
            const tt = await tx.travelTimeMatrix.findUnique({
              where: { originId_destinationId: { originId: route.destinationLocalityId, destinationId: entry.return.localityId } },
            })
            if (!tt) throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')
            const minutes = Math.round(tt.baseMinutes * tt.speedRatio)
            await tx.blockDeadrun.create({
              data: {
                vehicleBlockId: resolvedBlockId, type: 'RETURN',
                originLocalityId: route.destinationLocalityId, destinationLocalityId: entry.return.localityId,
                departureMinutes: entry.arrivalMinutes + 1, arrivalMinutes: entry.arrivalMinutes + minutes + 1,
              },
            })
          }
          await tx.vehicleBlock.update({ where: { id: resolvedBlockId }, data: { isStale: true } })
        } else if (entry._kind === 'deadrun') {
          resolvedBlockId = await this.resolveOrCreateBlock(tx, planId, rawBlockId)
          if (entry.type === 'ACCESS' || entry.type === 'RETURN') {
            if (!entry.blockTripId) throw new BadRequestException('Acesso/recolhida pendente sem viagem associada')
            const depotLocalityId = entry.type === 'ACCESS' ? entry.originLocality.id : entry.destinationLocality.id
            if (entry.type === 'ACCESS') await applyAddAccess(tx, resolvedBlockId, entry.blockTripId, depotLocalityId)
            else                          await applyAddReturn(tx, resolvedBlockId, entry.blockTripId, depotLocalityId)
          } else {
            await tx.blockDeadrun.create({
              data: {
                vehicleBlockId: resolvedBlockId, type: 'DISPLACEMENT',
                originLocalityId: entry.originLocality.id, destinationLocalityId: entry.destinationLocality.id,
                departureMinutes: entry.departureMinutes, arrivalMinutes: entry.arrivalMinutes,
              },
            })
            await tx.vehicleBlock.update({ where: { id: resolvedBlockId }, data: { isStale: true } })
          }
        } else {
          resolvedBlockId = await this.resolveOrCreateBlock(tx, planId, rawBlockId)
          await tx.blockInterval.create({
            data: { vehicleBlockId: resolvedBlockId, intervalTypeId: entry.intervalTypeId, departureMinutes: entry.departureMinutes, arrivalMinutes: entry.arrivalMinutes },
          })
          await tx.vehicleBlock.update({ where: { id: resolvedBlockId }, data: { isStale: true } })
        }

        if (entry.blockId === 'new') newBlockIds.set(entry._tempId, resolvedBlockId)
      }

      // 8. moves — "delete wins": a trip/deadrun also pending-deleted in this same
      // diff is dropped from the move instead of erroring (already gone by step 4/5).
      for (const move of diff.moves) {
        const foundTrips    = await tx.blockTrip.findMany({ where: { id: { in: move.blockTripIds } }, select: { id: true, tripId: true } })
        const blockTripIds  = foundTrips.filter((f: any) => !diff.tripDeletes.includes(f.tripId)).map((f: any) => f.id)
        if (blockTripIds.length === 0) continue

        const deadrunIds  = move.deadrunIds.filter(id => !diff.deadrunDeletes.includes(id))
        const fromBlockId = resolveBlockRef(move.fromBlockId)
        const toBlockId    = resolveBlockRef(move.toBlockId)
        await applyMoveTrip(tx, fromBlockId, blockTripIds, toBlockId, move.breakIds, deadrunIds)
      }

      // 9. the only write path for summary/score — closes this same transaction so
      // nothing above ever commits without an up-to-date summary.
      await this.recalculate(planId, tx)
    }, { timeout: 30_000 })

    return { blockIdMap: Object.fromEntries(newBlockIds) }
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
  // windows is keyed by dayTypeCode first (see LineService.applyWindows); falls back
  // to 'U' (dia útil) when the plan's own dayType has no cycle data imported yet.
  private resolveCycleMinutes(
    metrics:          Record<string, any> | null | undefined,
    dayTypeCode:      string,
    direction:        string,
    departureMinutes: number,
  ): number | null {
    const forDayType = metrics?.windows?.[dayTypeCode] ?? metrics?.windows?.['U'] ?? {}
    const windows     = forDayType[direction] ?? forDayType['OUTBOUND'] ?? []
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

  // Overwrites the LineDeparture set of a DRAFT schedule already pinned to this
  // line/plan with the current trip set (routeId+departureMinutes) — still a
  // draft, so there's no approval history to preserve. Only callable while the
  // schedule is DRAFT; once approved, the only way to reflect changes is a new
  // version (activateNewLineSchedule). Duration/vehicle type don't factor into
  // the comparison — only the departure time decides whether a trip "matches" a
  // schedule departure.
  async syncLineSchedule(planId: string, lineId: string): Promise<{ id: string; approvalRef: string }> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, dayTypeId: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    const vpl = await this.prisma.vehiclePlanLine.findUnique({
      where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
      select: { lineScheduleId: true },
    })
    if (!vpl?.lineScheduleId) throw new BadRequestException('Linha não possui OSO vinculada')

    const db = this.prisma as any

    const schedule = await db.lineSchedule.findUnique({
      where:  { id: vpl.lineScheduleId },
      select: { id: true, status: true, approvalRef: true },
    })
    if (!schedule) throw new NotFoundException('LineSchedule not found')
    if (schedule.status !== 'DRAFT') throw new BadRequestException('Only DRAFT schedules can be synced in place')

    const existingTrips = await db.transitTrip.findMany({
      where: {
        dayTypeId:  plan.dayTypeId,
        route:      { lineId },
        blockTrips: { some: { vehicleBlock: { vehiclePlanId: planId } } },
      },
      select: { id: true, routeId: true, departureMinutes: true, requiredVehicleType: true },
    })

    const tripByKey = new Map<string, any>()
    for (const t of existingTrips) {
      const key = `${t.routeId}:${t.departureMinutes}`
      if (!tripByKey.has(key)) tripByKey.set(key, t)
    }

    const departures = await db.lineDeparture.findMany({
      where:  { lineScheduleId: schedule.id },
      select: { id: true, routeId: true, departureMinutes: true },
    })
    const departureKeys = new Set(departures.map((d: any) => `${d.routeId}:${d.departureMinutes}`))

    const toDeleteIds = departures
      .filter((d: any) => !tripByKey.has(`${d.routeId}:${d.departureMinutes}`))
      .map((d: any) => d.id)
    const toCreate = [...tripByKey.entries()]
      .filter(([key]) => !departureKeys.has(key))
      .map(([, t]) => t)

    await this.prisma.$transaction(async (tx0) => {
      const tx = tx0 as any

      if (toDeleteIds.length > 0) {
        await tx.lineDeparture.deleteMany({ where: { id: { in: toDeleteIds } } })
      }

      const idByKey = new Map<string, string>(
        departures
          .filter((d: any) => !toDeleteIds.includes(d.id))
          .map((d: any) => [`${d.routeId}:${d.departureMinutes}`, d.id]),
      )
      for (const t of toCreate) {
        const created = await tx.lineDeparture.create({
          data: {
            lineScheduleId:      schedule.id,
            routeId:             t.routeId,
            departureMinutes:    t.departureMinutes,
            requiredVehicleType: t.requiredVehicleType ?? undefined,
          },
          select: { id: true },
        })
        idByKey.set(`${t.routeId}:${t.departureMinutes}`, created.id)
      }

      for (const t of existingTrips) {
        const depId = idByKey.get(`${t.routeId}:${t.departureMinutes}`)
        if (depId) await tx.transitTrip.update({ where: { id: t.id }, data: { lineDepartureId: depId } })
      }

      await tx.vehiclePlanLine.update({
        where: { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
        data:  { isDrifted: false },
      })
    })

    return { id: schedule.id, approvalRef: schedule.approvalRef }
  }

  // Creates a new DRAFT version of the line's schedule, seeded 1:1 from the trips
  // the line already has *in this plan*, relinks each of them and pins it on
  // VehiclePlanLine right away — unlike createLineSchedule (the manual "Nova OSO"
  // flow, ref required, doesn't pin by itself), this is the automatic activation
  // used by reconcile when the line's current schedule is no longer DRAFT (or
  // doesn't exist yet). Ref is optional because the proposal is normally put
  // together before the granting authority issues the actual processo number —
  // without one, falls back to a DRAFT-XXXX placeholder (generateDraftRef).
  async activateNewLineSchedule(planId: string, lineId: string, approvalRef?: string): Promise<{ id: string; approvalRef: string }> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, scopeId: true, dayTypeId: true, status: true },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be modified')

    const line = await this.prisma.transitLine.findUnique({ where: { id: lineId }, select: { scopeId: true } })
    if (!line || line.scopeId !== plan.scopeId) throw new BadRequestException('Linha não pertence ao escopo deste planejamento')

    const db = this.prisma as any

    const existingTrips = await db.transitTrip.findMany({
      where: {
        dayTypeId:  plan.dayTypeId,
        route:      { lineId },
        blockTrips: { some: { vehicleBlock: { vehiclePlanId: planId } } },
      },
      select: { id: true, routeId: true, departureMinutes: true, requiredVehicleType: true },
    })

    const departureByKey = new Map<string, any>()
    for (const t of existingTrips) {
      const key = `${t.routeId}:${t.departureMinutes}`
      if (!departureByKey.has(key)) departureByKey.set(key, t)
    }

    const ref = approvalRef?.trim() || await generateDraftRef(this.prisma, lineId, plan.dayTypeId)

    return this.prisma.$transaction(async (tx0) => {
      const tx = tx0 as any

      const schedule = await tx.lineSchedule.create({
        data: { lineId, dayTypeId: plan.dayTypeId, approvalRef: ref, status: 'DRAFT' },
      })

      const idByKey = new Map<string, string>()
      for (const d of departureByKey.values()) {
        const created = await tx.lineDeparture.create({
          data: {
            lineScheduleId:      schedule.id,
            routeId:             d.routeId,
            departureMinutes:    d.departureMinutes,
            requiredVehicleType: d.requiredVehicleType ?? undefined,
          },
          select: { id: true },
        })
        idByKey.set(`${d.routeId}:${d.departureMinutes}`, created.id)
      }

      for (const t of existingTrips) {
        const depId = idByKey.get(`${t.routeId}:${t.departureMinutes}`)
        if (depId) await tx.transitTrip.update({ where: { id: t.id }, data: { lineDepartureId: depId } })
      }

      await tx.vehiclePlanLine.upsert({
        where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
        create: { vehiclePlanId: planId, lineId, lineScheduleId: schedule.id, isDrifted: false },
        update: { lineScheduleId: schedule.id, isDrifted: false },
      })

      return { id: schedule.id, approvalRef: ref }
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
  // the plan must be re-optimized ("Otimizar") afterward to (re)block them.
  async switchLineSchedule(planId: string, lineId: string, lineScheduleId: string): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { id: true, scopeId: true, dayTypeId: true, status: true, dayType: { select: { code: true } } },
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
        const cycleMinutes  = this.resolveCycleMinutes(line.metrics as any, plan.dayType.code, d.route.direction, d.departureMinutes)
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
        summary:        materialized?.summary ?? null,
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

  // Consolidates TransitLine.metrics into the "Operação" figures shown by the line
  // comparativo — these describe the line itself (extension, registered cycle
  // windows), not a specific plan, so they're identical on both sides of the
  // comparison and never persisted. Cycle windows are averaged ida+volta into a
  // single number per band (doc decision: rare for one direction to run a very
  // different frequency — those exceptions get handled if/when they show up).
  private consolidateOperation(
    metrics: {
      extensionKm?: Partial<Record<'OUTBOUND' | 'INBOUND' | 'CIRCULAR', number>>
      windows?:     Record<string, Partial<Record<'OUTBOUND' | 'INBOUND' | 'CIRCULAR', { from: number; to: number; intervalMinutes: number }[]>>>
    } | null,
    dayTypeCode: string | undefined,
  ): { extensionKm: number | null; peakMorningInterval: number | null; peakAfternoonInterval: number | null; offPeakInterval: number | null } {
    const ext       = metrics?.extensionKm
    const extValues = [ext?.OUTBOUND, ext?.INBOUND].filter((v): v is number => typeof v === 'number')
    const extensionKm = extValues.length > 0
      ? Math.round((extValues.reduce((a, b) => a + b, 0) / extValues.length) * 100) / 100
      : ext?.CIRCULAR ?? null

    const dayWindows = dayTypeCode ? metrics?.windows?.[dayTypeCode] : undefined
    const allEntries = [
      ...(dayWindows?.OUTBOUND ?? []),
      ...(dayWindows?.INBOUND  ?? []),
      ...(dayWindows?.CIRCULAR ?? []),
    ]

    const bandAvg = (bandFrom: number, bandTo: number): number | null => {
      const overlapping = allEntries.filter(w => w.from < bandTo && w.to > bandFrom)
      if (overlapping.length === 0) return null
      return Math.round(overlapping.reduce((sum, w) => sum + w.intervalMinutes, 0) / overlapping.length)
    }

    return {
      extensionKm,
      peakMorningInterval:   bandAvg(...this.PEAK_MORNING),
      peakAfternoonInterval: bandAvg(...this.PEAK_AFTERNOON),
      offPeakInterval:       bandAvg(this.PEAK_MORNING[1], this.PEAK_AFTERNOON[0]),
    }
  }

  // Whether the hour bucket [hour, hour+1) overlaps either peak band — same overlap
  // test consolidateOperation uses for cycle windows, applied to a plain hour slot.
  private isPeakHour(hour: number): boolean {
    const overlaps = (from: number, to: number) => hour < to && hour + 1 > from
    return overlaps(...this.PEAK_MORNING) || overlaps(...this.PEAK_AFTERNOON)
  }

  // Reads the line comparativo: this plan's line summary (draft/proposed side) next
  // to the currently ACTIVE plan's summary for the same line+dayType+scope
  // (current/atual side) — each plan owns its own VehiclePlanLine.summary (populated
  // by recalculate), so there's nothing extra to compute here besides locating the
  // right two rows. When this plan IS the ACTIVE one, there's no separate "atual" to
  // compare against (doc decision: single card in that case).
  async getLineComparison(planId: string, lineId: string) {
    const [plan, planLine, line] = await Promise.all([
      this.prisma.vehiclePlan.findUnique({
        where:  { id: planId },
        select: { status: true, scopeId: true, dayTypeId: true, dayType: { select: { code: true } } },
      }),
      this.prisma.vehiclePlanLine.findUnique({
        where:   { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
        include: { lineSchedule: { select: { status: true } } },
      }),
      this.prisma.transitLine.findUnique({
        where:  { id: lineId },
        select: { id: true, code: true, name: true, metrics: true },
      }),
    ])
    if (!plan)     throw new NotFoundException('VehiclePlan not found')
    if (!planLine) throw new NotFoundException('Line not found in this plan')
    if (!line)     throw new NotFoundException('Line not found')

    const draft = {
      planId,
      planStatus:         plan.status,
      lineScheduleStatus: planLine.lineScheduleId ? (planLine.lineSchedule?.status ?? null) : null,
      summary:            (planLine.summary as VehiclePlanLineSummary | null) ?? null,
    }

    let active: { planId: string; lineScheduleStatus: string | null; summary: VehiclePlanLineSummary | null } | null = null
    if (plan.status !== 'ACTIVE') {
      const activePlanLine = await this.prisma.vehiclePlanLine.findFirst({
        where:   { lineId, vehiclePlan: { status: 'ACTIVE', scopeId: plan.scopeId, dayTypeId: plan.dayTypeId } },
        include: { lineSchedule: { select: { status: true } } },
      })
      if (activePlanLine) {
        active = {
          planId:             activePlanLine.vehiclePlanId,
          lineScheduleStatus: activePlanLine.lineScheduleId ? (activePlanLine.lineSchedule?.status ?? null) : null,
          summary:            (activePlanLine.summary as VehiclePlanLineSummary | null) ?? null,
        }
      }
    }

    return {
      line:      { id: line.id, code: line.code, name: line.name },
      operation: this.consolidateOperation(line.metrics as any, plan.dayType?.code),
      draft,
      active,
    }
  }

  // Real hourly oferta×demanda for the "Oferta · Demanda" tab of the line comparativo
  // — this plan's actual generated trips only (never the ACTIVE counterpart: unlike
  // the Comparativo tab, this is a single series for whichever plan is loaded, doc
  // decision). Supply buckets each trip's departure hour with the same
  // capacity-per-trip formula recalculate uses for occupancyIndex (VEHICLE_TYPE_CAPACITY
  // × renewal); demand comes straight from the line's real imported demand curve.
  async getLineHourlySeries(planId: string, lineId: string) {
    const [plan, line, blockTrips] = await Promise.all([
      this.prisma.vehiclePlan.findUnique({
        where:  { id: planId },
        select: { dayType: { select: { code: true } } },
      }),
      this.prisma.transitLine.findUnique({
        where:  { id: lineId },
        select: { metrics: true },
      }),
      this.prisma.blockTrip.findMany({
        where:  { vehicleBlock: { vehiclePlanId: planId }, trip: { route: { lineId } } },
        select: {
          trip:         { select: { departureMinutes: true } },
          vehicleBlock: { select: { id: true, vehicleType: true } },
        },
      }),
    ])
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (!line) throw new NotFoundException('Line not found')

    const dayTypeCode = plan.dayType?.code
    const metrics = line.metrics as {
      renewalIndex?: { overall?: { value?: number } }
      demand?:       Record<string, Record<string, Record<string, number>>>
    } | null
    const renewal     = metrics?.renewalIndex?.overall?.value ?? 0
    const demandByDir = dayTypeCode ? metrics?.demand?.[dayTypeCode] : undefined

    const supplyByHour  = new Array(24).fill(0)
    const blockTypeById = new Map<string, typeof blockTrips[number]['vehicleBlock']['vehicleType']>()
    for (const bt of blockTrips) {
      const hour = Math.floor(bt.trip.departureMinutes / 60) % 24
      supplyByHour[hour] += (VEHICLE_TYPE_CAPACITY[bt.vehicleBlock.vehicleType] ?? 0) * (1 + renewal / 100)
      blockTypeById.set(bt.vehicleBlock.id, bt.vehicleBlock.vehicleType)
    }
    const capacities = Array.from(blockTypeById.values()).map(vt => VEHICLE_TYPE_CAPACITY[vt] ?? 0)
    const avgCapacity = capacities.length > 0 ? Math.round(capacities.reduce((a, b) => a + b, 0) / capacities.length) : 0

    const demandByHour = new Array(24).fill(0)
    for (const hourly of Object.values(demandByDir ?? {})) {
      for (const [hourStr, v] of Object.entries(hourly)) {
        demandByHour[Number(hourStr) % 24] += v
      }
    }

    const r3 = (n: number) => Math.round(n * 1000) / 1000

    const hours = Array.from({ length: 24 }, (_, hour) => {
      const demand  = Math.round(demandByHour[hour])
      const supply  = Math.round(supplyByHour[hour])
      const deficit = Math.max(0, demand - supply)
      // No vehicle running this hour but real demand exists: definitely saturated
      // (worse than any finite ratio), pinned at 2 (the chart's practical max)
      // instead of an unbounded/Infinity value that would skew peakLoadFactor.
      const loadFactor = supply > 0 ? r3(demand / supply) : (demand > 0 ? 2 : 0)
      return { hour, demand, supply, loadFactor, deficit, isPeak: this.isPeakHour(hour) }
    })

    const totalDailyDemand   = hours.reduce((s, h) => s + h.demand, 0)
    const totalDailySupply   = hours.reduce((s, h) => s + h.supply, 0)
    const avgLoadFactor      = totalDailySupply > 0 ? r3(totalDailyDemand / totalDailySupply) : 0
    const saturatedHoursCount = hours.filter(h => h.loadFactor > 1).length
    const totalUnmetDemand   = hours.reduce((s, h) => s + h.deficit, 0)
    const peakLoadFactor     = hours.reduce((m, h) => Math.max(m, h.loadFactor), 0)

    return {
      hours,
      kpis: {
        totalDailyDemand, totalDailySupply, avgLoadFactor, saturatedHoursCount, totalUnmetDemand, peakLoadFactor,
        avgCapacity, renewalIndex: renewal,
      },
    }
  }
}
