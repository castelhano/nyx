import { z } from 'zod'

export type ChildResourceDef = {
  resource:            string
  domain?:             string
  label:               string
  contextField:        string
  keybind?:            string
  privatePermissions?: boolean
}

export type BreadcrumbDef = {
  resource:     string
  domain?:      string
  contextField: string
  listLabel?:   string
  nameField?:    string
  nameFirstWord?: boolean  // show only the first word of the name in the breadcrumb; default true
  keybind?:      string   // shortcut to the button that the parent renders to navigate to this child
  overflow?:     boolean  // force the parent's nav button for this child into the topbar's ⋯ dropdown
}

export type RowActionInput = {
  action:       string
  label:        string
  icon:         string
  variant?:     'default' | 'destructive'
  group?:       string
  permission:   'create' | 'read' | 'update' | 'delete'
  href?:        (row: Record<string, unknown>) => string
  method?:      'POST' | 'PATCH' | 'DELETE'
  endpoint?:    (row: Record<string, unknown>) => string
  body?:        Record<string, unknown>
  visibleWhen?: { field: string; value: unknown }
}

export type SchemaMeta<T extends z.ZodRawShape> = {
  label?:              string
  labelPlural?:        string
  nameField?:          string
  allowCsv?:           boolean
  icon?:               string       // con name — resolved by the frontend via lib/icons.ts
  isSingleton?:        boolean      // singleton without list/create/delete; automatically set by BaseSettingsService
  breadcrumb?:         BreadcrumbDef[]
  groups?:             { [tabLabel: string]: (keyof T & string)[] }
  rowActions?:         RowActionInput[]
  privatePermissions?: boolean      // child resource that requires explicit permission — does not inherit permissions from its parent
  hidden?:             boolean      // exclude from sidebar and discovery entirely (e.g. engine-managed resources)
  nameFirstWord?:      boolean      // show only first word of record name in breadcrumb; default true
  defaultSort?:        { field: string; order: 'asc' | 'desc' }
  afterCreate?:        string       // template with placeholders {fieldName} — redirects after creation instead of going to the list
  defaultFilters?:     Record<string, string>  // pre-applied filters on list load; user can clear/modify them
}

export function withMeta<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  meta: SchemaMeta<T>,
): z.ZodObject<T> {
  ;(schema as any)._schemaMeta = meta
  return schema
}
