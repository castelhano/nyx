import { Injectable } from '@nestjs/common'
import { tripSchema, Trip, CreateTripDto, UpdateTripDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import type { PaginatedResult, PaginationQuery } from '@nyx/types'

@Injectable()
export class TripService extends BaseService<Trip, CreateTripDto, UpdateTripDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transitTrip', tripSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    const asNumber = parseInt(search, 10)
    return isNaN(asNumber)
      ? {}
      : { OR: [{ departureMinutes: asNumber }, { arrivalMinutes: asNumber }] }
  }

  private async fetchDayTypeMap(tripIds: string[]): Promise<Map<string, string[]>> {
    if (tripIds.length === 0) return new Map()
    const links = await this.prisma.tripDayType.findMany({ where: { tripId: { in: tripIds } } })
    const map = new Map<string, string[]>()
    for (const link of links) {
      if (!map.has(link.tripId)) map.set(link.tripId, [])
      map.get(link.tripId)!.push(link.dayTypeId)
    }
    return map
  }

  override async findAll(query: PaginationQuery): Promise<PaginatedResult<Trip>> {
    const result = await super.findAll(query)
    const map = await this.fetchDayTypeMap((result.data as any[]).map((t: any) => t.id))
    return {
      ...result,
      data: (result.data as any[]).map(t => ({ ...t, dayTypeIds: map.get(t.id) ?? [] })),
    }
  }

  override async findOne(id: string): Promise<Trip> {
    const trip = await super.findOne(id) as any
    const map = await this.fetchDayTypeMap([id])
    return { ...trip, dayTypeIds: map.get(id) ?? [] } as any
  }

  override async create(dto: CreateTripDto): Promise<Trip> {
    const d = dto as any
    const dayTypeIds: string[] = Array.isArray(d.dayTypeIds) ? d.dayTypeIds : []
    const record = await this.prisma.transitTrip.create({
      data: {
        routeId:             d.routeId,
        departureMinutes:    typeof d.departureMinutes === 'string' ? parseInt(d.departureMinutes, 10) : d.departureMinutes,
        arrivalMinutes:      typeof d.arrivalMinutes   === 'string' ? parseInt(d.arrivalMinutes, 10)   : d.arrivalMinutes,
        requiredVehicleType: d.requiredVehicleType || null,
        constraints:         d.constraints ?? null,
        notes:               d.notes       || null,
        dayTypes:            { create: dayTypeIds.map(dayTypeId => ({ dayTypeId })) },
      },
    })
    return { ...record, dayTypeIds } as any
  }

  override async update(id: string, dto: UpdateTripDto): Promise<Trip> {
    await this.findOne(id)
    const d = dto as any
    const data: Record<string, any> = {}
    if (d.routeId             !== undefined) data.routeId             = d.routeId
    if (d.departureMinutes    !== undefined) data.departureMinutes    = typeof d.departureMinutes === 'string' ? parseInt(d.departureMinutes, 10) : d.departureMinutes
    if (d.arrivalMinutes      !== undefined) data.arrivalMinutes      = typeof d.arrivalMinutes   === 'string' ? parseInt(d.arrivalMinutes, 10)   : d.arrivalMinutes
    if (d.requiredVehicleType !== undefined) data.requiredVehicleType = d.requiredVehicleType || null
    if (d.constraints         !== undefined) data.constraints         = d.constraints ?? null
    if (d.notes               !== undefined) data.notes               = d.notes || null
    if (Array.isArray(d.dayTypeIds)) {
      data.dayTypes = {
        deleteMany: {},
        create: (d.dayTypeIds as string[]).map(dayTypeId => ({ dayTypeId })),
      }
    }
    await this.prisma.transitTrip.update({ where: { id }, data })
    await this.prisma.vehicleBlock.updateMany({
      where: { blockTrips: { some: { tripId: id } } },
      data:  { isStale: true },
    })
    const map = await this.fetchDayTypeMap([id])
    const updated = await super.findOne(id) as any
    return { ...updated, dayTypeIds: map.get(id) ?? [] } as any
  }
}
