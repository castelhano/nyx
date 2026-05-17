import { ZodObject } from 'zod'

export interface SettingsEntry {
  key:    string
  domain: string
  schema: ZodObject<any>
  scope:  'global' | 'branch'
}

export const settingsRegistry: SettingsEntry[] = []
