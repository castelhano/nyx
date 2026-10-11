import { BadRequestException, Injectable } from '@nestjs/common'
import { crewAbsenceTypeSchema, CrewAbsenceType, CreateCrewAbsenceTypeDto, UpdateCrewAbsenceTypeDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'

@Injectable()
export class CrewAbsenceTypeService extends BaseService<CrewAbsenceType, CreateCrewAbsenceTypeDto, UpdateCrewAbsenceTypeDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'crewAbsenceType', crewAbsenceTypeSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ code: stringContains(search) }, { name: stringContains(search) }] }
  }

  // a system type (the roster's own day off) keeps its effect, stays active and is never deleted
  override async update(id: string, dto: UpdateCrewAbsenceTypeDto): Promise<CrewAbsenceType> {
    const current = await this.findOne(id)
    const { systemKey: _s, ...patch } = dto as UpdateCrewAbsenceTypeDto & { systemKey?: unknown }
    if (current.systemKey) {
      if (patch.effect && patch.effect !== current.effect) throw new BadRequestException('Tipo do sistema: o efeito na escala não muda')
      if (patch.isActive === false) throw new BadRequestException('Tipo do sistema não pode ser desativado')
    }
    return super.update(id, patch)
  }

  override async remove(id: string): Promise<void> {
    if ((await this.findOne(id)).systemKey) throw new BadRequestException('Tipo do sistema não pode ser excluído')
    return super.remove(id)
  }
}
