import { ZodObject } from 'zod'

// How Settings.scope is keyed for a given settings key: a single 'global' row, or one row
// per branchId / transit Scope.id (each falling back to the 'global' row when absent).
export type SettingsScope = 'global' | 'branch' | 'transitScope'

export interface SettingsEntry {
  key:    string
  domain: string
  schema: ZodObject<any>
  scope:  SettingsScope
}

export const settingsRegistry: SettingsEntry[] = []
