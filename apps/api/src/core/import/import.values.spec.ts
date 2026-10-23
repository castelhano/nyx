import { describe, expect, it } from 'vitest'
import type { ImportColumn } from '@nyx/types'
import { parseCell } from './import.values'

const col = (type: ImportColumn['type'], options?: string[]): ImportColumn =>
  ({ name: 'x', field: 'x', label: 'X', type, key: false, required: false, options })

describe('parseCell', () => {
  it('dates: dd/mm/aaaa as UTC midnight, rejecting impossible days', () => {
    expect(parseCell('05/03/2026', col('date'))).toEqual({ ok: true, value: new Date(Date.UTC(2026, 2, 5)) })
    expect(parseCell('31/02/2026', col('date')).ok).toBe(false)
    expect(parseCell('2026-03-05', col('date')).ok).toBe(false)
  })

  it('numbers: decimal comma, integers when the field asks', () => {
    expect(parseCell('1234,56', col('number'))).toEqual({ ok: true, value: 1234.56 })
    expect(parseCell('-7', col('number'), true)).toEqual({ ok: true, value: -7 })
    expect(parseCell('1,5', col('number'), true).ok).toBe(false)
    expect(parseCell('1.5', col('number')).ok).toBe(false)
  })

  it('booleans: SIM / NAO, any case', () => {
    expect(parseCell('sim', col('boolean'))).toEqual({ ok: true, value: true })
    expect(parseCell('NAO', col('boolean'))).toEqual({ ok: true, value: false })
    expect(parseCell('NÃO', col('boolean')).ok).toBe(false)
  })

  it('masked strings: digits or formatted, stored formatted', () => {
    const cpf = { ...col('string'), mask: 'cpf' }
    expect(parseCell('12345678901', cpf)).toEqual({ ok: true, value: '123.456.789-01' })
    expect(parseCell('123.456.789-01', cpf)).toEqual({ ok: true, value: '123.456.789-01' })
    expect(parseCell('1234', cpf)).toEqual({ ok: false, message: 'CPF inválido (11 dígitos)' })
    const phone = { ...col('string'), mask: 'phone' }
    expect(parseCell('11987654321', phone)).toEqual({ ok: true, value: '(11) 98765-4321' })
    expect(parseCell('(11) 3456-7890', phone)).toEqual({ ok: true, value: '(11) 3456-7890' })
  })

  it('enums: matched case-insensitively, stored as declared', () => {
    expect(parseCell('active', col('enum', ['ACTIVE', 'INACTIVE']))).toEqual({ ok: true, value: 'ACTIVE' })
    expect(parseCell('OTHER', col('enum', ['ACTIVE', 'INACTIVE']))).toEqual({ ok: false, message: 'Valor inválido (aceitos: ACTIVE, INACTIVE)' })
  })
})
