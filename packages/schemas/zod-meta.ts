import { ZodType } from 'zod'
import type { FieldMeta } from '@nyx/types'

declare module 'zod' {
  interface ZodType {
    meta(metadata: FieldMeta): this
    _fieldMeta?: FieldMeta
  }
}

ZodType.prototype.meta = function (metadata: FieldMeta) {
  this._fieldMeta = { ...(this._fieldMeta ?? {}), ...metadata }
  return this
}

export type { FieldMeta }
