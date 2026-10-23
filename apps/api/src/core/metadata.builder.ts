import {
  ZodType, ZodObject, ZodString, ZodNumber, ZodBoolean,
  ZodDate, ZodEnum, ZodOptional, ZodNullable, ZodDefault, ZodArray, ZodRecord,
} from 'zod'
import type { ResourceMetadata, MetadataField, TabGroup, ChildResourceDef, RowActionDef, ImportColumn } from '@nyx/types'
import { resourceRegistry } from './resource-registry'
import { resolveFilterDef } from './filter.builder'

export function unwrap(field: ZodType): ZodType {
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
  if (inner instanceof ZodArray)   return 'array'
  return 'string'
}

function isRequired(field: ZodType): boolean {
  return !(field instanceof ZodOptional) && !(field instanceof ZodNullable) && !(field instanceof ZodDefault)
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
  const children: (ChildResourceDef & { order: number })[] = []

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
      ...(breadcrumbEntry.overflow ? { overflow:           true }                    : {}),
      ...(m.privatePermissions     ? { privatePermissions: true }                    : {}),
      ...(m.importKey              ? { importable:         true }                    : {}),
      order:        breadcrumbEntry.order ?? 0,
    })
  }

  // registration order follows Nest's module instantiation — `order` pins it where it matters
  children.sort((a, b) => a.order - b.order)
  return children.length > 0 ? children.map(({ order: _order, ...child }) => child) : undefined
}

function buildNestedFields(shape: Record<string, ZodType>): MetadataField[] {
  return Object.entries(shape).map(([name, rawField]) => {
    const field = rawField
    const meta  = (field as any).meta?.() ?? {}
    const inner = unwrap(field)

    if (inner instanceof ZodObject) {
      return {
        name,
        label:          meta.label ?? toTitleCase(name),
        type:           'object' as const,
        required:       isRequired(field),
        listVisibility: 'never'  as const,
        showInForm:     meta.showInForm ?? true,
        sortable:       false,
        fields:         buildNestedFields((inner as ZodObject<any>).shape),
        ...(meta.placeholder ? { placeholder: meta.placeholder } : {}),
      }
    }

    // dynamic-keyed object (e.g. metrics.windows, keyed by DayType.code — a free-text
    // resource, not a fixed enum, so it can't be modeled as ZodObject-with-known-keys).
    // The *value* shape is still static, so it's introspected once here; which keys
    // actually exist is data, resolved client-side from the record being edited.
    if (inner instanceof ZodRecord) {
      const valueInner = unwrap((inner as any)._def.valueType as ZodType)
      return {
        name,
        label:          meta.label ?? toTitleCase(name),
        type:           'record' as const,
        required:       isRequired(field),
        listVisibility: 'never'  as const,
        showInForm:     meta.showInForm ?? true,
        sortable:       false,
        ...(valueInner instanceof ZodObject
          ? { fields: buildNestedFields((valueInner as ZodObject<any>).shape) }
          : {}),
        ...(meta.placeholder ? { placeholder: meta.placeholder } : {}),
        // resource whose rows are the allowed keys — lets the editor add/remove them
        ...(meta.resource ? { resource: meta.resource, domain: meta.domain, keyField: meta.keyField ?? 'id', labelField: meta.labelField } : {}),
      }
    }

    if (inner instanceof ZodArray) {
      const elementInner = unwrap((inner as any)._def.element)
      return {
        name,
        label:          meta.label ?? toTitleCase(name),
        type:           'array' as const,
        required:       isRequired(field),
        listVisibility: 'never'  as const,
        showInForm:     meta.showInForm ?? true,
        sortable:       false,
        ...(elementInner instanceof ZodObject
          ? { itemFields: buildNestedFields((elementInner as ZodObject<any>).shape) }
          : {}),
        ...(meta.placeholder ? { placeholder: meta.placeholder } : {}),
      }
    }

    return {
      name,
      label:          meta.label ?? toTitleCase(name),
      type:           getType(field),
      required:       isRequired(field),
      listVisibility: 'never'  as const,
      showInForm:     meta.showInForm ?? true,
      sortable:       false,
      ...(meta.placeholder ? { placeholder: meta.placeholder } : {}),
      ...(meta.min !== undefined ? { min: meta.min } : {}),
      ...(meta.max !== undefined ? { max: meta.max } : {}),
      ...(meta.minLength !== undefined ? { minLength: meta.minLength } : {}),
      ...(meta.maxLength !== undefined ? { maxLength: meta.maxLength } : {}),
    }
  })
}

// an array of enum values (multi-select of fixed options) — its options; undefined otherwise
function arrayEnumOptions(inner: ZodType): string[] | undefined {
  const element = unwrap((inner as any)._def.element as ZodType)
  return element instanceof ZodEnum ? Object.keys((element as ZodEnum<any>)._def.entries ?? {}) : undefined
}

const NOT_IMPORTABLE = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash'])

// a field's meta defaultValue as the import applies it — form-only placeholders ($today) don't count
export function importDefault(meta: { defaultValue?: unknown }): unknown {
  const v = meta.defaultValue
  return typeof v === 'string' && v.startsWith('$') ? undefined : v
}

// one import column for a schema field — undefined when the field can't be imported (uploads included)
function importColumn(name: string, field: ZodType, column?: string): ImportColumn | undefined {
  const meta = (field as any).meta?.() ?? {}
  if (NOT_IMPORTABLE.has(name) || meta.importable === false || meta.virtual || meta.computed || meta.showInForm === false || meta.widget === 'avatar') return undefined

  const isRelation = (meta.widget === 'select' || meta.widget === 'combobox' || meta.widget === 'multi-select') && !!meta.resource
  if (unwrap(field) instanceof ZodObject || unwrap(field) instanceof ZodRecord) return undefined
  let type = getType(field) as ImportColumn['type'] | 'array'
  let item: ImportColumn['item']
  let options: string[] | undefined
  // a list column holds `|`-separated values: enums, relations (by their ref) or plain strings
  if (type === 'array') {
    const element = unwrap((unwrap(field) as any)._def.element as ZodType)
    item    = isRelation ? 'relation' : element instanceof ZodEnum ? 'enum' : element instanceof ZodString ? 'string' : undefined
    if (!item) return undefined
    options = item === 'enum' ? Object.keys((element as ZodEnum<any>)._def.entries ?? {}) : undefined
    type    = 'list'
  } else if (isRelation) {
    type = 'relation'
  } else if (type === 'enum') {
    options = Object.keys((unwrap(field) as ZodEnum<any>)._def.entries ?? {})
  }
  return {
    name:     column ?? (type === 'relation' ? name.replace(/Id$/, '') : name),
    field:    name,
    label:    meta.label ?? toTitleCase(name),
    type,
    ...(item ? { item } : {}),
    key:      false,
    required: isRequired(field) && importDefault(meta) === undefined,
    ...(meta.mask ? { mask: meta.mask } : {}),
    ...(options ? { options, values: options.map(o => ({ value: o, label: meta.optionLabels?.[o] ?? o })) } : {}),
    ...(isRelation ? { ref: meta.importRef ?? meta.labelField } : {}),
  }
}

// Columns of the standard CSV import (docs/FLOW.md) — undefined when the schema has no
// importKey. Scalar fields and relations only; virtual, computed and form-hidden fields are out.
// importNested adds a related record's columns (e.g. an employee's new contract), named by the map.
export function buildImportColumns(schema: ZodObject<any>): ImportColumn[] | undefined {
  const schemaMeta = (schema as any)._schemaMeta ?? {}
  const importKey  = schemaMeta.importKey as string | string[] | undefined
  if (!importKey) return undefined
  const keys = Array.isArray(importKey) ? importKey : [importKey]

  const columns: ImportColumn[] = []
  for (const [name, field] of Object.entries({ ...schema.shape, ...(schemaMeta.importFields ?? {}) })) {
    const column = importColumn(name, field as ZodType)
    if (column) columns.push({ ...column, key: keys.includes(name) })
  }

  const missing = keys.filter(k => !columns.some(c => c.field === k))
  if (missing.length) throw new Error(`importKey fields not importable: ${missing.join(', ')}`)

  const nested: ImportColumn[] = []
  for (const [group, def] of Object.entries((schemaMeta.importNested ?? {}) as Record<string, { schema: ZodObject<any>; columns: Record<string, string> }>)) {
    for (const [name, field] of Object.entries(def.columns)) {
      const column = def.schema.shape[field] && importColumn(field, def.schema.shape[field] as ZodType, name)
      if (!column) throw new Error(`importNested ${group}.${field} is not importable`)
      nested.push({ ...column, group, groupLabel: (def.schema as any)._schemaMeta?.label ?? group })
    }
  }

  return [
    ...keys.map(k => columns.find(c => c.field === k)!),
    ...columns.filter(c => !c.key),
    ...nested,
  ]
}

export function buildMetadata(resource: string, schema: ZodObject<any>): ResourceMetadata {
  const schemaMeta = (schema as any)._schemaMeta ?? {}

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
    const meta  = (field as any).meta?.() ?? {}
    const type  = getType(field)
    const inner = unwrap(field)

    const isPassword  = name === 'passwordHash' || meta.widget === 'password'
    const isTimestamp = name === 'createdAt' || name === 'updatedAt'
    const isId        = name === 'id'
    const zodDefault   = field instanceof ZodDefault ? (field as any)._def.defaultValue : undefined
    const defaultValue = meta.defaultValue ?? (typeof zodDefault === 'function' ? zodDefault() : zodDefault)

    let listVisibility: 'visible' | 'hidden' | 'never'
    if (meta.virtual) {
      listVisibility = 'never'
    } else if (meta.listVisibility) {
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
      options:        type === 'enum' ? Object.keys((inner as ZodEnum<any>)._def.entries ?? {})
        : type === 'array' ? arrayEnumOptions(inner) : undefined,
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
      ...(meta.minLength !== undefined ? { minLength: meta.minLength }          : {}),
      ...(meta.maxLength !== undefined ? { maxLength: meta.maxLength }          : {}),
      ...(meta.className           ? { className:   meta.className }            : {}),
      ...(meta.resource                  ? { resource:             meta.resource             } : {}),
      ...(meta.domain                    ? { domain:               meta.domain               } : {}),
      ...(meta.labelField                ? { labelField:           meta.labelField           } : {}),
      ...(meta.relatedDisplayFields      ? { relatedDisplayFields: meta.relatedDisplayFields } : {}),
      ...(meta.relatedWhere              ? { relatedWhere:         meta.relatedWhere         } : {}),
      ...(meta.keybind             ? { keybind:     meta.keybind }              : {}),
      ...(meta.optionLabels        ? { optionLabels: meta.optionLabels }         : {}),
      ...(meta.optionColors        ? { optionColors: meta.optionColors }         : {}),
      ...(meta.virtual             ? { virtual:     true }                      : {}),
      ...(meta.dependsOn           ? { dependsOn:   meta.dependsOn }            : {}),
      ...(meta.lazyEdit            ? { lazyEdit:    true }                      : {}),
      ...(meta.pairField           ? { pairField:   meta.pairField }            : {}),
      ...(meta.suggestEndpoint     ? { suggestEndpoint: meta.suggestEndpoint }  : {}),
      ...(meta.suggestParams       ? { suggestParams: meta.suggestParams }      : {}),
      ...(meta.row                 ? { row:         meta.row }                  : {}),
      ...(fieldGroupMap.has(name)  ? { group:       fieldGroupMap.get(name)! }  : {}),
      ...(resolveFilterDef(field, meta.filter) ? { filter: resolveFilterDef(field, meta.filter) } : {}),
      ...(meta.widget === 'object-editor' && inner instanceof ZodObject
        ? { fields: buildNestedFields(inner.shape), type: 'object' as const }
        : {}),
    })
  }

  const defaultLabel = toTitleCase(resource)
  const label        = schemaMeta.label       ?? defaultLabel
  const labelPlural  = schemaMeta.labelPlural ?? `${label}s`
  const nameField    = schemaMeta.nameField   ?? 'name'
  const allowCsv     = schemaMeta.allowCsv    ?? true
  const isSingleton  = schemaMeta.isSingleton === true
  const breadcrumb     = schemaMeta.breadcrumb     as import('@nyx/types').BreadcrumbDef[] | undefined
  const nameFirstWord  = schemaMeta.nameFirstWord  as boolean | undefined
  const afterCreate    = schemaMeta.afterCreate    as string | undefined
  const stayOnSave     = schemaMeta.stayOnSave     as boolean | undefined
  const defaultFilters = schemaMeta.defaultFilters as Record<string, string> | undefined
  const children     = deriveChildren(resource)
  const rowActions   = serializeRowActions(schemaMeta.rowActions)
  const importColumns = buildImportColumns(schema)

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
    ...(groups       ? { groups }       : {}),
    ...(breadcrumb      ? { breadcrumb }      : {}),
    ...(nameFirstWord !== undefined ? { nameFirstWord } : {}),
    ...(children     ? { children }     : {}),
    ...(rowActions   ? { rowActions }   : {}),
    ...(afterCreate     ? { afterCreate }     : {}),
    ...(stayOnSave      ? { stayOnSave }      : {}),
    ...(defaultFilters  ? { defaultFilters }  : {}),
    ...(importColumns   ? { import: { columns: importColumns, ...(schemaMeta.importNotice ? { notice: schemaMeta.importNotice } : {}) } } : {}),
  }
}
