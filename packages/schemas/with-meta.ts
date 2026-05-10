import { z } from 'zod'

export type SchemaMeta<T extends z.ZodRawShape> = {
  label?:       string
  labelPlural?: string
  nameField?:   string
  allowCsv?:    boolean
  groups?:      { [tabLabel: string]: (keyof T & string)[] }
}

export function withMeta<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  meta: SchemaMeta<T>,
): z.ZodObject<T> {
  ;(schema as any)._schemaMeta = meta
  return schema
}
