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
  const lines   = rows.map((row) => cols.map((f) => escapeCell(row[f.name])).join(';'))
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
