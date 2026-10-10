import { BadRequestException, Injectable } from '@nestjs/common'
import {
  lineServiceRequirementSchema,
  LineServiceRequirement,
  CreateLineServiceRequirementDto,
  UpdateLineServiceRequirementDto,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class LineServiceRequirementService extends BaseService<LineServiceRequirement, CreateLineServiceRequirementDto, UpdateLineServiceRequirementDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineServiceRequirement', lineServiceRequirementSchema, 'transit')
  }

  override async create(dto: CreateLineServiceRequirementDto): Promise<LineServiceRequirement> {
    const normalized = this.normalizeLocality(dto)
    await this.assertValid(normalized)
    return super.create(normalized)
  }

  override async update(id: string, dto: UpdateLineServiceRequirementDto): Promise<LineServiceRequirement> {
    const current    = await this.findOne(id)
    const normalized = this.normalizeLocality(dto)
    await this.assertValid({ ...current, ...normalized })
    return super.update(id, normalized)
  }

  // a cleared select arrives as '' — sanitizeDto drops '' on optional fields, which would keep
  // the old locality instead of falling back to the route's endpoint
  private normalizeLocality<D extends { localityId?: string | null }>(dto: D): D {
    return (dto.localityId as unknown) === '' ? { ...dto, localityId: null } : dto
  }

  private async assertValid(r: {
    lineId:          string
    direction:       string
    localityId?:     string | null
    earliestMinutes: unknown
    latestMinutes:   unknown
  }): Promise<void> {
    if (Number(r.earliestMinutes) > Number(r.latestMinutes)) {
      throw new BadRequestException('O início da janela não pode ser depois do fim')
    }

    const routes = await this.prisma.transitRoute.findMany({
      where:  { lineId: r.lineId, direction: r.direction as never },
      select: { id: true },
    })
    if (routes.length === 0) throw new BadRequestException('A linha não tem rota cadastrada nesse sentido')

    if (r.localityId) {
      const passes = await this.prisma.routeLocality.count({
        where: { localityId: r.localityId, routeId: { in: routes.map(rt => rt.id) } },
      })
      if (passes === 0) throw new BadRequestException('Nenhuma rota desse sentido passa pelo ponto de referência')
    }
  }
}
