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
        sequence:       true,
        isDeadhead:     true,
        trip: {
          select: {
            routeId:          true,
            dayTypeId:        true,
            departureMinutes: true,
            route: { select: { originLocality: { select: { id: true } } } },
          },
        },
      },
    })

    if (!target || target.vehicleBlockId !== blockId) {
      throw new NotFoundException('Viagem não encontrada neste bloco')
    }
    if (target.isDeadhead) {
      throw new BadRequestException('Não é possível adicionar acesso a uma viagem em vazio')
    }

    const originLocalityId = target.trip.route.originLocality.id

    const travelTime = await db.travelTimeMatrix.findUnique({
      where: { originId_destinationId: { originId: depotLocalityId, destinationId: originLocalityId } },
    })

    if (!travelTime) {
      throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')
    }

    const deadheadMinutes = Math.round(travelTime.baseMinutes * travelTime.speedRatio)
    const targetSeq       = target.sequence

    await db.$transaction(async (tx: any) => {
      // Shift existing block trips down from highest sequence to avoid unique-constraint conflicts
      const toShift = await tx.blockTrip.findMany({
        where:   { vehicleBlockId: blockId, sequence: { gte: targetSeq } },
        select:  { id: true, sequence: true },
        orderBy: { sequence: 'desc' },
      })
      for (const bt of toShift) {
        await tx.blockTrip.update({ where: { id: bt.id }, data: { sequence: bt.sequence + 1 } })
      }

      // 1-minute gap between access arrival and trip departure
      const accessTrip = await tx.transitTrip.create({
        data: {
          routeId:          target.trip.routeId,
          dayTypeId:        target.trip.dayTypeId,
          departureMinutes: target.trip.departureMinutes - deadheadMinutes - 1,
          arrivalMinutes:   target.trip.departureMinutes - 1,
        },
      })

      await tx.blockTrip.create({
        data: {
          vehicleBlockId: blockId,
          tripId:         accessTrip.id,
          sequence:       targetSeq,
          isDeadhead:     true,
          deadheadKm:     travelTime.distanceKm,
        },
      })

      await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
    })
  }

  async addCollection(blockId: string, blockTripId: string, depotLocalityId: string): Promise<void> {
    const db = this.prisma as any

    const target = await db.blockTrip.findUnique({
      where:  { id: blockTripId },
      select: {
        id:             true,
        vehicleBlockId: true,
        sequence:       true,
        isDeadhead:     true,
        trip: {
          select: {
            routeId:        true,
            dayTypeId:      true,
            arrivalMinutes: true,
            route: { select: { destinationLocality: { select: { id: true } } } },
          },
        },
      },
    })

    if (!target || target.vehicleBlockId !== blockId) {
      throw new NotFoundException('Viagem não encontrada neste bloco')
    }
    if (target.isDeadhead) {
      throw new BadRequestException('Não é possível adicionar recolhida a uma viagem em vazio')
    }

    const destinationLocalityId = target.trip.route.destinationLocality.id

    const travelTime = await db.travelTimeMatrix.findUnique({
      where: { originId_destinationId: { originId: destinationLocalityId, destinationId: depotLocalityId } },
    })

    if (!travelTime) {
      throw new NotFoundException('Mapeamento não localizado na matriz entre os pontos informados')
    }

    const deadheadMinutes = Math.round(travelTime.baseMinutes * travelTime.speedRatio)
    const targetSeq       = target.sequence

    await db.$transaction(async (tx: any) => {
      // Shift block trips that come after the selected trip (from highest down)
      const toShift = await tx.blockTrip.findMany({
        where:   { vehicleBlockId: blockId, sequence: { gt: targetSeq } },
        select:  { id: true, sequence: true },
        orderBy: { sequence: 'desc' },
      })
      for (const bt of toShift) {
        await tx.blockTrip.update({ where: { id: bt.id }, data: { sequence: bt.sequence + 1 } })
      }

      // 1-minute gap between trip arrival and collection departure
      const collectionTrip = await tx.transitTrip.create({
        data: {
          routeId:          target.trip.routeId,
          dayTypeId:        target.trip.dayTypeId,
          departureMinutes: target.trip.arrivalMinutes + 1,
          arrivalMinutes:   target.trip.arrivalMinutes + 1 + deadheadMinutes,
        },
      })

      await tx.blockTrip.create({
        data: {
          vehicleBlockId: blockId,
          tripId:         collectionTrip.id,
          sequence:       targetSeq + 1,
          isDeadhead:     true,
          deadheadKm:     travelTime.distanceKm,
        },
      })

      await tx.vehicleBlock.update({ where: { id: blockId }, data: { isStale: true } })
    })
  }
}
