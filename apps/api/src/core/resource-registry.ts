import { ZodObject } from 'zod'

export interface RegistryEntry {
  domain:   string
  resource: string
  schema:   ZodObject<any>
}

export const resourceRegistry: RegistryEntry[] = []
