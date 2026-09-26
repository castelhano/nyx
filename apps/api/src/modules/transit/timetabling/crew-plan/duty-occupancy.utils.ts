import { BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'

// Structural checks shared by DutyPiece and DutyActivity — a duty's own pieces and
// activities never overlap each other (a crew member can't be in two places at once).

export function assertTimeWindow(startMinutes: number, endMinutes: number): void {
  if (!(endMinutes > startMinutes)) throw new BadRequestException('Fim deve ser posterior ao início')
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0

export async function assertNoDutyOverlap(
  prisma: PrismaService,
  dutyId: string,
  startMinutes: number,
  endMinutes: number,
  exclude: { pieceId?: string; activityId?: string } = {},
): Promise<void> {
  const [pieces, activities] = await Promise.all([
    prisma.dutyPiece.findMany({
      where:  { dutyId, ...(exclude.pieceId ? { id: { not: exclude.pieceId } } : {}) },
      select: { startMinutes: true, endMinutes: true },
    }),
    prisma.dutyActivity.findMany({
      where:  { dutyId, ...(exclude.activityId ? { id: { not: exclude.activityId } } : {}) },
      select: { startMinutes: true, endMinutes: true },
    }),
  ])
  if (pieces.some(p => overlaps(startMinutes, endMinutes, p.startMinutes, p.endMinutes))) {
    throw new BadRequestException('Sobrepõe outra pegada da mesma jornada')
  }
  if (activities.some(a => overlaps(startMinutes, endMinutes, a.startMinutes, a.endMinutes))) {
    throw new BadRequestException('Sobrepõe uma atividade da mesma jornada')
  }
}

export { overlaps }
