import type { MetadataField } from '@nyx/types'
import { formatDuration } from './duration'

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
    if ((f.widget === 'select' || f.widget === 'combobox') && f.labelField && f.name.endsWith('Id')) {
      const rel = f.name.slice(0, -2)
      const obj = row[rel]
      if (obj && typeof obj === 'object') return escapeCell((obj as Record<string, unknown>)[f.labelField])
    }
    if (f.widget === 'time' && typeof row[f.name] === 'number') return escapeCell(formatDuration(row[f.name] as number))
    if (f.widget === 'currency') {
      const num = parseFloat(String(row[f.name]))
      if (!isNaN(num)) return escapeCell(num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    }
    return escapeCell(row[f.name])
  }).join(';'))
  save([headers, ...lines].join('\n'), filename)
}

export function downloadCsvRows(headers: string[], rows: unknown[][], filename: string) {
  save([headers.map(escapeCell).join(';'), ...rows.map(r => r.map(escapeCell).join(';'))].join('\n'), filename)
}

function save(csv: string, filename: string) {
  // BOM UTF-8 (U+FEFF) garante que o Excel abra acentos e cedilha corretamente
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
