import { describe, expect, it } from 'vitest'
import { EXPORT_LAYOUTS, formatExport, validateExport, layoutPositions, type ExportPreview } from '@nyx/schemas'

const def = EXPORT_LAYOUTS.GLOBUS

// lines produced by the legacy flow/oso_export script on importacaoV6.xlsx
const SAMPLE = [
  '410U07  01A  105:0013:490000510504:38I1005:0005:2101000020    ',
  '410U07  01C  215:3523:3200002005     I1015:3516:1701000020    ',
  '410U07  02A  105:2011:310000510504:50I1005:2005:4501000057A22B',
]

function preview(): ExportPreview {
  const row = (SENTIDO: string, COD_VIAGENS: string, HORARIO_SAIDA: string, HORARIO_CHEGADA: string, COD_ATIVIDADE: string, COD_LOCALIDADE: string, COD_LINHA = '') =>
    ({ kind: 'TRIP' as const, fields: { SENTIDO, COD_VIAGENS, HORARIO_SAIDA, HORARIO_CHEGADA, COD_ATIVIDADE, COD_LOCALIDADE, COD_LINHA } })
  return {
    system: 'GLOBUS',
    issues: [],
    programs: [{
      lineId: 'l', lineCode: '410', fields: { 'COD_PROGRAMAÇÃO': '410U07' },
      carros: [
        {
          blockId: 'b1', blockNumber: 1, number: 1,
          tables: [
            { fields: { SERVICO_TAB: '01A', TURNO: '1', INICIO_SERVICO: '05:00', FIM_SERVICO: '13:49', COD_LOCAL_MOT: '51', PREPARO_MOT: '5', SAIDA_GAR: '04:38' },
              rows: [row('I', '10', '05:00', '05:21', '01', '20')] },
            { fields: { SERVICO_TAB: '01C', TURNO: '2', INICIO_SERVICO: '15:35', FIM_SERVICO: '23:32', COD_LOCAL_MOT: '20', PREPARO_MOT: '5', SAIDA_GAR: '' },
              rows: [row('I', '10', '15:35', '16:17', '01', '20')] },
          ],
        },
        {
          blockId: 'b2', blockNumber: 2, number: 2,
          tables: [
            { fields: { SERVICO_TAB: '02A', TURNO: '1', INICIO_SERVICO: '05:20', FIM_SERVICO: '11:31', COD_LOCAL_MOT: '51', PREPARO_MOT: '5', SAIDA_GAR: '04:50' },
              rows: [row('I', '10', '05:20', '05:45', '01', '57', 'A22B')] },
          ],
        },
      ],
    }],
  }
}

describe('formatExport (Globus)', () => {
  it('reproduces the legacy script byte by byte', () => {
    expect(formatExport(def, preview())).toBe(SAMPLE.join('\r\n'))
  })

  it('lays out 62 chars per line', () => {
    const last = def.layout.at(-1)!
    expect(layoutPositions(def.layout).at(-1)! + last.size - 1).toBe(62)
  })
})

describe('validateExport', () => {
  it('accepts the sample', () => {
    expect(validateExport(def, preview())).toEqual([])
  })

  it('blocks values longer than the field instead of truncating', () => {
    const p = preview()
    p.programs[0].carros[0].tables[0].rows[0].fields.COD_LOCALIDADE = '1234567'
    expect(validateExport(def, p)).toEqual([
      expect.objectContaining({ program: 0, carro: 0, table: 0, row: 0, field: 'COD_LOCALIDADE' }),
    ])
  })

  it('blocks a missing program code, an invalid table name and duplicated tables', () => {
    const p = preview()
    p.programs[0].fields['COD_PROGRAMAÇÃO'] = ''
    p.programs[0].carros[0].tables[1].fields.SERVICO_TAB = '01?'
    p.programs[0].carros[1].tables[0].fields.SERVICO_TAB = '01A'
    expect(validateExport(def, p).map(e => [e.field, e.message])).toEqual([
      ['COD_PROGRAMAÇÃO', 'Obrigatório'],
      ['SERVICO_TAB', 'Valor inválido'],
      ['SERVICO_TAB', 'Duplicado na programação'],
    ])
  })
})
