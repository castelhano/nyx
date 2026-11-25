import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { createHash } from 'crypto'
import { Prisma, type SolverRun, type SolverRunKind } from '@prisma/client'
import { PrismaService } from '../../../../prisma/prisma.service'

// The saved side of the solver generations (vehicle and crew): one SolverRun per plan, written as
// the run goes (at most every SAVE_MS, and when it ends) so it outlives the API process. The
// services keep the live part (workers, SSE) in memory and come here for everything else.
//
// Writes of a run go out one after the other (a checkpoint still in flight never lands over the
// end), and a run replaced meanwhile (its row gone) is simply not written.

export const SAVE_MS = 30_000

export type SolverStopReason = 'finished' | 'user_stopped' | 'max_time' | 'no_improvement' | 'interrupted'

// what the services write while the run goes and when it ends
export interface SolverRunPatch {
  progress?:   unknown
  best?:       unknown
  start?:      unknown
  status?:     'DONE' | 'ERROR'
  stopReason?: string | null
  error?:      string | null
}

const json = (v: unknown) => (v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue))

// a short hash of the rows a generation read — compared when it is applied
export function fingerprintOf(rows: unknown): string {
  return createHash('sha1').update(JSON.stringify(rows)).digest('hex')
}

// how the run ended, as the screens show it — null while running
export function stopReasonOf(run: Pick<SolverRun, 'status' | 'stopReason'>): SolverStopReason | null {
  if (run.status === 'INTERRUPTED') return 'interrupted'
  return run.status === 'DONE' ? (run.stopReason as SolverStopReason | null) : null
}

@Injectable()
export class SolverRunStore implements OnModuleInit {
  private readonly logger = new Logger(SolverRunStore.name)
  // jobId → its last write
  private readonly queue = new Map<string, Promise<unknown>>()

  constructor(private readonly prisma: PrismaService) {}

  // runs the previous process didn't finish — their workers are gone
  async onModuleInit(): Promise<void> {
    const { count } = await this.prisma.solverRun.updateMany({ where: { status: 'RUNNING' }, data: { status: 'INTERRUPTED', endedAt: new Date() } })
    if (count) this.logger.warn(`${count} solver run(s) interrupted by the restart`)
  }

  // the plan's new generation — the previous one goes
  async begin(kind: SolverRunKind, planId: string, jobId: string, data: { params: unknown; fingerprint: string; baseline?: unknown; userId?: string | null }): Promise<void> {
    const plan = kind === 'VEHICLE' ? { vehiclePlanId: planId } : { crewPlanId: planId }
    await this.prisma.$transaction([
      this.prisma.solverRun.deleteMany({ where: plan }),
      this.prisma.solverRun.create({
        data: { id: jobId, kind, ...plan, params: data.params as Prisma.InputJsonValue, fingerprint: data.fingerprint, baseline: json(data.baseline), userId: data.userId ?? null },
      }),
    ])
  }

  save(jobId: string, patch: SolverRunPatch): Promise<void> {
    const data: Prisma.SolverRunUpdateManyMutationInput = {}
    if ('progress' in patch) data.progress = json(patch.progress)
    if ('best' in patch) data.best = json(patch.best)
    if ('start' in patch) data.start = json(patch.start)
    if (patch.status) {
      data.status = patch.status
      data.stopReason = patch.stopReason ?? null
      data.error = patch.error ?? null
      data.endedAt = new Date()
    }
    const next = (this.queue.get(jobId) ?? Promise.resolve())
      .then(() => this.prisma.solverRun.updateMany({ where: { id: jobId }, data }))
      .catch(err => this.logger.warn(`Saving solver run ${jobId} failed: ${err instanceof Error ? err.message : err}`))
      .finally(() => { if (this.queue.get(jobId) === next) this.queue.delete(jobId) })
    this.queue.set(jobId, next)
    return next.then(() => undefined)
  }

  find(kind: SolverRunKind, planId: string): Promise<SolverRun | null> {
    return this.prisma.solverRun.findUnique({ where: kind === 'VEHICLE' ? { vehiclePlanId: planId } : { crewPlanId: planId } })
  }

  get(jobId: string): Promise<SolverRun | null> {
    return this.prisma.solverRun.findUnique({ where: { id: jobId } })
  }

  list(kind: SolverRunKind): Promise<SolverRun[]> {
    return this.prisma.solverRun.findMany({ where: { kind }, orderBy: { startedAt: 'desc' } })
  }

  // applied or discarded — after its pending writes
  async remove(jobId: string): Promise<void> {
    await this.queue.get(jobId)
    await this.prisma.solverRun.deleteMany({ where: { id: jobId } })
  }
}
