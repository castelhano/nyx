import type { ImportColumn } from '@nyx/types'

// Cell → value conversion of the standard import (docs/FLOW.md): dates dd/mm/aaaa, decimal
// comma, booleans SIM/NAO, enums by their stored value. Relations are resolved by the engine.

export type CellResult = { ok: true; value: unknown } | { ok: false; message: string }

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/
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
      return { ok: true, value: raw }
  }
}
