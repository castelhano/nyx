import {
  ZodType, ZodObject, ZodString, ZodNumber, ZodBoolean,
  ZodDate, ZodEnum, ZodOptional, ZodNullable, ZodDefault,
} from 'zod'
import type { ResourceMetadata, MetadataField } from '@nyx/types'

function unwrap(field: ZodType): ZodType {
  if (field instanceof ZodOptional || field instanceof ZodNullable || field instanceof ZodDefault) {
    return unwrap((field as any)._def.innerType)
  }
  return field
}

function getType(field: ZodType): MetadataField['type'] {
  const inner = unwrap(field)
  if (inner instanceof ZodString)  return 'string'
  if (inner instanceof ZodNumber)  return 'number'
  if (inner instanceof ZodBoolean) return 'boolean'
  if (inner instanceof ZodDate)    return 'date'
  if (inner instanceof ZodEnum)    return 'enum'
  return 'string'
}

function isRequired(field: ZodType): boolean {
  return !(field instanceof ZodOptional) && !(field instanceof ZodNullable)
}

function toTitleCase(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

export function buildMetadata(resource: string, schema: ZodObject<any>): ResourceMetadata {
  const schemaMeta = (schema as any)._fieldMeta ?? {}
  const fields: MetadataField[] = []

  for (const [name, rawField] of Object.entries(schema.shape)) {
    const field = rawField as ZodType
    const meta  = (field as any)._fieldMeta ?? {}
    const type  = getType(field)
    const inner = unwrap(field)

    const isPassword  = name === 'passwordHash' || meta.widget === 'password'
    const isTimestamp = name === 'createdAt' || name === 'updatedAt'
    const isId        = name === 'id'

    fields.push({
      name,
      label:      meta.label      ?? toTitleCase(name),
      type,
      required:   isRequired(field),
      options:    type === 'enum' ? (inner as ZodEnum<any>)._def.values : undefined,
      showInList: meta.showInList ?? (!isId && !isPassword && !isTimestamp),
      showInForm: meta.showInForm ?? (!isId && !isPassword && !isTimestamp),
      sortable:   meta.sortable   ?? (['string', 'number', 'date', 'enum'] as string[]).includes(type),
      searchable: meta.searchable ?? false,
      ...(meta.placeholder ? { placeholder: meta.placeholder } : {}),
      ...(meta.helpText    ? { helpText:    meta.helpText }    : {}),
      ...(meta.mask        ? { mask:        meta.mask }        : {}),
      ...(meta.widget      ? { widget:      meta.widget }      : {}),
      ...(meta.width       ? { width:       meta.width }       : {}),
      ...(meta.resource    ? { resource:    meta.resource }    : {}),
      ...(meta.labelField  ? { labelField:  meta.labelField }  : {}),
    })
  }

  const defaultLabel  = toTitleCase(resource)
  const label         = schemaMeta.label       ?? defaultLabel
  const labelPlural   = schemaMeta.labelPlural ?? `${label}s`

  return {
    resource,
    label,
    labelPlural,
    permissions: { create: true, read: true, update: true, delete: true },
    fields,
    actions:     [],
  }
}
