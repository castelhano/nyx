import { ZodObject } from 'zod'

export interface ResourcePointerField {
  fieldName: string
  resource:  string
  domain:    string
  label?:    string
}

// A field whose meta carries both `resource` and `domain` names another resource this field's
// value is expected to be the id of — the same meta a select/combobox widget already reads to
// render its dropdown (see block-interval.schema.ts's intervalTypeId). Settings are stored as
// freeform JSON (Settings.value), so Prisma can never enforce this as a real FK — used by
// BaseSettingsService.put() (does the referenced record still exist?) and BaseService.remove()
// (is this record still pointed at by some Settings field?) to fake a cheap version of it.
export function getResourcePointerFields(schema: ZodObject<any>): ResourcePointerField[] {
  const fields: ResourcePointerField[] = []
  for (const [fieldName, rawField] of Object.entries(schema.shape)) {
    const meta = (rawField as any).meta?.() ?? {}
    if (!meta.resource || !meta.domain) continue
    fields.push({ fieldName, resource: meta.resource, domain: meta.domain, label: meta.label })
  }
  return fields
}
