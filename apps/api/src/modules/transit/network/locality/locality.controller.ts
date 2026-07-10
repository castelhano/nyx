import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common'
import { Locality, CreateLocalityDto, UpdateLocalityDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LocalityService } from './locality.service'
import { OsrmService } from '../travel-time/osrm.service'

@Controller('transit/transit-locality')
@UseGuards(JwtAuthGuard)
export class LocalityController extends BaseController<Locality, CreateLocalityDto, UpdateLocalityDto> {
  constructor(
    private readonly localityService: LocalityService,
    private readonly osrm: OsrmService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(localityService, caslFactory)
  }

  // must be defined before :id routes so NestJS matches static segments first
  @Get('nearest')
  async nearest(@Query('lat') lat: string, @Query('lng') lng: string) {
    const result = await this.osrm.getNearestPoint(Number(lat), Number(lng))
    return result
  }

  @Get('next-code')
  async nextCode() {
    return { code: await this.localityService.suggestNextCode() }
  }

  @Get('reverse-geocode')
  async reverseGeocode(@Query('lat') lat: string, @Query('lng') lng: string) {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
    const res = await fetch(url, { headers: { 'User-Agent': 'nyx-transit/1.0' } })
    if (!res.ok) return { display_name: '' }
    const data = await res.json() as { display_name?: string; address?: unknown }
    return { display_name: data.display_name ?? '', address: data.address }
  }

  @Get(':id/routes')
  async localityRoutes(@Param('id') id: string) {
    return this.localityService.findRoutesForLocality(id)
  }

  @Post('snap-sync')
  applySnap(@Body() body: { ids?: string[]; minDistanceM?: number }) {
    return this.localityService.applySnap(body)
  }
}
