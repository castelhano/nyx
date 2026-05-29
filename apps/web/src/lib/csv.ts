import type { MetadataField } from '@nyx/types'

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  const str = String(value)
  return str.includes(';') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str
}

export function downloadCsv(
  rows:     Record<string, unknown>[],
  fields:   MetadataField[],
  filename: string,
) {
  const cols    = fields.filter((f) => f.listVisibility !== 'never')
  const headers = cols.map((f) => f.label).join(';')
  const lines   = rows.map((row) => cols.map((f) => {
    if (f.widget === 'select' && f.labelField && f.name.endsWith('Id')) {
      const rel = f.name.slice(0, -2)
      const obj = row[rel]
      if (obj && typeof obj === 'object') return escapeCell((obj as Record<string, unknown>)[f.labelField])
    }
    if (f.widget === 'currency') {
      const num = parseFloat(String(row[f.name]))
      if (!isNaN(num)) return escapeCell(num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    }
    return escapeCell(row[f.name])
  }).join(';'))
  const csv     = [headers, ...lines].join('\n')

  // BOM UTF-8 (﻿) garante que o Excel abra acentos e cedilha corretamente
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
