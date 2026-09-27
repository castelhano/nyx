import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  dutyPieceSchema, createDutyPieceSchema,
  DutyPiece, CreateDutyPieceDto, UpdateDutyPieceDto,
} from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { CrewPlanService } from './crew-plan.service'
import { loadBlockRelief, isReliefPoint, BlockReliefData } from './relief-points'
import { assertTimeWindow, assertNoDutyOverlap, overlaps } from './duty-occupancy.utils'

const PLACEHOLDER_SEQUENCE = -1_000_000

type PieceInput = {
  dutyId: string; vehicleBlockId: string | null
  startMinutes: number; endMinutes: number; startLocalityId: string; endLocalityId: string
}

@Injectable()
export class DutyPieceService extends BaseService<DutyPiece, CreateDutyPieceDto, UpdateDutyPieceDto> {
  constructor(
    prisma: PrismaService,
    private readonly crewPlans: CrewPlanService,
  ) {
    super(prisma, 'dutyPiece', dutyPieceSchema, 'transit')
  }

  async listReliefPoints(vehicleBlockId: string): Promise<BlockReliefData> {
    const relief = (await loadBlockRelief(this.prisma, [vehicleBlockId])).get(vehicleBlockId)
    if (!relief) throw new NotFoundException('vehicleBlock not found')
    return relief
  }

  override async create(dto: CreateDutyPieceDto): Promise<DutyPiece> {
    const parsed = createDutyPieceSchema.safeParse(dto)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
    const input: PieceInput = parsed.data
    await this.crewPlans.assertDutyEditable(input.dutyId)
    await this.validate(input)

    const created = await this.prisma.$transaction(async (tx) => {
      // placeholder outside both the final (1..n) and renumber's first-pass (-1..-n) ranges,
      // so it can't clash with @@unique([dutyId, sequence]) until renumbered
      const piece = await tx.dutyPiece.create({ data: { ...this.toData(input), sequence: PLACEHOLDER_SEQUENCE } })
      await this.renumber(tx, input.dutyId)
      return piece
    })
    await this.recalculatePlanOf(input.dutyId)
    return this.findOne(created.id)
  }

  override async update(id: string, dto: UpdateDutyPieceDto): Promise<DutyPiece> {
    const current = await this.prisma.dutyPiece.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('dutyPiece not found')
    await this.crewPlans.assertDutyEditable(current.dutyId)
    const patch = updateFields(dto)
    // dutyId is immutable — moving a piece to another duty = delete + create
    const input: PieceInput = { ...current, ...patch, dutyId: current.dutyId }
    await this.validate(input, id)

    await this.prisma.$transaction(async (tx) => {
      await tx.dutyPiece.update({ where: { id }, data: this.toData(input) })
      await this.renumber(tx, current.dutyId)
    })
    // a saved piece was just re-validated — recalculate() clears its stale state
    await this.recalculatePlanOf(current.dutyId)
    return this.findOne(id)
  }

  override async remove(id: string): Promise<void> {
    const current = await this.prisma.dutyPiece.findUnique({ where: { id }, select: { dutyId: true } })
    if (!current) throw new NotFoundException('dutyPiece not found')
    await this.crewPlans.assertDutyEditable(current.dutyId)
    await this.prisma.$transaction(async (tx) => {
      await tx.dutyPiece.delete({ where: { id } })
      await this.renumber(tx, current.dutyId)
    })
    await this.recalculatePlanOf(current.dutyId)
  }

  private async recalculatePlanOf(dutyId: string): Promise<void> {
    const duty = await this.prisma.duty.findUnique({ where: { id: dutyId }, select: { crewPlanId: true } })
    if (duty) await this.crewPlans.recalculate(duty.crewPlanId)
  }

  private toData(input: PieceInput) {
    return {
      dutyId:          input.dutyId,
      vehicleBlockId:  input.vehicleBlockId,
      startMinutes:    input.startMinutes,
      endMinutes:      input.endMinutes,
      startLocalityId: input.startLocalityId,
      endLocalityId:   input.endLocalityId,
    }
  }

  // Structural checks — they block the save (docs/proposal/plan_crew_plan_v1.md,
  // "Validações estruturais"). CCT rules don't belong here: they become issues, never a 400.
  private async validate(input: PieceInput, pieceId?: string): Promise<void> {
    if (!input.vehicleBlockId) throw new BadRequestException('Pegada precisa de um bloco')
    assertTimeWindow(input.startMinutes, input.endMinutes)

    const duty = await this.prisma.duty.findUnique({
      where:  { id: input.dutyId },
      select: { role: true, crewPlanId: true, crewPlan: { select: { vehiclePlanId: true } } },
    })
    if (!duty) throw new BadRequestException('Jornada não encontrada')

    const block = await this.prisma.vehicleBlock.findUnique({
      where: { id: input.vehicleBlockId }, select: { vehiclePlanId: true },
    })
    if (!block || block.vehiclePlanId !== duty.crewPlan.vehiclePlanId) {
      throw new BadRequestException('Bloco não pertence ao planejamento desta escala')
    }

    const relief = await this.listReliefPoints(input.vehicleBlockId)
    if (!relief.window || input.startMinutes < relief.window.startMinutes || input.endMinutes > relief.window.endMinutes) {
      throw new BadRequestException('Pegada fora da janela do bloco')
    }
    if (!isReliefPoint(relief.points, input.startLocalityId, input.startMinutes)) {
      throw new BadRequestException('Início da pegada não é um ponto de troca válido do bloco')
    }
    if (!isReliefPoint(relief.points, input.endLocalityId, input.endMinutes)) {
      throw new BadRequestException('Fim da pegada não é um ponto de troca válido do bloco')
    }

    await assertNoDutyOverlap(
      this.prisma, input.dutyId, { startMinutes: input.startMinutes, endMinutes: input.endMinutes },
      { kind: 'piece', blockId: input.vehicleBlockId }, { pieceId },
    )

    // same role covering the same span of the same block — tolerance = handoverMinutes.
    // Stale pieces don't count (they no longer cover anything, see "Sinalização").
    const { settings } = await this.crewPlans.resolveSettings(duty.crewPlanId)
    const sameRole = await this.prisma.dutyPiece.findMany({
      where: {
        vehicleBlockId: input.vehicleBlockId,
        isStale:        false,
        dutyId:         { not: input.dutyId },
        duty:           { crewPlanId: duty.crewPlanId, role: duty.role },
        ...(pieceId ? { id: { not: pieceId } } : {}),
      },
      select: { startMinutes: true, endMinutes: true },
    })
    const conflict = sameRole.some(p =>
      overlaps(input.startMinutes, input.endMinutes, p.startMinutes, p.endMinutes) &&
      Math.min(input.endMinutes, p.endMinutes) - Math.max(input.startMinutes, p.startMinutes) > settings.handoverMinutes,
    )
    if (conflict) throw new BadRequestException('Trecho do bloco já coberto por outra jornada do mesmo papel')
  }

  // sequence = chronological order within the duty (two passes because of the @@unique)
  private async renumber(tx: Prisma.TransactionClient, dutyId: string): Promise<void> {
    const pieces = await tx.dutyPiece.findMany({
      where: { dutyId }, orderBy: [{ startMinutes: 'asc' }, { id: 'asc' }], select: { id: true },
    })
    for (let i = 0; i < pieces.length; i++) {
      await tx.dutyPiece.update({ where: { id: pieces[i].id }, data: { sequence: -(i + 1) } })
    }
    for (let i = 0; i < pieces.length; i++) {
      await tx.dutyPiece.update({ where: { id: pieces[i].id }, data: { sequence: i + 1 } })
    }
  }

}

// partial PATCH — editable fields only, coerced to their proper types
function updateFields(dto: Record<string, unknown>): Partial<PieceInput> {
  const out: Partial<PieceInput> = {}
  if ('vehicleBlockId' in dto)  out.vehicleBlockId  = (dto.vehicleBlockId as string | null) ?? null
  if ('startMinutes' in dto)    out.startMinutes    = Number(dto.startMinutes)
  if ('endMinutes' in dto)      out.endMinutes      = Number(dto.endMinutes)
  if ('startLocalityId' in dto) out.startLocalityId = String(dto.startLocalityId)
  if ('endLocalityId' in dto)   out.endLocalityId   = String(dto.endLocalityId)
  return out
}
