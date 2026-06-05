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
    const rows = parseEmployeeSyncFile(file.buffer)
    if (rows.length === 0) throw new BadRequestException('Nenhum registro encontrado no arquivo')

    const job = await this.jobService.createJob({
      type:        'employee-sync',
      domain:      'hr',
      resource:    'employee',
      createdById: userId,
      input:       { filename: file.originalname, branchId, totalRows: rows.length },
    })

    this.jobService.run(job.id, () => this.execute(rows, branchId))

    return { jobId: job.id }
  }

  private async execute(
    rows:     ReturnType<typeof parseEmployeeSyncFile>,
    branchId: string,
  ): Promise<SyncOutput> {
    const errors:   SyncOutput['errors'] = []
    let created  = 0
    let updated  = 0

    const syncedCodes: string[] = []

    for (const row of rows) {
      const { _line, ...data } = row
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
