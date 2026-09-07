import { ZodObject } from 'zod'

export interface RegistryEntry {
  domain:   string
  resource: string
  schema:   ZodObject<any>
  // Prisma delegate name (e.g. 'intervalType') this resource is backed by — undefined for
  // pseudo-resources with no real model (settings singletons). Lets a field elsewhere that
  // points at {domain, resource} (see settings-reference.utils.ts) resolve back to something
  // queryable, without hardcoding a resource-key ↔ model-name mapping anywhere.
  modelName?: string
}

export const resourceRegistry: RegistryEntry[] = []
