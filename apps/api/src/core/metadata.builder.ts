import {
  ZodType, ZodObject, ZodString, ZodNumber, ZodBoolean,
  ZodDate, ZodEnum, ZodOptional, ZodNullable, ZodDefault,
} from 'zod'
import type { ResourceMetadata, MetadataField, TabGroup, ChildResourceDef, RowActionDef } from '@nyx/types'
import { resourceRegistry } from './resource-registry'
import { resolveFilterDef } from './filter.builder'

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

function extractTemplate(fn: (row: any) => string): string {
  const proxy = new Proxy({}, { get: (_, key) => `{${String(key)}}` })
  return fn(proxy)
}

function serializeRowActions(actions: any[] | undefined): RowActionDef[] | undefined {
  if (!actions?.length) return undefined
  return actions.map(({ href, endpoint, ...rest }) => ({
    ...rest,
    ...(href     ? { hrefTemplate:     extractTemplate(href) }     : {}),
    ...(endpoint ? { endpointTemplate: extractTemplate(endpoint) } : {}),
  }))
}

function deriveChildren(resource: string): ChildResourceDef[] | undefined {
  const children: ChildResourceDef[] = []

  for (const entry of resourceRegistry) {
    if (entry.resource === resource) continue
    const m = (entry.schema as any)._schemaMeta
    if (!m?.breadcrumb) continue
    const breadcrumbEntry = (m.breadcrumb as any[]).find((b) => b.resource === resource)
    if (!breadcrumbEntry) continue
    children.push({
      resource:     entry.resource,
      domain:       entry.domain,
      label:        m.labelPlural ?? toTitleCase(entry.resource),
      contextField: breadcrumbEntry.contextField,
      ...(breadcrumbEntry.keybind  ? { keybind:            breadcrumbEntry.keybind } : {}),
      ...(m.privatePermissions     ? { privatePermissions: true }                    : {}),
    })
  }

  return children.length > 0 ? children : undefined
}

export function buildMetadata(resource: string, schema: ZodObject<any>): ResourceMetadata {
  const schemaMeta = (schema as any)._schemaMeta ?? (schema as any)._fieldMeta ?? {}

  const rawGroups = schemaMeta.groups as Record<string, string[]> | undefined
  const fieldGroupMap = new Map<string, string>()
  if (rawGroups) {
    for (const [tabLabel, fieldNames] of Object.entries(rawGroups)) {
      for (const fieldName of fieldNames) {
        fieldGroupMap.set(fieldName, tabLabel)
      }
    }
  }

  const fields: MetadataField[] = []

  for (const [name, rawField] of Object.entries(schema.shape)) {
    const field = rawField as ZodType
    const meta  = (field as any)._fieldMeta ?? {}
    const type  = getType(field)
    const inner = unwrap(field)

    const isPassword  = name === 'passwordHash' || meta.widget === 'password'
    const isTimestamp = name === 'createdAt' || name === 'updatedAt'
    const isId        = name === 'id'
    const defaultValue = field instanceof ZodDefault ? (field as any)._def.defaultValue() : undefined

    let listVisibility: 'visible' | 'hidden' | 'never'
    if (meta.listVisibility) {
      listVisibility = meta.listVisibility
    } else if (isId || isPassword) {
      listVisibility = 'never'
    } else if (isTimestamp) {
      listVisibility = 'hidden'
    } else {
      listVisibility = 'visible'
    }

    fields.push({
      name,
      label:          meta.label      ?? toTitleCase(name),
      type,
      required:       isRequired(field),
      options:        type === 'enum' ? (inner as ZodEnum<any>)._def.values : undefined,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      listVisibility,
      showInForm: meta.showInForm ?? (!isId && !isPassword && !isTimestamp),
      sortable:   meta.sortable   ?? (['string', 'number', 'date', 'enum'] as string[]).includes(type),
      ...(meta.placeholder         ? { placeholder: meta.placeholder }         : {}),
      ...(meta.helpText            ? { helpText:    meta.helpText }             : {}),
      ...(meta.mask                ? { mask:        meta.mask }                 : {}),
      ...(meta.widget              ? { widget:      meta.widget }               : {}),
      ...(meta.min !== undefined   ? { min:         meta.min }                  : {}),
      ...(meta.max !== undefined   ? { max:         meta.max }                  : {}),
      ...(meta.className           ? { className:   meta.className }            : {}),
      ...(meta.resource            ? { resource:    meta.resource }             : {}),
      ...(meta.labelField          ? { labelField:  meta.labelField }           : {}),
      ...(meta.keybind             ? { keybind:     meta.keybind }              : {}),
      ...(fieldGroupMap.has(name)  ? { group:       fieldGroupMap.get(name)! }  : {}),
      ...(resolveFilterDef(field, meta.filter) ? { filter: resolveFilterDef(field, meta.filter) } : {}),
    })
  }

  const defaultLabel = toTitleCase(resource)
  const label        = schemaMeta.label       ?? defaultLabel
  const labelPlural  = schemaMeta.labelPlural ?? `${label}s`
  const nameField    = schemaMeta.nameField   ?? 'name'
  const allowCsv     = schemaMeta.allowCsv    ?? true
  const isSingleton  = schemaMeta.isSingleton === true
  const breadcrumb   = schemaMeta.breadcrumb  as import('@nyx/types').BreadcrumbDef[]      | undefined
  const children     = deriveChildren(resource)
  const rowActions   = serializeRowActions(schemaMeta.rowActions)

  const groups: TabGroup[] | undefined = rawGroups
    ? Object.keys(rawGroups).map((tabLabel) => ({ label: tabLabel, fields: rawGroups[tabLabel] }))
    : undefined

  return {
    resource,
    label,
    labelPlural,
    nameField,
    allowCsv,
    ...(isSingleton ? { isSingleton } : {}),
    permissions: { create: true, read: true, update: true, delete: true },
    fields,
    actions: [],
    ...(groups      ? { groups }      : {}),
    ...(breadcrumb  ? { breadcrumb }  : {}),
    ...(children    ? { children }    : {}),
    ...(rowActions  ? { rowActions }  : {}),
  }
}
