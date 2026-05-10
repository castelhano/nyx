import { z } from 'zod'

export type ChildResourceDef = {
  resource:     string
  domain?:      string
  label:        string
  contextField: string
}

export type BreadcrumbDef = {
  resource:     string
  domain?:      string
  contextField: string
  listLabel?:   string
  nameField?:   string
}

export type SchemaMeta<T extends z.ZodRawShape> = {
  label?:       string
  labelPlural?: string
  nameField?:   string
  allowCsv?:    boolean
  breadcrumb?:  BreadcrumbDef[]
  children?:    ChildResourceDef[]
  groups?:      { [tabLabel: string]: (keyof T & string)[] }
}

export function withMeta<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  meta: SchemaMeta<T>,
): z.ZodObject<T> {
  ;(schema as any)._schemaMeta = meta
  return schema
}
