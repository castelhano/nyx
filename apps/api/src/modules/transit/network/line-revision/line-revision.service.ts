import { BadRequestException, Injectable } from '@nestjs/common'
import {
  lineRevisionSchema,
  registerLineRevisionSchema,
  LineRevision,
  LineRevisionExtension,
  CreateLineRevisionDto,
  UpdateLineRevisionDto,
} from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { toDbDate } from '../../timetabling/plan-validity'

@Injectable()
export class LineRevisionService extends BaseService<LineRevision, CreateLineRevisionDto, UpdateLineRevisionDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineRevision', lineRevisionSchema, 'transit')
  }

  // the form shows extensionKm read-only and posts it back — only register() writes it
  override create(dto: CreateLineRevisionDto, user?: AuthUser): Promise<LineRevision> {
    const { extensionKm: _, ...rest } = dto
    return super.create(rest, user)
  }

  override update(id: string, dto: UpdateLineRevisionDto, user?: AuthUser): Promise<LineRevision> {
    const { extensionKm: _, ...rest } = dto
    return super.update(id, rest, user)
  }

  // Upserts the revision of (lineId, validFrom): a trajectory edited in several steps, or ida
  // and volta registered one after the other, end up as one revision. A direction already in
  // it keeps its original `from` — the km before the first step — and takes the new `to`.
  async register(body: unknown): Promise<LineRevision> {
    const parsed = registerLineRevisionSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
    const dto       = parsed.data
    const validFrom = toDbDate(dto.validFrom)

    const current = await this.prisma.lineRevision.findUnique({
      where: { lineId_validFrom: { lineId: dto.lineId, validFrom } },
    })

    const extensionKm: LineRevisionExtension = { ...(current?.extensionKm as LineRevisionExtension | undefined) }
    for (const [direction, km] of Object.entries(dto.extensionKm) as [keyof LineRevisionExtension, LineRevisionExtension[keyof LineRevisionExtension]][]) {
      if (!km) continue
      extensionKm[direction] = { from: extensionKm[direction]?.from ?? km.from, to: km.to }
    }

    const data = { description: dto.description, approvalRef: dto.approvalRef || null, extensionKm }
    return this.prisma.lineRevision.upsert({
      where:  { lineId_validFrom: { lineId: dto.lineId, validFrom } },
      create: { lineId: dto.lineId, validFrom, ...data },
      update: data,
    }) as unknown as Promise<LineRevision>
  }
}
