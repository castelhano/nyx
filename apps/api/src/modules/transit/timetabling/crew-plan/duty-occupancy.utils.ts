import { BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'

// Structural checks shared by DutyPiece and DutyActivity — a duty's own pieces and
// activities never overlap each other (a crew member can't be in two places at once).
// One exception: a BREAK may sit inside a piece while the vehicle is idle (between its
// trips/deadruns) — the crew member rests with the vehicle, which stays covered.

type Span = { startMinutes: number; endMinutes: number }

export function assertTimeWindow(startMinutes: number, endMinutes: number): void {
  if (!(endMinutes > startMinutes)) throw new BadRequestException('Fim deve ser posterior ao início')
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0

// the block's moving spans (trips + deadruns) — a break inside a piece must avoid them
async function loadBusySpans(prisma: PrismaService, blockId: string): Promise<Span[]> {
  const block = await prisma.vehicleBlock.findUnique({
    where:  { id: blockId },
    select: {
      blockTrips:    { select: { trip: { select: { departureMinutes: true, arrivalMinutes: true } } } },
      blockDeadruns: { select: { departureMinutes: true, arrivalMinutes: true } },
    },
  })
  if (!block) return []
  return [...block.blockTrips.map(bt => bt.trip), ...block.blockDeadruns]
    .map(e => ({ startMinutes: e.departureMinutes, endMinutes: e.arrivalMinutes }))
}

function fitsIdle(brk: Span, piece: Span, busy: Span[]): boolean {
  return brk.startMinutes >= piece.startMinutes && brk.endMinutes <= piece.endMinutes
    && !busy.some(s => overlaps(brk.startMinutes, brk.endMinutes, s.startMinutes, s.endMinutes))
}

const IDLE_ONLY = 'Intervalo dentro de uma pegada só pode ficar entre as viagens do carro'

export async function assertNoDutyOverlap(
  prisma: PrismaService,
  dutyId: string,
  span: Span,
  // what is being written: a piece (on its block), a BREAK activity or any other activity
  subject: { kind: 'piece'; blockId: string } | { kind: 'break' } | { kind: 'activity' },
  exclude: { pieceId?: string; activityId?: string } = {},
): Promise<void> {
  const [pieces, activities] = await Promise.all([
    prisma.dutyPiece.findMany({
      where:  { dutyId, ...(exclude.pieceId ? { id: { not: exclude.pieceId } } : {}) },
      select: { startMinutes: true, endMinutes: true, vehicleBlockId: true },
    }),
    prisma.dutyActivity.findMany({
      where:  { dutyId, ...(exclude.activityId ? { id: { not: exclude.activityId } } : {}) },
      select: { type: true, startMinutes: true, endMinutes: true },
    }),
  ])
  const hit = <T extends Span>(rows: T[]) => rows.filter(r => overlaps(span.startMinutes, span.endMinutes, r.startMinutes, r.endMinutes))

  const hitPieces = hit(pieces)
  if (hitPieces.length > 0) {
    if (subject.kind === 'piece') throw new BadRequestException('Sobrepõe outra pegada da mesma jornada')
    if (subject.kind === 'activity') throw new BadRequestException('Sobrepõe uma pegada da mesma jornada')
    const [piece] = hitPieces
    if (hitPieces.length > 1 || !piece.vehicleBlockId) throw new BadRequestException(IDLE_ONLY)
    if (!fitsIdle(span, piece, await loadBusySpans(prisma, piece.vehicleBlockId))) throw new BadRequestException(IDLE_ONLY)
  }

  const hitActs = hit(activities)
  if (hitActs.length > 0) {
    // a piece may be (re)laid over breaks that fall in its block's idle time
    const breaksOnly = subject.kind === 'piece' && hitActs.every(a => a.type === 'BREAK')
    if (!breaksOnly) throw new BadRequestException('Sobrepõe uma atividade da mesma jornada')
    const busy = await loadBusySpans(prisma, subject.blockId)
    if (!hitActs.every(a => fitsIdle(a, span, busy))) throw new BadRequestException(`Sobrepõe um intervalo fora do tempo parado do carro`)
  }
}

export { overlaps }
