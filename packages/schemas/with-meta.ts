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
  nameField?:   string
  keybind?:     string   // atalho do botão que o PAI renderiza para navegar até este filho
}

export type RowActionInput = {
  action:      string
  label:       string
  icon:        string
  variant?:    'default' | 'destructive'
  group?:      string
  permission:  'create' | 'read' | 'update' | 'delete'
  href?:       (row: Record<string, unknown>) => string
  method?:     'POST' | 'PATCH' | 'DELETE'
  endpoint?:   (row: Record<string, unknown>) => string
  body?:       Record<string, unknown>
}

export type SchemaMeta<T extends z.ZodRawShape> = {
  label?:              string
  labelPlural?:        string
  nameField?:          string
  allowCsv?:           boolean
  icon?:               string       // nome do ícone — resolvido pelo frontend via lib/icons.ts
  isSingleton?:        boolean      // singleton sem lista/create/delete; setado automaticamente pelo BaseSettingsService
  breadcrumb?:         BreadcrumbDef[]
  groups?:             { [tabLabel: string]: (keyof T & string)[] }
  rowActions?:         RowActionInput[]
  privatePermissions?: boolean      // recurso filho que exige concessão explícita — não herda permissões do pai
  defaultSort?:        { field: string; order: 'asc' | 'desc' }
  // 'children' não existe mais no schema — é derivado automaticamente pelo backend via resourceRegistry
}

export function withMeta<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  meta: SchemaMeta<T>,
): z.ZodObject<T> {
  ;(schema as any)._schemaMeta = meta
  return schema
}
