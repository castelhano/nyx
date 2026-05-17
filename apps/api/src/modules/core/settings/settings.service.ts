import { Injectable } from '@nestjs/common'
import { settingsPageSchema } from '@nyx/schemas'
import { resourceRegistry } from '../../../core/resource-registry'

@Injectable()
export class SettingsService {
  constructor() {
    resourceRegistry.push({ domain: 'core', resource: 'settings', schema: settingsPageSchema })
  }
}
