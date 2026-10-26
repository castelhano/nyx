import { Injectable } from '@nestjs/common'
import { portalPermissionsSchema, portalProfileSchema, PortalProfile, CreatePortalProfileDto, UpdatePortalProfileDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

// The crew portal's profiles per empresa — one of them may be its default (isDefault): marking
// another one unmarks it.
@Injectable()
export class PortalProfileService extends BaseService<PortalProfile, CreatePortalProfileDto, UpdatePortalProfileDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'portalProfile', portalProfileSchema, 'transit', 'branchId')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }

  // the permissions are JSON — checked here, or a bad value (a period typed by hand) would make
  // the portal fall back to the defaults without a word
  override async create(dto: CreatePortalProfileDto): Promise<PortalProfile> {
    const created = await super.create({ ...dto, permissions: portalPermissionsSchema.parse(dto.permissions ?? {}) })
    if (created.isDefault) await this.onlyDefault(created.id, created.branchId)
    return created
  }

  override async update(id: string, dto: UpdatePortalProfileDto): Promise<PortalProfile> {
    const updated = await super.update(id, dto.permissions === undefined ? dto : { ...dto, permissions: portalPermissionsSchema.parse(dto.permissions) })
    if (updated.isDefault) await this.onlyDefault(updated.id, updated.branchId)
    return updated
  }

  private async onlyDefault(id: string, branchId: string): Promise<void> {
    await this.prisma.portalProfile.updateMany({ where: { branchId, isDefault: true, id: { not: id } }, data: { isDefault: false } })
  }
}
