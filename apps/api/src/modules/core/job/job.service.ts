import { Injectable } from '@nestjs/common'
import { BaseService } from '../../../core/base.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { jobSchema, type Job } from '@nyx/schemas'
import type { PaginationQuery, AuthUser } from '@nyx/types'

@Injectable()
export class JobService extends BaseService<Job, never, never> {
  constructor(private readonly prismaService: PrismaService) {
    super(prismaService, 'job', jobSchema, 'core')
  }

  async findAllForUser(query: PaginationQuery, user: AuthUser) {
    if (user.role === 'admin') return this.findAll(query)
    return this.findAll({ ...query, createdById: user.id } as unknown as PaginationQuery)
  }

  async createJob(data: {
    type:        string
    domain:      string
    resource:    string
    createdById: string
    input?:      unknown
  }): Promise<Job> {
    return (this.prismaService as any).job.create({ data })
  }

  async run(jobId: string, handler: () => Promise<unknown>): Promise<void> {
    void this.executeAsync(jobId, handler)
  }

  private async executeAsync(jobId: string, handler: () => Promise<unknown>): Promise<void> {
    const start = Date.now()
    await (this.prismaService as any).job.update({
      where: { id: jobId },
      data:  { status: 'RUNNING', startedAt: new Date() },
    })
    try {
      const output = await handler()
      await (this.prismaService as any).job.update({
        where: { id: jobId },
        data:  {
          status:      'COMPLETED',
          completedAt: new Date(),
          durationMs:  Date.now() - start,
          output:      output as any,
        },
      })
    } catch (err: any) {
      await (this.prismaService as any).job.update({
        where: { id: jobId },
        data:  {
          status:      'FAILED',
          completedAt: new Date(),
          durationMs:  Date.now() - start,
          error:       err?.message ?? 'Unknown error',
        },
      })
    }
  }
}
