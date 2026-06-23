import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { vehicleBlockSchema, VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { VehiclePlanService } from './vehicle-plan.service'

@Injectable()
export class VehicleBlockService extends BaseService<VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto> {
  constructor(
    prisma: PrismaService,
    private readonly vehiclePlanService: VehiclePlanService,
  ) {
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

  async updateDeadruns(
    blockId: string,
    updates: { id: string; departureMinutes: number; arrivalMinutes: number }[],
  ): Promise<void> {
    if (updates.length === 0) return
    const db = this.prisma as any

    const found = await db.blockDeadrun.findMany({
      where:  { id: { in: updates.map(u => u.id) }, vehicleBlockId: blockId },
      select: { id: true },
    })
    if (found.length !== updates.length) {
      throw new NotFoundException('Um ou mais vazios não encontrados neste bloco')
    }

    await db.$transaction(async (tx: any) => {
      for (const u of updates) {
        await tx.blockDeadrun.update({
          where: { id: u.id },
          data:  { departureMinutes: u.departureMinutes, arrivalMinutes: u.arrivalMinutes },
        })
      }
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

  async moveTrip(blockId: string, blockTripIds: string[], targetBlockId: string): Promise<void> {
    if (targetBlockId === blockId) throw new BadRequestException('Bloco destino igual ao bloco de origem')
    if (!blockTripIds.length)      throw new BadRequestException('Nenhuma viagem informada')
    const db = this.prisma as any

    const sourceBlock = await db.vehicleBlock.findUnique({
      where:  { id: blockId },
      select: { id: true, vehiclePlanId: true },
    })
    if (!sourceBlock) throw new NotFoundException('Bloco de origem não encontrado')

    const found = await db.blockTrip.findMany({
      where:  { id: { in: blockTripIds }, vehicleBlockId: blockId },
      select: { id: true },
    })
    if (found.length !== blockTripIds.length) {
      throw new NotFoundException('Uma ou mais viagens não encontradas neste bloco')
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
    let nextSequence = (maxSeq._max.sequence ?? 0) + 1

    await db.$transaction(async (tx: any) => {
      for (const btId of blockTripIds) {
        await tx.blockTrip.update({
          where: { id: btId },
          data:  { vehicleBlockId: targetBlockId, sequence: nextSequence++ },
        })
      }
      await tx.vehicleBlock.update({ where: { id: blockId },       data: { isStale: true } })
      await tx.vehicleBlock.update({ where: { id: targetBlockId }, data: { isStale: true } })
    })

    await this.vehiclePlanService.scorePlan(sourceBlock.vehiclePlanId)
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
