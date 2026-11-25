import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Worker } from 'worker_threads'
import * as path from 'path'
import { availableParallelism } from 'os'
import { Observable, Subject } from 'rxjs'
import { randomUUID } from 'crypto'
import type { Prisma, SolverRun } from '@prisma/client'
import type { PlanningSettings } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitGeneralConfigService } from '../../settings/transit-general-config.service'
import { VehiclePlanService } from '../vehicle-plan/vehicle-plan.service'
import { SAVE_MS, SolverRunStore, fingerprintOf, stopReasonOf, type SolverRunPatch } from '../solver-run/solver-run.store'
import { loadVehicleSolverInput } from './vehicle-solver.input'
import {
  DEFAULT_VEHICLE_SOLVER_PARAMS,
  type VehicleSolverMessage, type VehicleSolverParams, type VehicleSolverProposal, type VehicleSolverStart,
  type VehicleSolverSummary, type VehicleSolverWorkerData,
} from './vehicle-solver.types'

// "Otimizar" of the vehicle plan — runs the vehicle solver in worker threads, streams progress
// over SSE and applies the chosen proposal to the (DRAFT) plan in place.
//
// A generation belongs to the plan, not to the screen that started it: it keeps running when
// the modal closes or the page is left, and the plan screen finds it again (current) — one per
// plan, a new start replaces it. A client connecting to the stream gets the generation's state
// first (where it started, best proposal, last progress, how it ended) and then what comes next.
//
// It is saved (SolverRun, SolverRunStore) as it goes and stays until applied, discarded or
// replaced — a run left overnight is there in the morning, and one the API lost on a restart
// comes back INTERRUPTED with the best proposal saved until then. Memory holds only the live
// run (workers, SSE); once it ends and its last write lands, the saved row is all there is.
//
// The improvement is a random search and two seeds can end a vehicle or two apart, so a
// generation runs several workers from different seeds side by side (general.solverMaxSearches,
// capped at the cores − 1): they all start from the same point, the job keeps the best proposal
// of them all, its progress sums them up and it ends when the last one does.

type Done = Extract<VehicleSolverMessage, { type: 'done' | 'error' }>
type Progress = Extract<VehicleSolverMessage, { type: 'progress' }>
type StopReason = Extract<VehicleSolverMessage, { type: 'done' }>['stopReason']

// how the generation ended when its searches ended differently — the first one listed wins
const STOP_PRIORITY: StopReason[] = ['user_stopped', 'max_time', 'no_improvement', 'finished']

interface Job {
  id:          string
  planId:      string
  params:      VehicleSolverParams
  fingerprint: string
  workers:     Worker[]
  // per worker: its last progress and how it ended
  runs:        { progress: Progress | null; end: Done | null }[]
  proposals:   number
  startedAt:   number
  baseline:    VehicleSolverSummary
  // the same in every search
  start:       VehicleSolverStart | null
  best:        VehicleSolverProposal | null
  progress:    Progress | null
  // how it ended — null while running
  end:         Done | null
  endedAt:     number | null
  savedAt:     number
  live$:       Subject<VehicleSolverMessage>
}

// a generation as the screens see it — the live job, else its saved row
interface View {
  id:          string
  planId:      string
  params:      VehicleSolverParams
  fingerprint: string
  running:     boolean
  startedAt:   number
  endedAt:     number | null
  stopReason:  StopReason | null
  error:       string | null
  progress:    Progress | null
  baseline:    VehicleSolverSummary
  start:       VehicleSolverStart | null
  best:        VehicleSolverProposal | null
}

// what the plan screen needs to pick a generation up again
export interface VehicleSolverJobState {
  jobId:       string
  params:      VehicleSolverParams
  startedAt:   number
  running:     boolean
  stopReason:  StopReason | null
  error:       string | null
  progress:    Progress | null
  hasProposal: boolean
  // the plan as it was when the generation started
  baseline:    VehicleSolverSummary
  // where the search started — null until the first search gets there
  start:       VehicleSolverStart | null
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
  stopReason:  StopReason | null
  error:       string | null
  hasProposal: boolean
}

@Injectable()
export class VehicleSolverService {
  private readonly logger = new Logger(VehicleSolverService.name)
  private readonly jobs   = new Map<string, Job>()
  // planId → its live generation's jobId
  private readonly current = new Map<string, string>()

  constructor(
    private readonly prisma:        PrismaService,
    private readonly generalConfig: TransitGeneralConfigService,
    private readonly vehiclePlans:  VehiclePlanService,
    private readonly saved:         SolverRunStore,
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

  // What a proposal is built on: the trips (times, routes, groups) and the locked blocks — the
  // rest of the plan is what the proposal replaces
  private async fingerprint(planId: string): Promise<string> {
    const [trips, blocks] = await Promise.all([
      this.prisma.transitTrip.findMany({
        where:   { vehiclePlanId: planId },
        select:  { id: true, departureMinutes: true, arrivalMinutes: true, routeId: true, bundleId: true, requiredVehicleType: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.vehicleBlock.findMany({
        where:   { vehiclePlanId: planId },
        select:  { id: true, constraints: true, blockTrips: { select: { tripId: true }, orderBy: { tripId: 'asc' } } },
        orderBy: { id: 'asc' },
      }),
    ])
    const locked = blocks.filter(b => (b.constraints as { locked?: boolean } | null)?.locked).map(b => [b.id, b.blockTrips.map(t => t.tripId)])
    return fingerprintOf([trips, locked])
  }

  async start(planId: string, jobId: string, rawParams: Partial<VehicleSolverParams> | undefined, user: AuthUser | undefined): Promise<void> {
    if (!jobId) throw new BadRequestException('jobId obrigatório')
    await this.assertCanSolve(planId, user)
    const params = { ...DEFAULT_VEHICLE_SOLVER_PARAMS, ...rawParams }
    const { settings } = await this.vehiclePlans.resolveSettings(planId)
    const [{ input, baseline }, fingerprint, { solverMaxSearches }] = await Promise.all([
      loadVehicleSolverInput(this.prisma, this.generalConfig, planId, settings, withDirection(settings, params.direction), params),
      this.fingerprint(planId),
      this.generalConfig.get(),
    ])

    // one generation per plan: a new one replaces the previous (its row too)
    const previous = this.current.get(planId)
    if (previous) this.drop(previous)
    await this.saved.begin('VEHICLE', planId, jobId, { params, fingerprint, baseline, userId: user?.id })

    const searches = Math.max(1, Math.min(solverMaxSearches, availableParallelism() - 1))
    const isTs    = __filename.endsWith('.ts')
    const seed    = Date.now()
    const workers = Array.from({ length: searches }, (_, i) => new Worker(path.join(__dirname, `vehicle-solver.worker${isTs ? '.ts' : '.js'}`), {
      workerData: { input, seed: seed + i * 7919 } satisfies VehicleSolverWorkerData,
      execArgv:   isTs ? ['-r', '@swc-node/register', '-r', 'tsconfig-paths/register'] : [],
    }))
    const job: Job = {
      id: jobId, planId, params, fingerprint, workers, runs: workers.map(() => ({ progress: null, end: null })), proposals: 0,
      startedAt: Date.now(), baseline, start: null, best: null, progress: null, end: null, endedAt: null, savedAt: Date.now(),
      live$: new Subject(),
    }
    this.jobs.set(jobId, job)
    this.current.set(planId, jobId)

    // the last write, then memory lets go — the row is the generation from here on
    const finish = (end: Done) => {
      if (job.end) return
      job.end = end
      job.endedAt = Date.now()
      job.live$.next(end)
      job.live$.complete()
      for (const w of workers) void w.terminate()
      const patch: SolverRunPatch = end.type === 'done' ? { status: 'DONE', stopReason: end.stopReason } : { status: 'ERROR', error: end.message }
      void this.save(job, patch).then(() => { if (this.jobs.get(jobId) === job) this.drop(jobId) })
    }
    // a search ended: the generation ends with the last one — an error only when they all failed
    const ended = (i: number, end: Done) => {
      if (job.runs[i].end) return
      job.runs[i].end = end
      if (end.type === 'error') this.logger.warn(`Vehicle solver search ${i} of job ${jobId} failed: ${end.message}`)
      const ends = job.runs.map(r => r.end)
      if (ends.some(e => !e)) return
      const done = ends.filter((e): e is Extract<Done, { type: 'done' }> => e!.type === 'done')
      finish(done.length
        ? {
            type: 'done',
            stopReason: STOP_PRIORITY.find(r => done.some(d => d.stopReason === r))!,
            elapsed: Date.now() - job.startedAt,
            attempts: done.reduce((n, d) => n + d.attempts, 0),
          }
        : ends[0]!)
    }
    workers.forEach((worker, i) => {
      worker.on('message', (msg: VehicleSolverMessage) => {
        if (msg.type === 'done' || msg.type === 'error') return ended(i, msg)
        if (msg.type === 'start') {
          if (job.start) return
          job.start = msg.start
          job.live$.next(msg)
          void this.saved.save(jobId, { start: job.start })
        } else if (msg.type === 'proposal') {
          // only a better proposal than every search's so far goes out (they all start alike)
          if (job.best && msg.proposal.rank <= job.best.rank) return
          job.best = { ...msg.proposal, index: ++job.proposals }
          job.live$.next({ type: 'proposal', proposal: job.best })
          void this.checkpoint(job)
        } else {
          job.runs[i].progress = msg
          job.progress = combineProgress(job.runs.flatMap(r => r.progress ?? []))
          job.live$.next(job.progress)
          void this.checkpoint(job)
        }
      })
      worker.on('error', err => {
        this.logger.error(`Vehicle solver worker error for job ${jobId}`, err)
        ended(i, { type: 'error', message: err.message })
      })
    })
  }

  // the best proposal and the progress, at most every SAVE_MS while the run goes
  private checkpoint(job: Job): Promise<void> {
    return Date.now() - job.savedAt < SAVE_MS ? Promise.resolve() : this.save(job)
  }

  private save(job: Job, patch: SolverRunPatch = {}): Promise<void> {
    job.savedAt = Date.now()
    return this.saved.save(job.id, { progress: job.progress, best: job.best, ...patch })
  }

  private async view(planId: string): Promise<View | null> {
    const job = this.jobs.get(this.current.get(planId) ?? '')
    if (job) return viewOfJob(job)
    const run = await this.saved.find('VEHICLE', planId)
    return run && viewOfRun(run)
  }

  private async viewById(jobId: string): Promise<View | null> {
    const job = this.jobs.get(jobId)
    if (job) return viewOfJob(job)
    const run = await this.saved.get(jobId)
    return run?.vehiclePlanId ? viewOfRun(run) : null
  }

  // the plan's generation (running, or ended and not yet applied/discarded)
  async getCurrent(planId: string): Promise<VehicleSolverJobState | null> {
    const v = await this.view(planId)
    if (!v) return null
    return {
      jobId: v.id, params: v.params, startedAt: v.startedAt, running: v.running, stopReason: v.stopReason, error: v.error,
      progress: v.progress, hasProposal: !!v.best, baseline: v.baseline, start: v.start,
      affectedCrewPlans: await this.affectedCrewPlans(planId),
    }
  }

  private async affectedCrewPlans(planId: string): Promise<number> {
    const blocks = await this.prisma.vehicleBlock.findMany({ where: { vehiclePlanId: planId }, select: { id: true, constraints: true } })
    const replaced = blocks.filter(b => !(b.constraints as { locked?: boolean } | null)?.locked).map(b => b.id)
    if (!replaced.length) return 0
    return this.prisma.crewPlan.count({
      where: { vehiclePlanId: planId, duties: { some: { pieces: { some: { vehicleBlockId: { in: replaced } } } } } },
    })
  }

  // every plan's generation — running, or ended and not yet used — newest first
  async listJobs(): Promise<VehicleSolverJobListItem[]> {
    const runs = await this.saved.list('VEHICLE')
    if (!runs.length) return []
    const plans = await this.prisma.vehiclePlan.findMany({
      where:  { id: { in: runs.flatMap(r => r.vehiclePlanId ?? []) } },
      select: { id: true, description: true, scope: { select: { name: true } }, dayType: { select: { name: true } } },
    })
    const byId = new Map(plans.map(p => [p.id, p]))
    return runs.map(run => {
      const job = this.jobs.get(run.id)
      const v = job ? viewOfJob(job) : viewOfRun(run)
      const p = byId.get(v.planId)
      return {
        jobId: v.id, planId: v.planId,
        planLabel: p ? [p.description || 'Planejamento', p.scope?.name, p.dayType?.name].filter(Boolean).join(' · ') : 'Planejamento',
        running: v.running, startedAt: v.startedAt, endedAt: v.endedAt,
        elapsed: (v.endedAt ?? Date.now()) - v.startedAt,
        stopReason: v.stopReason, error: v.error, hasProposal: !!v.best,
      }
    })
  }

  // stops the run if needed and forgets it
  async discard(planId: string, jobId: string): Promise<void> {
    const v = await this.viewById(jobId)
    if (v?.planId !== planId) return
    this.drop(jobId)
    await this.saved.remove(jobId)
  }

  // the live part only — the saved row stays
  private drop(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (!job.end) {
      job.live$.complete()
      for (const w of job.workers) void w.terminate()
    }
    this.jobs.delete(jobId)
    if (this.current.get(job.planId) === jobId) this.current.delete(job.planId)
  }

  // the generation's state first (where it started, best proposal, last progress, its end), then
  // what comes next while it runs; proposals go out without their blocks — the client only shows
  // the summary
  stream(jobId: string): Observable<{ data: string }> {
    const out = (msg: VehicleSolverMessage) => ({
      data: JSON.stringify(msg.type === 'proposal' ? { ...msg, proposal: { ...msg.proposal, blocks: undefined } } : msg),
    })
    return new Observable(subscriber => {
      let sub: { unsubscribe(): void } | null = null
      let closed = false
      void (async () => {
        const job = this.jobs.get(jobId)
        const v = job ? viewOfJob(job) : await this.viewById(jobId).catch(() => null)
        if (closed) return
        if (!v) return subscriber.complete()
        if (v.start)    subscriber.next(out({ type: 'start', start: v.start }))
        if (v.best)     subscriber.next(out({ type: 'proposal', proposal: v.best }))
        if (v.progress) subscriber.next(out(v.progress))
        if (job && !job.end) {
          sub = job.live$.subscribe({
            next:     msg => subscriber.next(out(msg)),
            error:    err => subscriber.error(err),
            complete: () => subscriber.complete(),
          })
          return
        }
        if (v.error) subscriber.next(out({ type: 'error', message: v.error }))
        else if (v.stopReason) subscriber.next(out({ type: 'done', stopReason: v.stopReason, elapsed: (v.endedAt ?? v.startedAt) - v.startedAt, attempts: v.progress?.attempts ?? 0 }))
        subscriber.complete()
      })()
      return () => { closed = true; sub?.unsubscribe() }
    })
  }

  stop(jobId: string): void {
    for (const w of this.jobs.get(jobId)?.workers ?? []) {
      try { w.postMessage({ type: 'stop' }) } catch { /* already done */ }
    }
  }

  // The proposal replaces the plan's rebuilt blocks in place: the locked ones stay with their
  // numbers, the rest go — with their trips, deadruns and intervals
  // — and the proposal's blocks take the free numbers in its order (main line, then start —
  // toProposalBlocks). Then recalculate(). Refused when the plan changed since the generation
  // read it (trips, locked blocks — fingerprint).
  async accept(planId: string, jobId: string, user: AuthUser | undefined): Promise<void> {
    const v = await this.viewById(jobId)
    if (!v || v.planId !== planId) throw new NotFoundException('Geração não encontrada ou expirada')
    const { best } = v
    if (!best) throw new BadRequestException('Nenhuma proposta disponível ainda')
    await this.assertCanSolve(planId, user)

    const [blocks, fingerprint, general] = await Promise.all([
      this.prisma.vehicleBlock.findMany({ where: { vehiclePlanId: planId }, select: { id: true, blockNumber: true, constraints: true } }),
      this.fingerprint(planId),
      this.generalConfig.get(),
    ])
    if (fingerprint !== v.fingerprint) throw new BadRequestException('O planejamento mudou desde a geração — gere novamente')
    const kept = blocks.filter(b => !!(b.constraints as { locked?: boolean } | null)?.locked)
    const keptIds = new Set(kept.map(b => b.id))
    // a trip group's own intervals keep their type
    if (best.blocks.some(b => b.intervals.some(iv => !iv.intervalTypeId)) && !general.defaultIntervalTypeId) {
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
      for (const iv of b.intervals) {
        intervalRows.push({ vehicleBlockId: id, intervalTypeId: iv.intervalTypeId ?? general.defaultIntervalTypeId!, departureMinutes: iv.departureMinutes, arrivalMinutes: iv.arrivalMinutes, bundleId: iv.bundleId })
      }
    }

    await this.prisma.$transaction([
      // cascades to their trips, deadruns and intervals; crew pieces on them lose the block
      this.prisma.vehicleBlock.deleteMany({ where: { vehiclePlanId: planId, id: { notIn: [...keptIds] } } }),
      this.prisma.vehicleBlock.createMany({ data: blockRows }),
      this.prisma.blockTrip.createMany({ data: tripRows }),
      this.prisma.blockDeadrun.createMany({ data: deadrunRows }),
      this.prisma.blockInterval.createMany({ data: intervalRows }),
    ])
    await this.saved.remove(jobId)
    await this.vehiclePlans.recalculate(planId)
  }
}

function viewOfJob(job: Job): View {
  return {
    id: job.id, planId: job.planId, params: job.params, fingerprint: job.fingerprint, running: !job.end,
    startedAt: job.startedAt, endedAt: job.endedAt,
    stopReason: job.end?.type === 'done' ? job.end.stopReason : null,
    error:      job.end?.type === 'error' ? job.end.message : null,
    progress: job.progress, baseline: job.baseline, start: job.start, best: job.best,
  }
}

// a row still RUNNING without its live job is another process's run, or one this process is
// about to mark INTERRUPTED — shown as running
function viewOfRun(run: SolverRun): View {
  return {
    id: run.id, planId: run.vehiclePlanId!, params: run.params as unknown as VehicleSolverParams, fingerprint: run.fingerprint,
    running: run.status === 'RUNNING', startedAt: run.startedAt.getTime(), endedAt: run.endedAt?.getTime() ?? null,
    stopReason: stopReasonOf(run), error: run.error,
    progress: run.progress as Progress | null, baseline: run.baseline as unknown as VehicleSolverSummary,
    start: run.start as VehicleSolverStart | null, best: run.best as VehicleSolverProposal | null,
  }
}

// the searches' progress as one: attempts and improvements add up, the best score is the best
// one, the time since an improvement is the most recent search's
function combineProgress(list: Progress[]): Progress {
  return {
    type: 'progress',
    elapsed:          Math.max(...list.map(p => p.elapsed)),
    attempts:         list.reduce((n, p) => n + p.attempts, 0),
    improvements:     list.reduce((n, p) => n + p.improvements, 0),
    bestScore:        Math.max(...list.map(p => p.bestScore)),
    sinceImprovement: Math.min(...list.map(p => p.sinceImprovement)),
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
