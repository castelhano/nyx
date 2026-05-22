import type { FieldMeta } from '@nyx/types'

declare module 'zod' {
  interface GlobalMeta extends FieldMeta {}
}

export type { FieldMeta }
