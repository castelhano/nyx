import { describe, expect, it } from 'vitest'
import { ZodObject } from 'zod'
import * as schemas from '@nyx/schemas'
import { buildImportColumns } from '../metadata.builder'
import { buildImportTemplate } from './import.engine'

// The import's "Modelo" CSV is how users learn the file format, so every resource with an
// import must ship examples that name only real columns and show every accepted enum value.
const importable = Object.entries(schemas).filter(
  ([, s]) => s instanceof ZodObject && (s as any)._schemaMeta?.importKey,
) as [string, ZodObject<any>][]

describe('importExamples', () => {
  it('finds the importable schemas', () => {
    expect(importable.length).toBeGreaterThan(0)
  })

  it.each(importable)('%s: examples use import columns and cover every enum value', (_, schema) => {
    const { rows } = buildImportTemplate(schema)
    expect(rows.length).toBeGreaterThan(0)

    const examples = (schema as any)._schemaMeta.importExamples as Record<string, string>[]
    for (const column of buildImportColumns(schema)!.filter(c => c.type === 'enum' || c.item === 'enum')) {
      const used = new Set(examples.flatMap(e => (e[column.name] ?? '').split('|')).filter(Boolean))
      expect(column.options!.filter(o => !used.has(o)), `${column.name} values missing from the examples`).toEqual([])
    }
  })
})
