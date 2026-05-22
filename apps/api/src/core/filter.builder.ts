import {
  ZodType, ZodOptional, ZodNullable, ZodDefault,
  ZodEnum, ZodBoolean, ZodNumber, ZodDate, ZodObject,
} from 'zod'
import type { FilterDef } from '@nyx/types'
import { stringContains } from './db.utils'

function unwrap(field: ZodType): ZodType {
  if (field instanceof ZodOptional || field instanceof ZodNullable || field instanceof ZodDefault) {
    return unwrap((field as any)._def.innerType)
  }
  return field
}

export function resolveFilterDef(field: ZodType, explicit: boolean | FilterDef | undefined): FilterDef | undefined {
  if (!explicit) return undefined
  if (explicit === true) {
    const inner = unwrap(field)
    if (inner instanceof ZodEnum)    return { type: 'select' }
    if (inner instanceof ZodBoolean) return { type: 'boolean' }
    if (inner instanceof ZodNumber)  return { type: 'number_range' }
    if (inner instanceof ZodDate)    return { type: 'date_range' }
    return { type: 'text' }
  }
  return explicit
}

export function buildFilterWhere(schema: ZodObject<any>, query: Record<string, unknown>): Record<string, unknown> {
  const where: Record<string, unknown> = {}

  for (const [name, rawField] of Object.entries(schema.shape)) {
    const field     = rawField as ZodType
    const meta      = (field as any).meta?.() ?? {}
    const filterDef = resolveFilterDef(field, meta.filter)
    if (!filterDef) continue

    const key = `f_${name}`

    switch (filterDef.type) {
      case 'text': {
        const val = query[key] as string | undefined
        if (val) where[name] = stringContains(val)
        break
      }
      case 'select':
      case 'relation': {
        const val = query[key] as string | undefined
        if (val) where[name] = { equals: val }
        break
      }
      case 'boolean': {
        const val = query[key] as string | undefined
        if (val !== undefined && val !== '') where[name] = { equals: val === 'true' }
        break
      }
      case 'number_range': {
        const min = query[`${key}_min`] as string | undefined
        const max = query[`${key}_max`] as string | undefined
        const cond: Record<string, number> = {}
        if (min) cond.gte = Number(min)
        if (max) cond.lte = Number(max)
        if (Object.keys(cond).length) where[name] = cond
        break
      }
      case 'date_range': {
        const from = query[`${key}_from`] as string | undefined
        const to   = query[`${key}_to`]   as string | undefined
        const cond: Record<string, Date> = {}
        if (from) cond.gte = new Date(from)
        if (to)   cond.lte = new Date(to)
        if (Object.keys(cond).length) where[name] = cond
        break
      }
    }
  }

  return where
}
