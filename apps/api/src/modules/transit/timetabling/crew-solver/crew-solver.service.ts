import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Worker } from 'worker_threads'
import * as path from 'path'
import { Observable, ReplaySubject } from 'rxjs'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { CREW_ROLES, type CrewRole, type CrewSettings } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { CrewPlanService } from '../crew-plan/crew-plan.service'
import { loadCrewSolverInput } from './crew-solver.input'
import {
  DEFAULT_CREW_SOLVER_PARAMS,
  type CrewSolverMessage, type CrewSolverParams, type CrewSolverProposal,
} from './crew-solver.types'

// "Otimizar › Gerar escala" — runs the crew solver in a worker thread, streams progress
// over SSE and turns the chosen proposal into a new DRAFT crew plan version. Same job
// lifecycle as the vehicle plan solver (VehiclePlanService.optimize/streamProgress/
// assumeBest): jobs live in memory, 30 min after the run ends.

interface Job {
  crewPlanId: string
  params:     CrewSolverParams
  worker:     Worker
  best:       CrewSolverProposal | null
  // replayed: construction takes milliseconds, the client's SSE may connect after it's done
  messages$:  ReplaySubject<CrewSolverMessage>
}

@Injectable()
export class CrewSolverService {
  private readonly logger = new Logger(CrewSolverService.name)
  private readonly jobs   = new Map<string, Job>()

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

    const isTs     = __filename.endsWith('.ts')
    const worker   = new Worker(path.join(__dirname, `crew-solver.worker${isTs ? '.ts' : '.js'}`), {
      workerData: input,
      execArgv:   isTs ? ['-r', '@swc-node/register', '-r', 'tsconfig-paths/register'] : [],
    })
    const job: Job = { crewPlanId, params, worker, best: null, messages$: new ReplaySubject() }
    this.jobs.set(jobId, job)

    const finish = () => {
      job.messages$.complete()
      void worker.terminate()
      setTimeout(() => this.jobs.delete(jobId), 30 * 60 * 1000)
    }
    worker.on('message', (msg: CrewSolverMessage) => {
      if (msg.type === 'proposal') job.best = msg.proposal
      job.messages$.next(msg)
      if (msg.type === 'done' || msg.type === 'error') finish()
    })
    worker.on('error', err => {
      this.logger.error(`Crew solver worker error for job ${jobId}`, err)
      job.messages$.next({ type: 'error', message: err.message })
      finish()
    })
  }

  // proposals go out without their duties — the client only shows the summary
  stream(jobId: string): Observable<{ data: string }> {
    const job = this.jobs.get(jobId)
    if (!job) return new Observable(s => s.complete())
    return new Observable(subscriber => {
      const sub = job.messages$.subscribe({
        next: msg => subscriber.next({
          data: JSON.stringify(msg.type === 'proposal' ? { ...msg, proposal: { ...msg.proposal, duties: undefined } } : msg),
        }),
        error:    err => subscriber.error(err),
        complete: () => subscriber.complete(),
      })
      return () => sub.unsubscribe()
    })
  }

  stop(jobId: string): void {
    try { this.jobs.get(jobId)?.worker.postMessage({ type: 'stop' }) } catch { /* already done */ }
  }

  // New DRAFT version of the crew plan: its locked duties (Completar) + the proposal's,
  // replicated to the roles asked for. Duty numbers: locked ones keep theirs, the rest take
  // the free numbers in start order; a replica takes its driver's number when free.
  async accept(crewPlanId: string, jobId: string, description?: string): Promise<{ id: string }> {
    const job = this.jobs.get(jobId)
    if (!job || job.crewPlanId !== crewPlanId) throw new NotFoundException('Geração não encontrada ou expirada')
    if (!job.best) throw new BadRequestException('Nenhuma proposta disponível ainda')
    this.stop(jobId)
    this.jobs.delete(jobId)
    const { best, params } = job

    const src = await this.prisma.crewPlan.findUnique({
      where:  { id: crewPlanId },
      select: {
        vehiclePlanId: true, settings: true, description: true,
        duties: {
          where:   params.base === 'complete' ? { constraints: { path: ['locked'], equals: true } } : { id: '' },
          include: { pieces: true, activities: true },
        },
      },
    })
    if (!src) throw new NotFoundException('crewPlan not found')
    const { settings } = await this.crewPlans.resolveSettings(crewPlanId)

    // rows built up front (ids generated here) and written in three bulk inserts
    const planId = randomUUID()
    const duties: Prisma.DutyCreateManyInput[] = []
    const pieces: Prisma.DutyPieceCreateManyInput[] = []
    const activities: Prisma.DutyActivityCreateManyInput[] = []

    const taken = new Map<CrewRole, Set<number>>(CREW_ROLES.map(r => [r, new Set<number>()]))
    for (const d of src.duties) {
      const dutyId = randomUUID()
      taken.get(d.role)!.add(d.dutyNumber)
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
      this.prisma.crewPlan.create({
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
    ])
    const created = { id: planId }

    await this.crewPlans.recalculate(created.id)
    return { id: created.id }
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
