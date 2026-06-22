import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { vehicleBlockSchema, VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class VehicleBlockService extends BaseService<VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'vehicleBlock', vehicleBlockSchema, 'transit')
  }

  protected buildSearchWhere(_search: string) {
    return {}
  }

  async addAccess(blockId: string, blockTripId: string, depotLocalityId: string): Promise<void> {
    const db = this.prisma as any

    const target = await db.blockTrip.findUnique({
      where:  { id: blockTripId },
      select: {
        id:             true,
        vehicleBlockId: true,
        trip: {
          select: {
            departureMinutes: true,
            route: { select: { originLocality: { select: { id: true } } } },
          },
        },
      },
    })

    if (!target || target.vehicleBlockId !== blockId) {
      throw new NotFoundException('Viagem não encontrada neste bloco')
    }

    const originLocalityId = target.trip.route.originLocality.id

    const travelTime = await db.travelTimeMatrix.findUnique({
      where: { originId_destinationId: { originId: depotLocalityId, destinationId: originLocalityId } },
    })

    if (!travelTime) {
      throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')
    }

    const deadheadMinutes = Math.round(travelTime.baseMinutes * travelTime.speedRatio)

    await db.$transaction(async (tx: any) => {
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
    })
  }

  async deleteDeadruns(blockId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const db = this.prisma as any
    const found = await db.blockDeadrun.findMany({
      where:  { id: { in: ids }, vehicleBlockId: blockId },
      select: { id: true },
    })
    if (found.length !== ids.length) {
      throw new NotFoundException('Um ou mais vazios não encontrados neste bloco')
    }
    await db.$transaction(async (tx: any) => {
      await tx.blockDeadrun.deleteMany({ where: { id: { in: ids } } })
      await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
    })
  }

  async moveTrip(blockId: string, blockTripId: string, targetBlockId: string): Promise<void> {
    if (targetBlockId === blockId) throw new BadRequestException('Bloco destino igual ao bloco de origem')
    const db = this.prisma as any

    const blockTrip = await db.blockTrip.findUnique({
      where:  { id: blockTripId },
      select: { id: true, vehicleBlockId: true },
    })
    if (!blockTrip || blockTrip.vehicleBlockId !== blockId) {
      throw new NotFoundException('Viagem não encontrada neste bloco')
    }

    const targetBlock = await db.vehicleBlock.findUnique({
      where:  { id: targetBlockId },
      select: { id: true },
    })
    if (!targetBlock) throw new NotFoundException('Bloco destino não encontrado')

    const maxSeq = await db.blockTrip.aggregate({
      where: { vehicleBlockId: targetBlockId },
      _max:  { sequence: true },
    })
    const nextSequence = (maxSeq._max.sequence ?? 0) + 1

    await db.$transaction(async (tx: any) => {
      await tx.blockTrip.update({
        where: { id: blockTripId },
        data:  { vehicleBlockId: targetBlockId, sequence: nextSequence },
      })
      await tx.vehicleBlock.update({ where: { id: blockId },       data: { isStale: true } })
      await tx.vehicleBlock.update({ where: { id: targetBlockId }, data: { isStale: true } })
    })
  }

  async addReturn(blockId: string, blockTripId: string, depotLocalityId: string): Promise<void> {
    const db = this.prisma as any

    const target = await db.blockTrip.findUnique({
      where:  { id: blockTripId },
      select: {
        id:             true,
        vehicleBlockId: true,
        trip: {
          select: {
            arrivalMinutes: true,
            route: { select: { destinationLocality: { select: { id: true } } } },
          },
        },
      },
    })

    if (!target || target.vehicleBlockId !== blockId) {
      throw new NotFoundException('Viagem não encontrada neste bloco')
    }

    const destinationLocalityId = target.trip.route.destinationLocality.id

    const travelTime = await db.travelTimeMatrix.findUnique({
      where: { originId_destinationId: { originId: destinationLocalityId, destinationId: depotLocalityId } },
    })

    if (!travelTime) {
      throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')
    }

    const deadheadMinutes = Math.round(travelTime.baseMinutes * travelTime.speedRatio)

    await db.$transaction(async (tx: any) => {
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
    })
  }
}
