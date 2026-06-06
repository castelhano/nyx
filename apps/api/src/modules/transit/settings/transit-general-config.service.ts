import { Injectable } from '@nestjs/common'
import { generalSettingsSchema, GeneralSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class TransitGeneralConfigService {
  private readonly key = 'transit.general'

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<GeneralSettings> {
    const row = await this.prisma.settings.findUnique({
      where: { key_scope: { key: this.key, scope: 'global' } },
    })
    return generalSettingsSchema.parse(row?.value ?? {}) as GeneralSettings
  }

  async put(dto: unknown): Promise<GeneralSettings> {
    const validated = generalSettingsSchema.parse(dto)
    const row = await this.prisma.settings.upsert({
      where:  { key_scope: { key: this.key, scope: 'global' } },
      update: { value: validated as object },
      create: { key: this.key, scope: 'global', value: validated as object },
    })
    return row.value as GeneralSettings
  }
}
