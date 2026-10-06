import type {
  ExportFields, ExportLayoutDef, ExportLayoutField, ExportPreview, ExportValidationError,
} from './plan-export.types'

// Pure formatting/validation of a plan export — shared by the API (tests) and the web,
// which builds the file from the (possibly edited) preview.

export function layoutPositions(layout: ExportLayoutField[]): number[] {
  let pos = 1
  return layout.map(f => { const p = pos; pos += f.size; return p })
}

export function formatField(value: string, f: ExportLayoutField): string {
  const s = f.align === 'R' ? value.padStart(f.size, f.pad) : value.padEnd(f.size, f.pad)
  return s.slice(0, f.size)
}

// one line per row; program and table fields repeat on every row of theirs
export function formatExport(def: ExportLayoutDef, preview: ExportPreview): string {
  const lines: string[] = []
  for (const program of preview.programs) {
    for (const carro of program.carros) {
      for (const table of carro.tables) {
        for (const row of table.rows) {
          const merged: ExportFields = { ...program.fields, ...table.fields, ...row.fields }
          lines.push(def.layout.map(f => formatField(merged[f.field] ?? '', f)).join(''))
        }
      }
    }
  }
  return lines.join('\r\n')
}

const HHMM = /^\d{2}:\d{2}$/

function checkValue(f: ExportLayoutField, value: string): string | null {
  if (!value) return f.required ? 'Obrigatório' : null
  if (value.length > f.size) return `Máximo de ${f.size} caracteres`
  if (f.mask === 'HH:MM' && !HHMM.test(value)) return 'Formato HH:MM'
  if (f.pattern && !new RegExp(`^(?:${f.pattern})$`).test(value)) return 'Valor inválido'
  return null
}

// Values never get truncated in the file: a truncated code imports silently and points
// somewhere else, so anything out of the layout's bounds blocks the export instead.
export function validateExport(def: ExportLayoutDef, preview: ExportPreview): ExportValidationError[] {
  const errors: ExportValidationError[] = []
  const byLevel = (level: ExportLayoutField['level']) => def.layout.filter(f => f.level === level)

  preview.programs.forEach((program, p) => {
    for (const f of byLevel('program')) {
      const msg = checkValue(f, program.fields[f.field] ?? '')
      if (msg) errors.push({ program: p, field: f.field, message: msg })
    }

    const seen = new Map<string, Set<string>>()
    program.carros.forEach((carro, c) => {
      carro.tables.forEach((table, t) => {
        for (const f of byLevel('table')) {
          const value = table.fields[f.field] ?? ''
          const msg = checkValue(f, value)
          if (msg) errors.push({ program: p, carro: c, table: t, field: f.field, message: msg })
          if (f.uniqueInProgram && value) {
            const set = seen.get(f.field) ?? new Set<string>()
            if (set.has(value)) errors.push({ program: p, carro: c, table: t, field: f.field, message: 'Duplicado na programação' })
            set.add(value)
            seen.set(f.field, set)
          }
        }
        table.rows.forEach((row, r) => {
          for (const f of byLevel('row')) {
            const msg = checkValue(f, row.fields[f.field] ?? '')
            if (msg) errors.push({ program: p, carro: c, table: t, row: r, field: f.field, message: msg })
          }
        })
      })
    })
  })

  return errors
}
