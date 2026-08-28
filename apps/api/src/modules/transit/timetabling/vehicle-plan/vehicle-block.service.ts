import { Injectable } from '@nestjs/common'
import { vehicleBlockSchema, VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

// Block-level mutations that used to live here (addAccess, addReturn, updateDeadruns,
// deleteDeadruns, updateIntervals, deleteIntervals, moveTrip) moved to
// block-mutation.utils.ts — they're only ever called from VehiclePlanService.applyDiff
// now, inside its single transaction, never standalone. See docs/proposal/
// vehicle-plan-summary-score-consolidation.md §2.4/§2.5.
@Injectable()
export class VehicleBlockService extends BaseService<VehicleBlock, CreateVehicleBlockDto, UpdateVehicleBlockDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'vehicleBlock', vehicleBlockSchema, 'transit')
  }

  protected buildSearchWhere(_search: string) {
    return {}
  }

  // summary/constraints are only ever written by recalculate()/applyDiff or by
  // lock()/unlock() below — a generic PATCH must not be able to overwrite them
  // directly. See docs/proposal/vehicle-plan-summary-score-consolidation.md §2.3.
  override async update(id: string, dto: UpdateVehicleBlockDto): Promise<VehicleBlock> {
    const { summary: _summary, constraints: _constraints, ...rest } = dto as any
    return super.update(id, rest)
  }

  async lock(id: string): Promise<VehicleBlock> {
    await this.findOne(id)
    const updated = await this.prisma.vehicleBlock.update({ where: { id }, data: { constraints: { locked: true } } })
    return updated as unknown as VehicleBlock
  }

  async unlock(id: string): Promise<VehicleBlock> {
    await this.findOne(id)
    const updated = await this.prisma.vehicleBlock.update({ where: { id }, data: { constraints: {} } })
    return updated as unknown as VehicleBlock
  }
}
