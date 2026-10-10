import { BadRequestException, Injectable } from '@nestjs/common'
import { crewOccurrenceSchema, CrewOccurrence, CreateCrewOccurrenceDto, UpdateCrewOccurrenceDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { dayOf } from '../../timetabling/plan-validity'

type OccurrenceRow = {
  kind: string; absenceTypeId?: string | null; startDate: Date | string; endDate: Date | string
  startNotBefore?: number | null; endNotAfter?: number | null; status?: string; origin?: string
}

const REVIEWED = new Set(['APPROVED', 'REJECTED'])

// Absences and one-off time windows of a crew member, through the staff screens. A request
// (STAFF_ON_BEHALF here; PORTAL comes from the crew portal) is one day and keeps what was asked.
@Injectable()
export class CrewOccurrenceService extends BaseService<CrewOccurrence, CreateCrewOccurrenceDto, UpdateCrewOccurrenceDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'crewOccurrence', crewOccurrenceSchema, 'transit')
  }

  async createAs(dto: CreateCrewOccurrenceDto, userId: string | undefined): Promise<CrewOccurrence> {
    const row = CrewOccurrenceService.normalized(dto)
    if (row.origin === 'PORTAL') throw new BadRequestException('Solicitações do portal só são criadas pelo próprio operador')
    CrewOccurrenceService.assertValid(row)
    const request = row.origin === 'STAFF_ON_BEHALF'
    if (request && dayOf(new Date(row.startDate)) !== dayOf(new Date(row.endDate))) {
      throw new BadRequestException('Pedido do operador é sempre de um dia')
    }
    const { requested: _r, createdByUserId: _c, reviewedByUserId: _rb, reviewedAt: _ra, ...data } = row
    return super.create({
      ...data,
      createdByUserId: userId ?? null,
      requested: request ? CrewOccurrenceService.snapshot(row) : null,
      ...(REVIEWED.has(row.status ?? '') ? { reviewedByUserId: userId ?? null, reviewedAt: new Date() } : {}),
    })
  }

  async updateAs(id: string, dto: UpdateCrewOccurrenceDto, userId: string | undefined): Promise<CrewOccurrence> {
    const current = await this.findOne(id)
    // what was asked and who launched it never change; the origin is fixed at creation
    const { requested: _r, createdByUserId: _c, reviewedByUserId: _rb, reviewedAt: _ra, origin: _o, crewMemberId: _m, ...patch } = dto
    const row = CrewOccurrenceService.normalized({ ...current, ...patch })
    CrewOccurrenceService.assertValid(row)
    const statusChanged = patch.status !== undefined && patch.status !== current.status
    return super.update(id, {
      ...patch,
      kind: row.kind, absenceTypeId: row.absenceTypeId, startNotBefore: row.startNotBefore, endNotAfter: row.endNotAfter,
      ...(statusChanged && REVIEWED.has(patch.status!) ? { reviewedByUserId: userId ?? null, reviewedAt: new Date() } : {}),
    })
  }

  // an absence has a reason and no window; a time window has a window and no reason
  private static normalized<D extends OccurrenceRow>(dto: D): D {
    const blank = (v: unknown) => v === '' || v == null
    if (dto.kind === 'TIME_WINDOW') {
      return {
        ...dto, absenceTypeId: null,
        startNotBefore: blank(dto.startNotBefore) ? null : Number(dto.startNotBefore),
        endNotAfter:    blank(dto.endNotAfter) ? null : Number(dto.endNotAfter),
      }
    }
    return { ...dto, absenceTypeId: blank(dto.absenceTypeId) ? null : dto.absenceTypeId, startNotBefore: null, endNotAfter: null }
  }

  private static assertValid(row: OccurrenceRow): void {
    if (dayOf(new Date(row.endDate)) < dayOf(new Date(row.startDate))) throw new BadRequestException('O fim não pode ser antes do início')
    if (row.kind === 'ABSENCE' && !row.absenceTypeId) throw new BadRequestException('Informe o motivo da ausência')
    if (row.kind === 'TIME_WINDOW') {
      if (row.startNotBefore == null && row.endNotAfter == null) throw new BadRequestException('Informe o horário da restrição')
      if (row.startNotBefore != null && row.endNotAfter != null && row.endNotAfter <= row.startNotBefore) {
        throw new BadRequestException('O horário final precisa ser depois do inicial')
      }
    }
  }

  private static snapshot(row: OccurrenceRow): Record<string, unknown> {
    return {
      startDate: dayOf(new Date(row.startDate)), endDate: dayOf(new Date(row.endDate)),
      ...(row.kind === 'ABSENCE' ? { absenceTypeId: row.absenceTypeId } : { startNotBefore: row.startNotBefore, endNotAfter: row.endNotAfter }),
    }
  }
}
