import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { JobService } from '../../core/job/job.service'
import { parseEmployeeSyncFile } from './employee-sync.parser'

interface SyncOutput {
  created:     number
  updated:     number
  deactivated: number
  errors:      Array<{ line: number; record: string; message: string }>
}

@Injectable()
export class EmployeeSyncService {
  constructor(
    private readonly prisma:     PrismaService,
    private readonly jobService: JobService,
  ) {}

  async sync(file: Express.Multer.File, branchId: string, userId: string): Promise<{ jobId: string }> {
    if (!file.buffer?.length) throw new BadRequestException('Arquivo vazio')

    const job = await this.jobService.createJob({
      type:        'employee-sync',
      domain:      'hr',
      resource:    'employee',
      createdById: userId,
      input:       { filename: file.originalname, branchId },
    })

    this.jobService.run(job.id, () => this.execute(file.buffer, branchId, job.id))

    return { jobId: job.id }
  }

  private async execute(
    buffer:   Buffer,
    branchId: string,
    jobId:    string,
  ): Promise<SyncOutput> {
    const rows = parseEmployeeSyncFile(buffer)
    if (rows.length === 0) throw new Error('Nenhum registro encontrado no arquivo')

    const errors:   SyncOutput['errors'] = []
    let created  = 0
    let updated  = 0

    const syncedCodes: string[] = []
    let lastProgressUpdate = Date.now()

    await this.jobService.updateProgress(jobId, { processed: 0, total: rows.length, current: '' })

    for (let i = 0; i < rows.length; i++) {
      const { _line, ...data } = rows[i]
      syncedCodes.push(data.code)

      try {
        const existing = await (this.prisma as any).employee.findUnique({ where: { code: data.code } })

        const payload = {
          branchId,
          code:          data.code,
          fullName:      data.fullName,
          preferredName: data.preferredName,
          taxId:         data.taxId,
          status:        data.status,
          gender:        data.gender ?? undefined,
          hireDate:      data.hireDate,
          dateOfBirth:   data.dateOfBirth ?? undefined,
        }

        if (existing) {
          await (this.prisma as any).employee.update({ where: { code: data.code }, data: payload })
          updated++
        } else {
          await (this.prisma as any).employee.create({ data: payload })
          created++
        }
      } catch (err: any) {
        errors.push({ line: _line, record: data.code, message: err?.message ?? 'Erro desconhecido' })
      }

      const now = Date.now()
      if (now - lastProgressUpdate >= 2000) {
        await this.jobService.updateProgress(jobId, { processed: i + 1, total: rows.length, current: data.code })
        lastProgressUpdate = now
      }

    }

    // Funcionários desta filial ausentes do arquivo → TERMINATED
    const deactivated = await (this.prisma as any).employee.updateMany({
      where: {
        branchId,
        code:   { notIn: syncedCodes },
        status: { not: 'TERMINATED' },
      },
      data: { status: 'TERMINATED' },
    })

    return { created, updated, deactivated: deactivated.count, errors }
  }
}
