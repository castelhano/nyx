import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Worker } from 'worker_threads'
import * as path from 'path'
import { Observable, Subject } from 'rxjs'
import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import type { PlanningSettings } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitGeneralConfigService } from '../../settings/transit-general-config.service'
import { VehiclePlanService } from '../vehicle-plan/vehicle-plan.service'
import { loadVehicleSolverInput } from './vehicle-solver.input'
import {
  DEFAULT_VEHICLE_SOLVER_PARAMS,
  type VehicleSolverMessage, type VehicleSolverParams, type VehicleSolverProposal, type VehicleSolverSummary,
} from './vehicle-solver.types'

// "Otimizar" of the vehicle plan — runs the vehicle solver in a worker thread, streams progress
// over SSE and applies the chosen proposal to the (DRAFT) plan in place.
//
// A generation belongs to the plan, not to the screen that started it: it keeps running when
// the modal closes or the page is left, and the plan screen finds it again (current) — one per
// plan, a new start replaces it. A client connecting to the stream gets the job's state first
// (best proposal, last progress, how it ended) and then what comes next. Jobs live in memory
// (a restart loses them), until applied, discarded or 30 min after the run ends.

const KEEP_MS = 30 * 60 * 1000

type Done = Extract<VehicleSolverMessage, { type: 'done' | 'error' }>

interface Job {
  id:        string
  planId:    string
  params:    VehicleSolverParams
  worker:    Worker
  startedAt: number
  baseline:  VehicleSolverSummary
  best:      VehicleSolverProposal | null
  progress:  Extract<VehicleSolverMessage, { type: 'progress' }> | null
  // how it ended — null while running
  end:       Done | null
  endedAt:   number | null
  live$:     Subject<VehicleSolverMessage>
}

// what the plan screen needs to pick a generation up again
export interface VehicleSolverJobState {
  jobId:       string
  params:      VehicleSolverParams
  startedAt:   number
  running:     boolean
  stopReason:  Extract<VehicleSolverMessage, { type: 'done' }>['stopReason'] | null
  error:       string | null
  progress:    Extract<VehicleSolverMessage, { type: 'progress' }> | null
  hasProposal: boolean
  // the plan as it was when the generation started
  baseline:    VehicleSolverSummary
  // crew plans with pieces on blocks the proposal replaces — they'd lose them (isStale)
  affectedCrewPlans: number
}

// one line of the app-wide background generations list (topbar)
export interface VehicleSolverJobListItem {
  jobId:       string
  planId:      string
  planLabel:   string
  running:     boolean
  startedAt:   number
  endedAt:     number | null
  elapsed:     number
  stopReason:  VehicleSolverJobState['stopReason']
  error:       string | null
  hasProposal: boolean
}

@Injectable()
export class VehicleSolverService {
  private readonly logger = new Logger(VehicleSolverService.name)
  private readonly jobs   = new Map<string, Job>()
  // planId → its generation's jobId
  private readonly current = new Map<string, string>()

  constructor(
    private readonly prisma:        PrismaService,
    private readonly generalConfig: TransitGeneralConfigService,
    private readonly vehiclePlans:  VehiclePlanService,
  ) {}

  // The solver rewrites blocks of every operator of the Scope — only a user with access to all
  // of them (or an admin) may run it
  async assertCanSolve(planId: string, user: AuthUser | undefined): Promise<void> {
    const plan = await this.prisma.vehiclePlan.findUnique({
      where:  { id: planId },
      select: { status: true, constraints: true, scope: { select: { operators: { select: { branchId: true } } } } },
    })
    if (!plan) throw new NotFoundException('VehiclePlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Só um planejamento em rascunho pode ser otimizado — duplique o ativo e otimize a cópia')
    if ((plan.constraints as { locked?: boolean } | null)?.locked) throw new BadRequestException('Planejamento travado')
    if (user && user.role !== 'admin' && plan.scope.operators.some(o => !user.branchIds.includes(o.branchId))) {
      throw new ForbiddenException('Otimizar exige acesso a todas as empresas do escopo do planejamento')
    }
  }

  async start(planId: string, jobId: string, rawParams: Partial<VehicleSolverParams> | undefined, user: AuthUser | undefined): Promise<void> {
    if (!jobId) throw new BadRequestException('jobId obrigatório')
    await this.assertCanSolve(planId, user)
    const params = { ...DEFAULT_VEHICLE_SOLVER_PARAMS, ...rawParams }
    const { settings } = await this.vehiclePlans.resolveSettings(planId)
    const { input, baseline } = await loadVehicleSolverInput(this.prisma, this.generalConfig, planId, settings, withDirection(settings, params.direction), params)

    const isTs   = __filename.endsWith('.ts')
    const worker = new Worker(path.join(__dirname, `vehicle-solver.worker${isTs ? '.ts' : '.js'}`), {
      workerData: input,
      execArgv:   isTs ? ['-r', '@swc-node/register', '-r', 'tsconfig-paths/register'] : [],
    })
    // one generation per plan: a new one replaces the previous
    const previous = this.current.get(planId)
    if (previous) this.drop(previous)

    const job: Job = { id: jobId, planId, params, worker, startedAt: Date.now(), baseline, best: null, progress: null, end: null, endedAt: null, live$: new Subject() }
    this.jobs.set(jobId, job)
    this.current.set(planId, jobId)

    const finish = (end: Done) => {
      if (job.end) return
      job.end = end
      job.endedAt = Date.now()
      job.live$.next(end)
      job.live$.complete()
      void worker.terminate()
      setTimeout(() => { if (this.jobs.get(jobId) === job) this.drop(jobId) }, KEEP_MS)
    }
    worker.on('message', (msg: VehicleSolverMessage) => {
      if (msg.type === 'proposal') job.best = msg.proposal
      if (msg.type === 'progress') job.progress = msg
      if (msg.type === 'done' || msg.type === 'error') finish(msg)
      else job.live$.next(msg)
    })
    worker.on('error', err => {
      this.logger.error(`Vehicle solver worker error for job ${jobId}`, err)
      finish({ type: 'error', message: err.message })
    })
  }

  // the plan's generation (running, or ended and not yet applied/discarded)
  async getCurrent(planId: string): Promise<VehicleSolverJobState | null> {
    const job = this.jobs.get(this.current.get(planId) ?? '')
    if (!job) return null
    return {
      jobId: job.id, params: job.params, startedAt: job.startedAt, running: !job.end,
      stopReason: job.end?.type === 'done' ? job.end.stopReason : null,
      error:      job.end?.type === 'error' ? job.end.message : null,
      progress: job.progress, hasProposal: !!job.best, baseline: job.baseline,
      affectedCrewPlans: await this.affectedCrewPlans(planId, job.params),
    }
  }

  private async affectedCrewPlans(planId: string, params: VehicleSolverParams): Promise<number> {
    const blocks = await this.prisma.vehicleBlock.findMany({ where: { vehiclePlanId: planId }, select: { id: true, constraints: true } })
    const replaced = blocks.filter(b => params.base === 'scratch' || !(b.constraints as { locked?: boolean } | null)?.locked).map(b => b.id)
    if (!replaced.length) return 0
    return this.prisma.crewPlan.count({
      where: { vehiclePlanId: planId, duties: { some: { pieces: { some: { vehicleBlockId: { in: replaced } } } } } },
    })
  }

  // every plan's generation — running, or ended and not yet used — newest first
  async listJobs(): Promise<VehicleSolverJobListItem[]> {
    const jobs = [...this.current.values()].flatMap(id => this.jobs.get(id) ?? [])
    if (!jobs.length) return []
    const plans = await this.prisma.vehiclePlan.findMany({
      where:  { id: { in: jobs.map(j => j.planId) } },
      select: { id: true, description: true, scope: { select: { name: true } }, dayType: { select: { name: true } } },
    })
    const byId = new Map(plans.map(p => [p.id, p]))
    return jobs
      .map(job => {
        const p = byId.get(job.planId)
        return {
          jobId: job.id, planId: job.planId,
          planLabel: p ? [p.description || 'Planejamento', p.scope?.name, p.dayType?.name].filter(Boolean).join(' · ') : 'Planejamento',
          running: !job.end, startedAt: job.startedAt, endedAt: job.endedAt,
          elapsed: (job.endedAt ?? Date.now()) - job.startedAt,
          stopReason: job.end?.type === 'done' ? job.end.stopReason : null,
          error:      job.end?.type === 'error' ? job.end.message : null,
          hasProposal: !!job.best,
        }
      })
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  // stops the run if needed and forgets it
  discard(planId: string, jobId: string): void {
    if (this.jobs.get(jobId)?.planId === planId) this.drop(jobId)
  }

  private drop(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (!job.end) {
      job.live$.complete()
      void job.worker.terminate()
    }
    this.jobs.delete(jobId)
    if (this.current.get(job.planId) === jobId) this.current.delete(job.planId)
  }

  // the job's state first (best proposal, last progress, its end), then what comes next;
  // proposals go out without their blocks — the client only shows the summary
  stream(jobId: string): Observable<{ data: string }> {
    const job = this.jobs.get(jobId)
    if (!job) return new Observable(s => s.complete())
    const out = (msg: VehicleSolverMessage) => ({
      data: JSON.stringify(msg.type === 'proposal' ? { ...msg, proposal: { ...msg.proposal, blocks: undefined } } : msg),
    })
    return new Observable(subscriber => {
      if (job.best)     subscriber.next(out({ type: 'proposal', proposal: job.best }))
      if (job.progress) subscriber.next(out(job.progress))
      if (job.end) {
        subscriber.next(out(job.end))
        subscriber.complete()
        return
      }
      const sub = job.live$.subscribe({
        next:     msg => subscriber.next(out(msg)),
        error:    err => subscriber.error(err),
        complete: () => subscriber.complete(),
      })
      return () => sub.unsubscribe()
    })
  }

  stop(jobId: string): void {
    try { this.jobs.get(jobId)?.worker.postMessage({ type: 'stop' }) } catch { /* already done */ }
  }

  // The proposal replaces the plan's rebuilt blocks in place: the locked ones (Respeita
  // travadas) stay with their numbers, the rest go — with their trips, deadruns and intervals
  // — and the proposal's blocks take the free numbers in its order (main line, then start —
  // toProposalBlocks). Then recalculate().
  async accept(planId: string, jobId: string, user: AuthUser | undefined): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job || job.planId !== planId) throw new NotFoundException('Geração não encontrada ou expirada')
    if (!job.best) throw new BadRequestException('Nenhuma proposta disponível ainda')
    await this.assertCanSolve(planId, user)
    const { best, params } = job

    const [blocks, planTripIds, general] = await Promise.all([
      this.prisma.vehicleBlock.findMany({
        where:  { vehiclePlanId: planId },
        select: { id: true, blockNumber: true, constraints: true, blockTrips: { select: { tripId: true } } },
      }),
      this.prisma.transitTrip.findMany({ where: { vehiclePlanId: planId }, select: { id: true } }),
      this.generalConfig.get(),
    ])
    const kept = blocks.filter(b => params.base === 'complete' && !!(b.constraints as { locked?: boolean } | null)?.locked)
    const keptIds = new Set(kept.map(b => b.id))

    // the plan must still be the one the generation read: same trips, same locked blocks
    const proposed = best.blocks.flatMap(b => b.tripIds)
    const covered  = new Set([...proposed, ...kept.flatMap(b => b.blockTrips.map(bt => bt.tripId))])
    if (covered.size !== planTripIds.length || proposed.length + kept.reduce((s, b) => s + b.blockTrips.length, 0) !== covered.size
      || planTripIds.some(t => !covered.has(t.id))) {
      throw new BadRequestException('O planejamento mudou desde a geração — gere novamente')
    }
    if (best.blocks.some(b => b.intervals.length) && !general.defaultIntervalTypeId) {
      throw new BadRequestException('Tipo de intervalo padrão não configurado')
    }
    this.drop(jobId)

    const taken = new Set(kept.map(b => b.blockNumber))
    let next = 1
    const nextNumber = () => {
      while (taken.has(next)) next++
      taken.add(next)
      return next
    }

    const blockRows: Prisma.VehicleBlockCreateManyInput[] = []
    const tripRows: Prisma.BlockTripCreateManyInput[] = []
    const deadrunRows: Prisma.BlockDeadrunCreateManyInput[] = []
    const intervalRows: Prisma.BlockIntervalCreateManyInput[] = []
    for (const b of best.blocks) {
      const id = randomUUID()
      blockRows.push({ id, vehiclePlanId: planId, blockNumber: nextNumber(), depotId: b.depotId, branchId: b.branchId, vehicleType: b.vehicleType, isStale: true })
      b.tripIds.forEach((tripId, i) => tripRows.push({ vehicleBlockId: id, tripId, sequence: i + 1 }))
      for (const d of b.deadruns) deadrunRows.push({ vehicleBlockId: id, ...d })
      for (const iv of b.intervals) intervalRows.push({ vehicleBlockId: id, intervalTypeId: general.defaultIntervalTypeId!, ...iv })
    }

    await this.prisma.$transaction([
      // cascades to their trips, deadruns and intervals; crew pieces on them lose the block
      this.prisma.vehicleBlock.deleteMany({ where: { vehiclePlanId: planId, id: { notIn: [...keptIds] } } }),
      this.prisma.vehicleBlock.createMany({ data: blockRows }),
      this.prisma.blockTrip.createMany({ data: tripRows }),
      this.prisma.blockDeadrun.createMany({ data: deadrunRows }),
      this.prisma.blockInterval.createMany({ data: intervalRows }),
    ])
    await this.vehiclePlans.recalculate(planId)
  }
}

// the chosen direction reweights the plan-level criteria the score is built from
function withDirection(settings: PlanningSettings, direction: VehicleSolverParams['direction']): PlanningSettings {
  if (direction === 'balanced') return settings
  const next: PlanningSettings = JSON.parse(JSON.stringify(settings))
  if (direction === 'fleet') {
    next.anchored.fleetUsage.active = true
    next.anchored.fleetUsage.weight *= 2
  } else {
    next.anchored.totalKm.active = true
    next.anchored.totalKm.weight *= 2
    next.range.deadrunRatio.modifier *= 2
  }
  return next
}
