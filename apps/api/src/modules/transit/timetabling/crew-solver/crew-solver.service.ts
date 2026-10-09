import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Worker } from 'worker_threads'
import * as path from 'path'
import { availableParallelism } from 'os'
import { Observable, Subject } from 'rxjs'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { CREW_ROLES, type CrewRole, type CrewSettings } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { CrewPlanService } from '../crew-plan/crew-plan.service'
import { loadCrewSolverInput } from './crew-solver.input'
import { solverRank } from '../crew-plan/crew-scoring.calc'
import {
  DEFAULT_CREW_SOLVER_PARAMS,
  type CrewSolverMessage, type CrewSolverParams, type CrewSolverProposal, type CrewSolverWorkerData,
} from './crew-solver.types'

// "Otimizar › Gerar escala" — runs the crew solver in a worker thread, streams progress
// over SSE and turns the chosen proposal into a new DRAFT crew plan version.
//
// A generation belongs to the crew plan, not to the screen that started it: it keeps running
// when the modal closes or the page is left, and the plan screen finds it again (current) —
// one per crew plan, a new start replaces it. A client connecting to the stream gets the
// job's state first (best proposal, last progress, how it ended) and then what comes next.
// Jobs live in memory (a restart loses them), until accepted, discarded or 30 min after the
// run ends.
//
// The improvement is a random search and two seeds can end ~30 duties apart, so a generation
// runs SEARCHES workers from different seeds side by side: the job keeps the best proposal of
// them all, its progress sums them up and it ends when the last one does.

const KEEP_MS = 30 * 60 * 1000
const SEARCHES = Math.max(1, Math.min(4, availableParallelism() - 1))

type Done = Extract<CrewSolverMessage, { type: 'done' | 'error' }>
type Progress = Extract<CrewSolverMessage, { type: 'progress' }>
type StopReason = Extract<CrewSolverMessage, { type: 'done' }>['stopReason']

// how the generation ended when its searches ended differently — the first one listed wins
const STOP_PRIORITY: StopReason[] = ['user_stopped', 'max_time', 'no_improvement', 'finished']

interface Job {
  id:         string
  crewPlanId: string
  params:     CrewSolverParams
  workers:    Worker[]
  // per worker: its last progress and how it ended
  runs:       { progress: Progress | null; end: Done | null }[]
  proposals:  number
  startedAt:  number
  best:       CrewSolverProposal | null
  progress:   Progress | null
  // how it ended — null while running
  end:        Done | null
  endedAt:    number | null
  live$:      Subject<CrewSolverMessage>
}

// what the plan screen needs to pick a generation up again
export interface CrewSolverJobState {
  jobId:     string
  params:    CrewSolverParams
  startedAt: number
  running:   boolean
  stopReason: Extract<CrewSolverMessage, { type: 'done' }>['stopReason'] | null
  error:     string | null
  progress:  Extract<CrewSolverMessage, { type: 'progress' }> | null
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
  stopReason:  CrewSolverJobState['stopReason']
  error:       string | null
  hasProposal: boolean
}

@Injectable()
export class CrewSolverService {
  private readonly logger = new Logger(CrewSolverService.name)
  private readonly jobs   = new Map<string, Job>()
  // crewPlanId → its generation's jobId
  private readonly current = new Map<string, string>()

  constructor(
    private readonly prisma:    PrismaService,
    private readonly crewPlans: CrewPlanService,
  ) {}

  async start(crewPlanId: string, jobId: string, rawParams?: Partial<CrewSolverParams>): Promise<void> {
    if (!jobId) throw new BadRequestException('jobId obrigatório')
    const params = { ...DEFAULT_CREW_SOLVER_PARAMS, ...rawParams }
    const { settings } = await this.crewPlans.resolveSettings(crewPlanId)
    const input = await loadCrewSolverInput(this.prisma, crewPlanId, withDirection(settings, params.direction))
    if (params.base === 'scratch') input.locked = []

    const isTs    = __filename.endsWith('.ts')
    const seed    = Date.now()
    // the construction has no seed: without the improvement one search is enough
    const workers = Array.from({ length: params.optimize ? SEARCHES : 1 }, (_, i) => new Worker(path.join(__dirname, `crew-solver.worker${isTs ? '.ts' : '.js'}`), {
      workerData: { input, seed: seed + i * 7919, optimize: params.optimize } satisfies CrewSolverWorkerData,
      execArgv:   isTs ? ['-r', '@swc-node/register', '-r', 'tsconfig-paths/register'] : [],
    }))
    // one generation per crew plan: a new one replaces the previous
    const previous = this.current.get(crewPlanId)
    if (previous) this.drop(previous)

    const job: Job = {
      id: jobId, crewPlanId, params, workers, runs: workers.map(() => ({ progress: null, end: null })), proposals: 0,
      startedAt: Date.now(), best: null, progress: null, end: null, endedAt: null, live$: new Subject(),
    }
    this.jobs.set(jobId, job)
    this.current.set(crewPlanId, jobId)

    const finish = (end: Done) => {
      if (job.end) return
      job.end = end
      job.endedAt = Date.now()
      job.live$.next(end)
      job.live$.complete()
      for (const w of workers) void w.terminate()
      setTimeout(() => { if (this.jobs.get(jobId) === job) this.drop(jobId) }, KEEP_MS)
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
      })
      worker.on('error', err => {
        this.logger.error(`Crew solver worker error for job ${jobId}`, err)
        ended(i, { type: 'error', message: err.message })
      })
    })
  }

  // the crew plan's generation (running, or ended and not yet accepted/discarded)
  getCurrent(crewPlanId: string): CrewSolverJobState | null {
    const job = this.jobs.get(this.current.get(crewPlanId) ?? '')
    if (!job) return null
    return {
      jobId: job.id, params: job.params, startedAt: job.startedAt, running: !job.end,
      stopReason: job.end?.type === 'done' ? job.end.stopReason : null,
      error:      job.end?.type === 'error' ? job.end.message : null,
      progress: job.progress, hasProposal: !!job.best,
    }
  }

  // every crew plan's generation — running, or ended and not yet used — newest first
  async listJobs(): Promise<CrewSolverJobListItem[]> {
    const jobs = [...this.current.values()].flatMap(id => this.jobs.get(id) ?? [])
    if (!jobs.length) return []
    const plans = await this.prisma.crewPlan.findMany({
      where:  { id: { in: jobs.map(j => j.crewPlanId) } },
      select: { id: true, description: true, vehiclePlan: { select: { scope: { select: { name: true } }, dayType: { select: { name: true } } } } },
    })
    const byId = new Map(plans.map(p => [p.id, p]))
    return jobs
      .map(job => {
        const p = byId.get(job.crewPlanId)
        return {
          jobId: job.id, crewPlanId: job.crewPlanId,
          planLabel: p ? [p.description || 'Escala', p.vehiclePlan.scope?.name, p.vehiclePlan.dayType?.name].filter(Boolean).join(' · ') : 'Escala',
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
  discard(crewPlanId: string, jobId: string): void {
    if (this.jobs.get(jobId)?.crewPlanId === crewPlanId) this.drop(jobId)
  }

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

  // the job's state first (best proposal, last progress, its end), then what comes next;
  // proposals go out without their duties — the client only shows the summary
  stream(jobId: string): Observable<{ data: string }> {
    const job = this.jobs.get(jobId)
    if (!job) return new Observable(s => s.complete())
    const out = (msg: CrewSolverMessage) => ({
      data: JSON.stringify(msg.type === 'proposal' ? { ...msg, proposal: { ...msg.proposal, duties: undefined } } : msg),
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
    for (const w of this.jobs.get(jobId)?.workers ?? []) {
      try { w.postMessage({ type: 'stop' }) } catch { /* already done */ }
    }
  }

  // The proposal becomes duties: its locked duties (Completar) + the proposal's, replicated to
  // the roles asked for. A DRAFT crew plan gets them in place (every other duty goes); from an
  // ACTIVE one a new DRAFT version is created — simulations don't pile up as versions. Duty
  // numbers: locked ones keep theirs, the rest take the free numbers in start order; a replica
  // takes its driver's number when free.
  async accept(crewPlanId: string, jobId: string, description?: string): Promise<{ id: string; inPlace: boolean }> {
    const job = this.jobs.get(jobId)
    if (!job || job.crewPlanId !== crewPlanId) throw new NotFoundException('Geração não encontrada ou expirada')
    if (!job.best) throw new BadRequestException('Nenhuma proposta disponível ainda')
    const { best, params } = job
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

    await this.crewPlans.recalculate(planId)
    return { id: planId, inPlace }
  }
}

// what the searches optimize — fewer duties with an issue, then the unfloored score
const rankOf = (p: CrewSolverProposal) => solverRank(p.summary.rawScore ?? p.summary.score, p.summary.issueDutyCount)

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
