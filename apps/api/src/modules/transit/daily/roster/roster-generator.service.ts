import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Worker } from 'worker_threads'
import * as path from 'path'
import { Observable, Subject } from 'rxjs'
import { ROSTER_MAX_HORIZON_DAYS, rosterGeneratorParamsSchema, type RosterGeneratorParams } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { TransitCrewConfigService } from '../../settings/transit-crew-config.service'
import { TransitRosterConfigService } from '../../settings/transit-roster-config.service'
import { addDays, toDbDate } from '../../timetabling/plan-validity'
import { DailyOperationService } from '../daily-operation.service'
import type { RosterProposal } from './roster-generator.calc'
import { daysBetween, loadRosterInput, type RosterContext } from './roster-generator.input'
import type { RosterMessage, RosterWorkerData } from './roster-generator.types'
import { assignVehicles } from './roster-vehicles'
import { systemAbsenceTypeId } from '../../crew/crew-absence-type/system-types'

// "Gerar escala" — the real roster generator of one empresa and role (plan §5). Starting it
// materializes the missing days of the horizon (Scopes the empresa operates), reads the data and
// runs the search in a worker thread, streaming progress over SSE. Accepting writes the best
// proposal: RosterEntry (GENERATED) per duty and rest-pattern day off, replacing every entry
// that isn't fixed (locked, day not PLANNED, compensatory day off, day off entered by hand),
// then the vehicles and the days' recalculation.
//
// Like the crew solver, a generation lives in memory — one per empresa/role, a new start
// replaces it; kept until accepted, discarded or 30 min after it ends.

const KEEP_MS = 30 * 60 * 1000
const MAX_MS  = 3 * 60 * 1000
const IDLE_MS = 15 * 1000
// once the coverage reached what the crew allows
const BOUND_IDLE_MS = 8 * 1000

type End = Extract<RosterMessage, { type: 'done' | 'error' }>
type Progress = Extract<RosterMessage, { type: 'progress' }>

interface Job {
  id:        string
  key:       string
  params:    RosterGeneratorParams
  worker:    Worker | null
  context:   RosterContext | null
  stages:    string[]
  startedAt: number
  best:      RosterProposal | null
  progress:  Progress | null
  end:       End | null
  endedAt:   number | null
  live$:     Subject<RosterMessage>
}

export interface RosterJobState {
  jobId:     string
  params:    RosterGeneratorParams
  startedAt: number
  running:   boolean
}

@Injectable()
export class RosterGeneratorService {
  private readonly logger = new Logger(RosterGeneratorService.name)
  private readonly jobs = new Map<string, Job>()
  // `${branchId}:${role}` → jobId
  private readonly current = new Map<string, string>()

  constructor(
    private readonly prisma:       PrismaService,
    private readonly daily:        DailyOperationService,
    private readonly rosterConfig: TransitRosterConfigService,
    private readonly crewConfig:   TransitCrewConfigService,
  ) {}

  start(jobId: string, raw: unknown): void {
    if (!jobId) throw new BadRequestException('jobId obrigatório')
    const parsed = rosterGeneratorParamsSchema.safeParse(raw)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => i.message))
    const params = parsed.data
    if (daysBetween(params.from, params.to) + 1 > ROSTER_MAX_HORIZON_DAYS) {
      throw new BadRequestException(`O período pode ter no máximo ${ROSTER_MAX_HORIZON_DAYS} dias`)
    }
    const key = `${params.branchId}:${params.role}`
    const previous = this.current.get(key)
    if (previous) this.drop(previous)

    const job: Job = {
      id: jobId, key, params, worker: null, context: null, stages: [], startedAt: Date.now(),
      best: null, progress: null, end: null, endedAt: null, live$: new Subject(),
    }
    this.jobs.set(jobId, job)
    this.current.set(key, jobId)
    void this.prepare(job).catch(err => this.finish(job, { type: 'error', message: err instanceof Error ? err.message : String(err) }))
  }

  private stage(job: Job, message: string): void {
    job.stages.push(message)
    job.live$.next({ type: 'stage', message })
  }

  private async prepare(job: Job): Promise<void> {
    const { params } = job
    // the missing days of the Scopes the empresa operates
    const scopes = await this.prisma.scopeOperator.findMany({ where: { branchId: params.branchId }, select: { scopeId: true, scope: { select: { name: true } } } })
    if (!scopes.length) throw new BadRequestException('A empresa não opera nenhum escopo')
    const existing = await this.prisma.dailyOperation.findMany({
      where:  { scopeId: { in: scopes.map(s => s.scopeId) }, date: { gte: toDbDate(params.from), lte: toDbDate(params.to) } },
      select: { scopeId: true, date: true },
    })
    const have = new Set(existing.map(e => `${e.scopeId}:${e.date.toISOString().slice(0, 10)}`))
    for (let day = params.from; day <= params.to; day = addDays(day, 1)) {
      for (const s of scopes) {
        if (this.jobs.get(job.id) !== job) return
        if (have.has(`${s.scopeId}:${day}`)) continue
        this.stage(job, `Criando o dia ${fmt(day)} de ${s.scope.name}`)
        try {
          await this.daily.create({ scopeId: s.scopeId, date: toDbDate(day) })
        } catch (err) {
          this.stage(job, `${fmt(day)} de ${s.scope.name} não criado: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
    if (this.jobs.get(job.id) !== job) return

    this.stage(job, 'Lendo operadores e tabelas')
    const context = await loadRosterInput(this.prisma, this.rosterConfig, this.crewConfig, params)
    job.context = context
    if (!context.input.duties.length) throw new BadRequestException('Nenhuma tabela a escalar no período (dias planejados da empresa)')
    if (!context.input.members.length) throw new BadRequestException('Nenhum operador escalável da empresa nessa função')
    this.stage(job, `${context.input.duties.length} tabela(s), ${context.input.members.length} operador(es)`)
    if (this.jobs.get(job.id) !== job) return

    const isTs = __filename.endsWith('.ts')
    const worker = new Worker(path.join(__dirname, `roster-generator.worker${isTs ? '.ts' : '.js'}`), {
      workerData: { input: context.input, seed: Date.now(), maxMs: MAX_MS, idleMs: IDLE_MS, boundIdleMs: BOUND_IDLE_MS } satisfies RosterWorkerData,
      execArgv:   isTs ? ['-r', '@swc-node/register', '-r', 'tsconfig-paths/register'] : [],
    })
    job.worker = worker
    worker.on('message', (msg: RosterMessage) => {
      if (msg.type === 'done' || msg.type === 'error') return this.finish(job, msg)
      if (msg.type === 'proposal') job.best = msg.proposal
      if (msg.type === 'progress') job.progress = msg
      job.live$.next(msg)
    })
    worker.on('error', err => {
      this.logger.error(`Roster generator worker error for job ${job.id}`, err)
      this.finish(job, { type: 'error', message: err.message })
    })
  }

  private finish(job: Job, end: End): void {
    if (job.end) return
    job.end = end
    job.endedAt = Date.now()
    job.live$.next(end)
    job.live$.complete()
    void job.worker?.terminate()
    setTimeout(() => { if (this.jobs.get(job.id) === job) this.drop(job.id) }, KEEP_MS)
  }

  getCurrent(branchId: string, role: string): RosterJobState | null {
    const job = this.jobs.get(this.current.get(`${branchId}:${role}`) ?? '')
    if (!job) return null
    return { jobId: job.id, params: job.params, startedAt: job.startedAt, running: !job.end }
  }

  discard(jobId: string): void {
    this.drop(jobId)
  }

  stop(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (!job.worker) return this.finish(job, { type: 'done', stopReason: 'user_stopped', elapsed: Date.now() - job.startedAt, attempts: 0 })
    try { job.worker.postMessage({ type: 'stop' }) } catch { /* already done */ }
  }

  private drop(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (!job.end) {
      job.live$.complete()
      void job.worker?.terminate()
    }
    this.jobs.delete(jobId)
    if (this.current.get(job.key) === jobId) this.current.delete(job.key)
  }

  // the job's state first (stages, best proposal, last progress, its end), then what comes next;
  // proposals go out without their assignments
  stream(jobId: string): Observable<{ data: string }> {
    const job = this.jobs.get(jobId)
    if (!job) return new Observable(s => s.complete())
    const out = (msg: RosterMessage) => ({
      data: JSON.stringify(msg.type === 'proposal' ? { ...msg, proposal: { ...msg.proposal, assignments: undefined, dayOffs: undefined } } : msg),
    })
    return new Observable(subscriber => {
      for (const message of job.stages) subscriber.next(out({ type: 'stage', message }))
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

  // the best proposal's allocation — the roster screen draws it over the board
  getProposal(jobId: string): Pick<RosterProposal, 'index' | 'summary' | 'assignments' | 'dayOffs'> | null {
    const best = this.jobs.get(jobId)?.best
    return best ? { index: best.index, summary: best.summary, assignments: best.assignments, dayOffs: best.dayOffs } : null
  }

  async accept(jobId: string): Promise<{ assigned: number; dayOffs: number; vehicles: number }> {
    const job = this.jobs.get(jobId)
    if (!job) throw new NotFoundException('Geração não encontrada ou expirada')
    if (!job.best || !job.context) throw new BadRequestException('Nenhuma proposta disponível ainda')
    if (!job.end) this.stop(jobId)
    const { best, context, params } = job
    this.drop(jobId)

    const { input } = context
    const memberIds = input.members.map(m => m.id)
    const dutyIds   = input.duties.map(d => d.id)
    const kindOf    = new Map(input.duties.map(d => [d.id, d.kind]))
    // a day that left PLANNED meanwhile keeps what it has
    const planned = await this.prisma.dailyOperation.findMany({ where: { id: { in: context.operationIds }, status: 'PLANNED' }, select: { id: true } })
    const plannedDuties = new Set((await this.prisma.dailyDuty.findMany({
      where: { id: { in: dutyIds }, dailyOperationId: { in: planned.map(p => p.id) } }, select: { id: true },
    })).map(d => d.id))
    const assignments = best.assignments.filter(([dutyId]) => plannedDuties.has(dutyId))

    const weeklyOff = await systemAbsenceTypeId(this.prisma, 'DAY_OFF')
    await this.prisma.$transaction(async tx => {
      await tx.rosterEntry.deleteMany({
        where: {
          date:   { gte: toDbDate(params.from), lte: toDbDate(params.to) },
          locked: false,
          OR:     [{ crewMemberId: { in: memberIds } }, { dailyDutyId: { in: [...plannedDuties] } }],
          AND: [
            { NOT: { kind: 'COMP_OFF' } },
            // days off launched by hand or by a request stay
            { NOT: { kind: 'DAY_OFF', source: { not: 'GENERATED' } } },
            { OR: [{ dailyDutyId: null }, { dailyDuty: { operation: { status: 'PLANNED' } } }] },
          ],
        },
      })
      const dateOf = new Map(input.duties.map(d => [d.id, input.days[d.day]]))
      await tx.rosterEntry.createMany({
        data: [
          ...assignments.map(([dailyDutyId, crewMemberId]) => ({
            crewMemberId, dailyDutyId, date: toDbDate(dateOf.get(dailyDutyId)!),
            kind: kindOf.get(dailyDutyId) === 'STANDBY' ? 'STANDBY' as const : 'DUTY' as const, source: 'GENERATED',
          })),
          ...best.dayOffs.map(([day, crewMemberId]) => ({ crewMemberId, date: toDbDate(day), kind: 'DAY_OFF' as const, source: 'GENERATED', absenceTypeId: weeklyOff })),
        ],
      })
    }, { timeout: 60_000 })

    const operationIds = planned.map(p => p.id)
    const settings = await this.rosterConfig.get(params.branchId)
    const vehicles = params.vehicles ? await assignVehicles(this.prisma, params.branchId, operationIds, settings.habitualVehicleDays) : 0

    // the days and their neighbors (rest across the horizon's edges)
    const neighbors = await this.prisma.dailyOperation.findMany({
      where:  { scopeId: { in: context.scopeIds }, date: { in: [toDbDate(addDays(params.from, -1)), toDbDate(addDays(params.to, 1))] }, status: { not: 'CLOSED' } },
      select: { id: true },
    })
    for (const id of [...operationIds, ...neighbors.map(n => n.id)]) await this.daily.recalculate(id)
    return { assigned: assignments.length, dayOffs: best.dayOffs.length, vehicles }
  }
}

const fmt = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
