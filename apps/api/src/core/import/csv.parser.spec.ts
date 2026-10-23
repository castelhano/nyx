import { describe, expect, it } from 'vitest'
import { decodeCsv, parseCsv } from './csv.parser'

describe('decodeCsv', () => {
  it('reads UTF-8 and drops the BOM', () => {
    const buf = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('nome;Ação')])
    expect(decodeCsv(buf)).toBe('nome;Ação')
  })

  it('falls back to Latin-1', () => {
    expect(decodeCsv(new Uint8Array([0x41, 0xe7, 0xe3, 0x6f]))).toBe('Ação')
  })
})

describe('parseCsv', () => {
  it('splits header and records, numbering lines from the header', () => {
    const { headers, records } = parseCsv(' name ;code\r\nVolvo;1\r\nScania;2\r\n')
    expect(headers).toEqual(['name', 'code'])
    expect(records).toEqual([
      { line: 2, cells: ['Volvo', '1'] },
      { line: 3, cells: ['Scania', '2'] },
    ])
  })

  it('keeps separators, escaped quotes and line breaks inside quoted cells', () => {
    const { records } = parseCsv('a;b;c\n"x;y";"diz ""oi""";"linha 1\nlinha 2"\nfim;;\n')
    expect(records[0]).toEqual({ line: 2, cells: ['x;y', 'diz "oi"', 'linha 1\nlinha 2'] })
    expect(records[1]).toEqual({ line: 4, cells: ['fim', '', ''] })
  })

  it('skips blank lines and lines with only separators', () => {
    const { records } = parseCsv('a;b\n\n;\nx;y')
    expect(records).toEqual([{ line: 4, cells: ['x', 'y'] }])
  })

  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a;b\n"x;y\n')).toThrow('Aspas não fechadas a partir da linha 2')
  })
})
