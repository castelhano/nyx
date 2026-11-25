import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Worker } from 'worker_threads'
import * as path from 'path'
import { availableParallelism } from 'os'
import { Observable, Subject } from 'rxjs'
import { randomUUID } from 'crypto'
import { Prisma, type SolverRun } from '@prisma/client'
import { CREW_ROLES, type CrewRole, type CrewSettings } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitGeneralConfigService } from '../../settings/transit-general-config.service'
import { CrewPlanService } from '../crew-plan/crew-plan.service'
import { SAVE_MS, SolverRunStore, fingerprintOf, stopReasonOf, type SolverRunPatch } from '../solver-run/solver-run.store'
import { loadCrewSolverInput } from './crew-solver.input'
import { solverRank } from '../crew-plan/crew-scoring.calc'
import {
  DEFAULT_CREW_SOLVER_PARAMS,
  type CrewSolverMessage, type CrewSolverParams, type CrewSolverProposal, type CrewSolverWorkerData,
} from './crew-solver.types'

// "Otimizar › Gerar escala" — runs the crew solver in worker threads, streams progress
// over SSE and turns the chosen proposal into duties (in place on a DRAFT, else a new version).
//
// A generation belongs to the crew plan, not to the screen that started it: it keeps running
// when the modal closes or the page is left, and the plan screen finds it again (current) —
// one per crew plan, a new start replaces it. A client connecting to the stream gets the
// generation's state first (best proposal, last progress, how it ended) and then what comes next.
//
// It is saved (SolverRun, SolverRunStore) as it goes and stays until accepted, discarded or
// replaced — a run left overnight is there in the morning, and one the API lost on a restart
// comes back INTERRUPTED with the best proposal saved until then. Memory holds only the live
// run (workers, SSE); once it ends and its last write lands, the saved row is all there is.
//
// The improvement is a random search and two seeds can end ~30 duties apart, so a generation
// runs several workers from different seeds side by side (general.solverMaxSearches, capped at
// the cores − 1): the job keeps the best proposal of them all, its progress sums them up and it
// ends when the last one does.

type Done = Extract<CrewSolverMessage, { type: 'done' | 'error' }>
type Progress = Extract<CrewSolverMessage, { type: 'progress' }>
type StopReason = Extract<CrewSolverMessage, { type: 'done' }>['stopReason']

// how the generation ended when its searches ended differently — the first one listed wins
const STOP_PRIORITY: StopReason[] = ['user_stopped', 'max_time', 'no_improvement', 'finished']

interface Job {
  id:          string
  crewPlanId:  string
  params:      CrewSolverParams
  fingerprint: string
  workers:     Worker[]
  // per worker: its last progress and how it ended
  runs:        { progress: Progress | null; end: Done | null }[]
  proposals:   number
  startedAt:   number
  best:        CrewSolverProposal | null
  progress:    Progress | null
  // how it ended — null while running
  end:         Done | null
  endedAt:     number | null
  savedAt:     number
  live$:       Subject<CrewSolverMessage>
}

// a generation as the screens see it — the live job, else its saved row
interface View {
  id:          string
  crewPlanId:  string
  params:      CrewSolverParams
  fingerprint: string
  running:     boolean
  startedAt:   number
  endedAt:     number | null
  stopReason:  StopReason | null
  error:       string | null
  progress:    Progress | null
  best:        CrewSolverProposal | null
}

// what the plan screen needs to pick a generation up again
export interface CrewSolverJobState {
  jobId:       string
  params:      CrewSolverParams
  startedAt:   number
  running:     boolean
  stopReason:  StopReason | null
  error:       string | null
  progress:    Progress | null
  hasProposal: boolean
}

// one line of the app-wide background generations list (topbar)
export interface CrewSolverJobListItem {
  jobId:       string
  crewPlanId:  string
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
export class CrewSolverService {
  private readonly logger = new Logger(CrewSolverService.name)
  private readonly jobs   = new Map<string, Job>()
  // crewPlanId → its live generation's jobId
  private readonly current = new Map<string, string>()

  constructor(
    private readonly prisma:        PrismaService,
    private readonly crewPlans:     CrewPlanService,
    private readonly generalConfig: TransitGeneralConfigService,
    private readonly saved:         SolverRunStore,
  ) {}

  // What a proposal is built on: the vehicle plan's blocks as the crew sees them (trips,
  // deadruns, intervals) and, with base complete, the locked duties it keeps
  private async fingerprint(crewPlanId: string, params: CrewSolverParams): Promise<string> {
    const plan = await this.prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { vehiclePlanId: true } })
    if (!plan) throw new NotFoundException('crewPlan not found')
    const [blocks, locked] = await Promise.all([
      this.prisma.vehicleBlock.findMany({
        where:   { vehiclePlanId: plan.vehiclePlanId },
        orderBy: { id: 'asc' },
        select: {
          id: true, depotId: true, branchId: true,
          blockTrips:     { orderBy: { sequence: 'asc' }, select: { tripId: true, trip: { select: { departureMinutes: true, arrivalMinutes: true, routeId: true } } } },
          blockDeadruns:  { orderBy: { departureMinutes: 'asc' }, select: { type: true, departureMinutes: true, arrivalMinutes: true, originLocalityId: true, destinationLocalityId: true } },
          blockIntervals: { orderBy: { departureMinutes: 'asc' }, select: { departureMinutes: true, arrivalMinutes: true } },
        },
      }),
      params.base === 'complete'
        ? this.prisma.duty.findMany({
            where:   { crewPlanId, constraints: { path: ['locked'], equals: true } },
            orderBy: { id: 'asc' },
            select:  { id: true, pieces: { orderBy: { sequence: 'asc' }, select: { vehicleBlockId: true, startMinutes: true, endMinutes: true } } },
          })
        : Promise.resolve([]),
    ])
    return fingerprintOf([blocks, locked])
  }

  async start(crewPlanId: string, jobId: string, rawParams: Partial<CrewSolverParams> | undefined, user: AuthUser | undefined): Promise<void> {
    if (!jobId) throw new BadRequestException('jobId obrigatório')
    const params = { ...DEFAULT_CREW_SOLVER_PARAMS, ...rawParams }
    const { settings } = await this.crewPlans.resolveSettings(crewPlanId)
    const [input, fingerprint, { solverMaxSearches }] = await Promise.all([
      loadCrewSolverInput(this.prisma, crewPlanId, withDirection(settings, params.direction), { limitToCrew: params.limitToCrew }),
      this.fingerprint(crewPlanId, params),
      this.generalConfig.get(),
    ])
    if (params.base === 'scratch') input.locked = []

    // one generation per crew plan: a new one replaces the previous (its row too)
    const previous = this.current.get(crewPlanId)
    if (previous) this.drop(previous)
    await this.saved.begin('CREW', crewPlanId, jobId, { params, fingerprint, userId: user?.id })

    const searches = Math.max(1, Math.min(solverMaxSearches, availableParallelism() - 1))
    const isTs    = __filename.endsWith('.ts')
    const seed    = Date.now()
    // the construction has no seed: without the improvement one search is enough
    const workers = Array.from({ length: params.optimize ? searches : 1 }, (_, i) => new Worker(path.join(__dirname, `crew-solver.worker${isTs ? '.ts' : '.js'}`), {
      workerData: { input, seed: seed + i * 7919, optimize: params.optimize } satisfies CrewSolverWorkerData,
      execArgv:   isTs ? ['-r', '@swc-node/register', '-r', 'tsconfig-paths/register'] : [],
    }))
    const job: Job = {
      id: jobId, crewPlanId, params, fingerprint, workers, runs: workers.map(() => ({ progress: null, end: null })), proposals: 0,
      startedAt: Date.now(), best: null, progress: null, end: null, endedAt: null, savedAt: Date.now(), live$: new Subject(),
    }
    this.jobs.set(jobId, job)
    this.current.set(crewPlanId, jobId)

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
      if (end.type === 'error') this.logger.warn(`Crew solver search ${i} of job ${jobId} failed: ${end.message}`)
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
      worker.on('message', (msg: CrewSolverMessage) => {
        if (msg.type === 'done' || msg.type === 'error') return ended(i, msg)
        if (msg.type === 'proposal') {
          // only a better proposal than every search's so far goes out (the construction is the
          // same in all of them)
          if (job.best && rankOf(msg.proposal) <= rankOf(job.best)) return
          job.best = { ...msg.proposal, index: ++job.proposals }
          job.live$.next({ type: 'proposal', proposal: job.best })
        } else {
          job.runs[i].progress = msg
          job.progress = combineProgress(job.runs.flatMap(r => r.progress ?? []))
          job.live$.next(job.progress)
        }
        void this.checkpoint(job)
      })
      worker.on('error', err => {
        this.logger.error(`Crew solver worker error for job ${jobId}`, err)
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

  private async view(crewPlanId: string): Promise<View | null> {
    const job = this.jobs.get(this.current.get(crewPlanId) ?? '')
    if (job) return viewOfJob(job)
    const run = await this.saved.find('CREW', crewPlanId)
    return run && viewOfRun(run)
  }

  private async viewById(jobId: string): Promise<View | null> {
    const job = this.jobs.get(jobId)
    if (job) return viewOfJob(job)
    const run = await this.saved.get(jobId)
    return run?.crewPlanId ? viewOfRun(run) : null
  }

  // the crew plan's generation (running, or ended and not yet accepted/discarded)
  async getCurrent(crewPlanId: string): Promise<CrewSolverJobState | null> {
    const v = await this.view(crewPlanId)
    if (!v) return null
    return {
      jobId: v.id, params: v.params, startedAt: v.startedAt, running: v.running, stopReason: v.stopReason, error: v.error,
      progress: v.progress, hasProposal: !!v.best,
    }
  }

  // every crew plan's generation — running, or ended and not yet used — newest first
  async listJobs(): Promise<CrewSolverJobListItem[]> {
    const runs = await this.saved.list('CREW')
    if (!runs.length) return []
    const plans = await this.prisma.crewPlan.findMany({
      where:  { id: { in: runs.flatMap(r => r.crewPlanId ?? []) } },
      select: { id: true, description: true, vehiclePlan: { select: { scope: { select: { name: true } }, dayType: { select: { name: true } } } } },
    })
    const byId = new Map(plans.map(p => [p.id, p]))
    return runs.map(run => {
      const job = this.jobs.get(run.id)
      const v = job ? viewOfJob(job) : viewOfRun(run)
      const p = byId.get(v.crewPlanId)
      return {
        jobId: v.id, crewPlanId: v.crewPlanId,
        planLabel: p ? [p.description || 'Escala', p.vehiclePlan.scope?.name, p.vehiclePlan.dayType?.name].filter(Boolean).join(' · ') : 'Escala',
        running: v.running, startedAt: v.startedAt, endedAt: v.endedAt,
        elapsed: (v.endedAt ?? Date.now()) - v.startedAt,
        stopReason: v.stopReason, error: v.error, hasProposal: !!v.best,
      }
    })
  }

  // stops the run if needed and forgets it
  async discard(crewPlanId: string, jobId: string): Promise<void> {
    const v = await this.viewById(jobId)
    if (v?.crewPlanId !== crewPlanId) return
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
    if (this.current.get(job.crewPlanId) === jobId) this.current.delete(job.crewPlanId)
  }

  // the generation's state first (best proposal, last progress, its end), then what comes next
  // while it runs; proposals go out without their duties — the client only shows the summary
  stream(jobId: string): Observable<{ data: string }> {
    const out = (msg: CrewSolverMessage) => ({
      data: JSON.stringify(msg.type === 'proposal' ? { ...msg, proposal: { ...msg.proposal, duties: undefined } } : msg),
    })
    return new Observable(subscriber => {
      let sub: { unsubscribe(): void } | null = null
      let closed = false
      void (async () => {
        const job = this.jobs.get(jobId)
        const v = job ? viewOfJob(job) : await this.viewById(jobId).catch(() => null)
        if (closed) return
        if (!v) return subscriber.complete()
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

  // The proposal becomes duties: its locked duties (Completar) + the proposal's, replicated to
  // the roles asked for. A DRAFT crew plan gets them in place (every other duty goes); from an
  // ACTIVE one a new DRAFT version is created — simulations don't pile up as versions. Duty
  // numbers: locked ones keep theirs, the rest take the free numbers in start order; a replica
  // takes its driver's number when free. Refused when the vehicle blocks or the locked duties
  // changed since the generation read them (fingerprint).
  async accept(crewPlanId: string, jobId: string, description?: string): Promise<{ id: string; inPlace: boolean }> {
    const v = await this.viewById(jobId)
    if (!v || v.crewPlanId !== crewPlanId) throw new NotFoundException('Geração não encontrada ou expirada')
    const { best, params } = v
    if (!best) throw new BadRequestException('Nenhuma proposta disponível ainda')
    if (await this.fingerprint(crewPlanId, params) !== v.fingerprint) {
      throw new BadRequestException('Os carros do planejamento ou as jornadas travadas mudaram desde a geração — gere novamente')
    }
    this.drop(jobId)

    const src = await this.prisma.crewPlan.findUnique({
      where:  { id: crewPlanId },
      select: {
        vehiclePlanId: true, settings: true, description: true, status: true,
        duties: {
          where:   params.base === 'complete' ? { constraints: { path: ['locked'], equals: true } } : { id: '' },
          include: { pieces: true, activities: true },
        },
      },
    })
    if (!src) throw new NotFoundException('crewPlan not found')
    const { settings } = await this.crewPlans.resolveSettings(crewPlanId)

    const inPlace = src.status === 'DRAFT'

    // rows built up front (ids generated here) and written in three bulk inserts
    const planId = inPlace ? crewPlanId : randomUUID()
    const duties: Prisma.DutyCreateManyInput[] = []
    const pieces: Prisma.DutyPieceCreateManyInput[] = []
    const activities: Prisma.DutyActivityCreateManyInput[] = []

    const taken = new Map<CrewRole, Set<number>>(CREW_ROLES.map(r => [r, new Set<number>()]))
    for (const d of src.duties) {
      taken.get(d.role)!.add(d.dutyNumber)
      // in place the locked duties simply stay
      if (inPlace) continue
      const dutyId = randomUUID()
      duties.push({
        id: dutyId, crewPlanId: planId, role: d.role, dutyNumber: d.dutyNumber, kind: d.kind, branchId: d.branchId,
        notes: d.notes, constraints: d.constraints ?? Prisma.DbNull,
      })
      for (const p of d.pieces) {
        pieces.push({
          dutyId, vehicleBlockId: p.vehicleBlockId, sequence: p.sequence, startMinutes: p.startMinutes, endMinutes: p.endMinutes,
          startLocalityId: p.startLocalityId, endLocalityId: p.endLocalityId,
        })
      }
      for (const a of d.activities) {
        activities.push({
          dutyId, type: a.type, intervalTypeId: a.intervalTypeId, startMinutes: a.startMinutes, endMinutes: a.endMinutes,
          originLocalityId: a.originLocalityId, destinationLocalityId: a.destinationLocalityId,
        })
      }
    }

    const nextFree = (role: CrewRole, wanted?: number) => {
      const used = taken.get(role)!
      let n = wanted != null && !used.has(wanted) ? wanted : 1
      while (used.has(n)) n++
      used.add(n)
      return n
    }
    const roles: CrewRole[] = ['DRIVER', ...(params.fareCollector ? ['FARE_COLLECTOR' as const] : []), ...(params.assistant ? ['ASSISTANT' as const] : [])]
    for (const d of best.duties) {
      const driverNumber = nextFree('DRIVER')
      for (const role of roles) {
        const dutyId = randomUUID()
        duties.push({
          id: dutyId, crewPlanId: planId, role, kind: d.kind, branchId: d.branchId,
          dutyNumber: role === 'DRIVER' ? driverNumber : nextFree(role, driverNumber),
        })
        d.pieces.forEach((p, i) => pieces.push({
          dutyId, vehicleBlockId: p.vehicleBlockId, sequence: i + 1, startMinutes: p.startMinutes, endMinutes: p.endMinutes,
          startLocalityId: p.startLocalityId, endLocalityId: p.endLocalityId,
        }))
        for (const b of d.breaks) {
          activities.push({ dutyId, type: 'BREAK', intervalTypeId: settings.mealBreakIntervalTypeId, startMinutes: b.startMinutes, endMinutes: b.endMinutes })
        }
      }
    }

    await this.prisma.$transaction([
      inPlace
        // the kept duties are the locked ones read above (a JSON filter would miss null constraints)
        ? this.prisma.duty.deleteMany({ where: { crewPlanId, id: { notIn: src.duties.map(d => d.id) } } })
        : this.prisma.crewPlan.create({
            data: {
              id:            planId,
              vehiclePlanId: src.vehiclePlanId,
              description:   description?.trim() || `${src.description || 'Escala'} (gerada)`,
              settings:      src.settings ?? Prisma.DbNull,
              generatedAt:   new Date(),
            },
          }),
      this.prisma.duty.createMany({ data: duties }),
      this.prisma.dutyPiece.createMany({ data: pieces }),
      this.prisma.dutyActivity.createMany({ data: activities }),
      ...(inPlace ? [this.prisma.crewPlan.update({ where: { id: crewPlanId }, data: { generatedAt: new Date() } })] : []),
    ])

    await this.saved.remove(jobId)
    await this.crewPlans.recalculate(planId)
    return { id: planId, inPlace }
  }
}

function viewOfJob(job: Job): View {
  return {
    id: job.id, crewPlanId: job.crewPlanId, params: job.params, fingerprint: job.fingerprint, running: !job.end,
    startedAt: job.startedAt, endedAt: job.endedAt,
    stopReason: job.end?.type === 'done' ? job.end.stopReason : null,
    error:      job.end?.type === 'error' ? job.end.message : null,
    progress: job.progress, best: job.best,
  }
}

// a row still RUNNING without its live job is another process's run, or one this process is
// about to mark INTERRUPTED — shown as running
function viewOfRun(run: SolverRun): View {
  return {
    id: run.id, crewPlanId: run.crewPlanId!, params: run.params as unknown as CrewSolverParams, fingerprint: run.fingerprint,
    running: run.status === 'RUNNING', startedAt: run.startedAt.getTime(), endedAt: run.endedAt?.getTime() ?? null,
    stopReason: stopReasonOf(run), error: run.error,
    progress: run.progress as Progress | null, best: run.best as CrewSolverProposal | null,
  }
}

// what the searches optimize — less crew overflow, fewer duties with an issue, then the unfloored score
const rankOf = (p: CrewSolverProposal) => solverRank(p.summary.rawScore ?? p.summary.score, p.summary.issueDutyCount, p.crew?.overflow)

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
function withDirection(settings: CrewSettings, direction: CrewSolverParams['direction']): CrewSettings {
  if (direction === 'balanced') return settings
  const next: CrewSettings = JSON.parse(JSON.stringify(settings))
  if (direction === 'fewer_duties') {
    next.anchored.dutyCount.weight *= 2
  } else {
    next.anchored.efficiency.weight *= 2
    next.range.overtimeRatio.modifier *= 2
  }
  return next
}
