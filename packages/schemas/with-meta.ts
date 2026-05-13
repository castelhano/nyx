import { z } from 'zod'

export type ChildResourceDef = {
  resource:     string
  domain?:      string
  label:        string
  contextField: string
  keybind?:     string
}

export type BreadcrumbDef = {
  resource:     string
  domain?:      string
  contextField: string
  listLabel?:   string
  nameField?:   string
  keybind?:     string   // atalho do botão que o PAI renderiza para navegar até este filho
}

export type SchemaMeta<T extends z.ZodRawShape> = {
  label?:       string
  labelPlural?: string
  nameField?:   string
  allowCsv?:    boolean
  icon?:        string   // nome do ícone — resolvido pelo frontend via lib/icons.ts
  breadcrumb?:  BreadcrumbDef[]
  groups?:      { [tabLabel: string]: (keyof T & string)[] }
  // 'children' não existe mais no schema — é derivado automaticamente pelo backend via resourceRegistry
}

export function withMeta<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  meta: SchemaMeta<T>,
): z.ZodObject<T> {
  ;(schema as any)._schemaMeta = meta
  return schema
}
