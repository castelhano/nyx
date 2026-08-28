import { NotFoundException, BadRequestException } from '@nestjs/common'
import { findIntervalIdsAnchoredToTrips } from './block-interval.utils'

// The core block-mutation logic used by VehiclePlanService.applyDiff — extracted out
// of what used to be individual VehicleBlockService endpoints (addAccess, addReturn,
// updateDeadruns, deleteDeadruns, updateIntervals, deleteIntervals, moveTrip), each
// with its own $transaction and its own conditional recalculate() call. applyDiff is
// now the only caller: everything here runs inside applyDiff's single transaction and
// never recalculates on its own — see docs/proposal/vehicle-plan-summary-score-
// consolidation.md §2.4. Plain functions (not a service) so VehiclePlanService can
// call them directly without a circular DI edge back through VehicleBlockService.

export async function applyAddAccess(tx: any, blockId: string, blockTripId: string, depotLocalityId: string): Promise<void> {
  const target = await tx.blockTrip.findUnique({
    where:  { id: blockTripId },
    select: {
      id: true, vehicleBlockId: true,
      trip: { select: { departureMinutes: true, route: { select: { originLocality: { select: { id: true } } } } } },
    },
  })
  if (!target || target.vehicleBlockId !== blockId) throw new NotFoundException('Viagem não encontrada neste bloco')

  const originLocalityId = target.trip.route.originLocality.id
  const travelTime = await tx.travelTimeMatrix.findUnique({
    where: { originId_destinationId: { originId: depotLocalityId, destinationId: originLocalityId } },
  })
  if (!travelTime) throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')

  const deadheadMinutes = Math.round(travelTime.baseMinutes * travelTime.speedRatio)

  await tx.blockDeadrun.create({
    data: {
      vehicleBlockId:        blockId,
      type:                  'ACCESS',
      originLocalityId:      depotLocalityId,
      destinationLocalityId: originLocalityId,
      departureMinutes:      target.trip.departureMinutes - deadheadMinutes - 1,
      arrivalMinutes:        target.trip.departureMinutes - 1,
    },
  })
  await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
}

export async function applyAddReturn(tx: any, blockId: string, blockTripId: string, depotLocalityId: string): Promise<void> {
  const target = await tx.blockTrip.findUnique({
    where:  { id: blockTripId },
    select: {
      id: true, vehicleBlockId: true,
      trip: { select: { arrivalMinutes: true, route: { select: { destinationLocality: { select: { id: true } } } } } },
    },
  })
  if (!target || target.vehicleBlockId !== blockId) throw new NotFoundException('Viagem não encontrada neste bloco')

  const destinationLocalityId = target.trip.route.destinationLocality.id
  const travelTime = await tx.travelTimeMatrix.findUnique({
    where: { originId_destinationId: { originId: destinationLocalityId, destinationId: depotLocalityId } },
  })
  if (!travelTime) throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')

  const deadheadMinutes = Math.round(travelTime.baseMinutes * travelTime.speedRatio)

  await tx.blockDeadrun.create({
    data: {
      vehicleBlockId:        blockId,
      type:                  'RETURN',
      originLocalityId:      destinationLocalityId,
      destinationLocalityId: depotLocalityId,
      departureMinutes:      target.trip.arrivalMinutes + 1,
      arrivalMinutes:        target.trip.arrivalMinutes + 1 + deadheadMinutes,
    },
  })
  await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
}

export async function applyMoveTrip(
  tx: any, blockId: string, blockTripIds: string[], targetBlockId: string,
  breakIds: string[] = [], deadrunIds: string[] = [],
): Promise<void> {
  if (targetBlockId === blockId) throw new BadRequestException('Bloco destino igual ao bloco de origem')
  if (!blockTripIds.length)      throw new BadRequestException('Nenhuma viagem informada')

  const found = await tx.blockTrip.findMany({ where: { id: { in: blockTripIds }, vehicleBlockId: blockId }, select: { id: true, tripId: true } })
  if (found.length !== blockTripIds.length) throw new NotFoundException('Uma ou mais viagens não encontradas neste bloco')

  const targetBlock = await tx.vehicleBlock.findUnique({ where: { id: targetBlockId }, select: { id: true } })
  if (!targetBlock) throw new NotFoundException('Bloco destino não encontrado')

  const maxSeq = await tx.blockTrip.aggregate({ where: { vehicleBlockId: targetBlockId }, _max: { sequence: true } })
  let nextSequence = (maxSeq._max.sequence ?? 0) + 1

  // Intervals live attached to the trip that precedes them (positional, no FK — see
  // block-interval.utils.ts). Moving a trip without also moving its interval leaves
  // it orphaned, so it's dropped unless the caller explicitly included it (breakIds).
  const tripIds              = found.map((f: any) => f.tripId)
  const anchoredIntervalIds  = await findIntervalIdsAnchoredToTrips(tx, blockId, tripIds)
  const movedIntervalIds     = breakIds.filter(bid => anchoredIntervalIds.includes(bid))
  const orphanedIntervalIds  = anchoredIntervalIds.filter(bid => !movedIntervalIds.includes(bid))

  for (const btId of blockTripIds) {
    await tx.blockTrip.update({ where: { id: btId }, data: { vehicleBlockId: targetBlockId, sequence: nextSequence++ } })
  }
  if (movedIntervalIds.length > 0) {
    await tx.blockInterval.updateMany({ where: { id: { in: movedIntervalIds } }, data: { vehicleBlockId: targetBlockId } })
  }
  if (orphanedIntervalIds.length > 0) {
    await tx.blockInterval.deleteMany({ where: { id: { in: orphanedIntervalIds } } })
  }
  // Deadruns have no anchor concept — only moved when explicitly selected, so there's
  // no orphaned set to clean up. Scoped to blockId so a stray id is silently ignored.
  if (deadrunIds.length > 0) {
    await tx.blockDeadrun.updateMany({ where: { id: { in: deadrunIds }, vehicleBlockId: blockId }, data: { vehicleBlockId: targetBlockId } })
  }
  await tx.vehicleBlock.update({ where: { id: blockId },       data: { isStale: true } })
  await tx.vehicleBlock.update({ where: { id: targetBlockId }, data: { isStale: true } })
}
