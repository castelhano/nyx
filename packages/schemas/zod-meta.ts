import type { FieldMeta } from '@nyx/types'

declare module 'zod' {
  // Module augmentation via declaration merging requires an interface body,
  // even an empty one — a type alias wouldn't merge with zod's own GlobalMeta.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GlobalMeta extends FieldMeta {}
}

export type { FieldMeta }
