import type { ImportColumn } from '@nyx/types'

// Cell → value conversion of the standard import: dates dd/mm/aaaa, times H:MM
// (stored as minutes), decimal comma, booleans SIM/NAO, enums by their stored value. Relations are resolved by the engine.

export type CellResult = { ok: true; value: unknown } | { ok: false; message: string }

// the form's masks (FieldRenderer) — a masked field is stored formatted, so the import formats it too
const MASKS: Record<string, { label: string; patterns: string[] }> = {
  'cpf':       { label: 'CPF',      patterns: ['000.000.000-00'] },
  'cnpj':      { label: 'CNPJ',     patterns: ['00.000.000/0000-00'] },
  'cnpj-base': { label: 'CNPJ',     patterns: ['00.000.000'] },
  'cep':       { label: 'CEP',      patterns: ['00000-000'] },
  'phone':     { label: 'Telefone', patterns: ['(00) 0000-0000', '(00) 00000-0000'] },
}

function applyMask(raw: string, mask: string): CellResult {
  const def = MASKS[mask]
  if (!def) return { ok: true, value: raw }
  const digits  = raw.replace(/\D/g, '')
  const pattern = def.patterns.find(p => (p.match(/0/g) ?? []).length === digits.length)
  if (!pattern) {
    const sizes = def.patterns.map(p => (p.match(/0/g) ?? []).length).join(' ou ')
    return { ok: false, message: `${def.label} inválido (${sizes} dígitos)` }
  }
  let i = 0
  return { ok: true, value: pattern.replace(/0/g, () => digits[i++]) }
}

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const TIME = /^(\d{1,2}):(\d{2})$/
const NUMBER = /^-?\d+(,\d+)?$/

export function parseCell(raw: string, column: ImportColumn, isInt = false): CellResult {
  switch (column.type) {
    case 'date': {
      const m = DATE.exec(raw)
      if (!m) return { ok: false, message: 'Data inválida (use dd/mm/aaaa)' }
      const [, d, mo, y] = m.map(Number)
      const date = new Date(Date.UTC(y, mo - 1, d))
      // rejects 31/02 and the like, which Date would roll over
      if (date.getUTCDate() !== d || date.getUTCMonth() !== mo - 1) return { ok: false, message: 'Data inválida' }
      return { ok: true, value: date }
    }
    case 'time': {
      // past midnight goes on counting (25:10) — the field's own bounds are checked by validation
      const m = TIME.exec(raw)
      if (!m || Number(m[2]) > 59) return { ok: false, message: 'Horário inválido (use H:MM)' }
      return { ok: true, value: Number(m[1]) * 60 + Number(m[2]) }
    }
    case 'number': {
      if (!NUMBER.test(raw)) return { ok: false, message: 'Número inválido (use vírgula para decimais)' }
      if (isInt && raw.includes(',')) return { ok: false, message: 'Informe um número inteiro' }
      return { ok: true, value: Number(raw.replace(',', '.')) }
    }
    case 'boolean': {
      const v = raw.toUpperCase()
      if (v === 'SIM') return { ok: true, value: true }
      if (v === 'NAO') return { ok: true, value: false }
      return { ok: false, message: 'Use SIM ou NAO' }
    }
    case 'enum': {
      const match = column.options?.find(o => o.toUpperCase() === raw.toUpperCase())
      return match ? { ok: true, value: match } : { ok: false, message: `Valor inválido (aceitos: ${column.options?.join(', ')})` }
    }
    default:
      return column.mask ? applyMask(raw, column.mask) : { ok: true, value: raw }
  }
}
