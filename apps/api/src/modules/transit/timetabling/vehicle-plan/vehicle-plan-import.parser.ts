export interface ImportRow {
  lineCode:            string
  vehicleNumber:       string  // c[22] — used as primary grouping key for blocks
  tabId:               string  // e.g. "01A", "02B"
  tabNumber:           number  // numeric part: "01A" → 1
  sequence:            number  // col[7] — ordering within tab
  entryType:           string  // col[8]: '', '2' (tab-boundary), '3' (recolhida/return)
  isProductive:        boolean // col[9] === '1'
  direction:           'I' | 'V' | 'C'
  departureHHMM:       string
  arrivalHHMM:         string
  depDay:              number  // col[13]: 1 = same day, 2 = past midnight
  arrDay:              number  // col[14]
  depotDepartureHHMM:  string  // col[17] — depot departure time (saída de garagem), empty on most rows
  _lineNum:            number
}

export interface SkippedRow {
  line:   number
  record: string  // first few columns for identification
  reason: string
}

export interface ParseResult {
  rows:    ImportRow[]
  skipped: SkippedRow[]
}

export function parseVehiclePlanFile(buffer: Buffer): ParseResult {
  const rows:    ImportRow[]  = []
  const skipped: SkippedRow[] = []
  const lines = buffer.toString('utf-8').split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) continue

    const c = raw.split(';')

    if (c.length < 21) {
      skipped.push({ line: i + 1, record: raw.slice(0, 40), reason: `Colunas insuficientes (${c.length})` })
      continue
    }

    const lineCode  = c[0]?.trim() ?? ''
    if (!lineCode) continue  // truly blank lines — not worth logging

    const entryType = c[8]?.trim() ?? ''

    // Skip tab-boundary markers (zero-duration end-of-tab rows) — expected, no log
    if (entryType === '2') continue

    const tabId = c[4]?.trim() ?? ''
    if (!tabId) {
      skipped.push({ line: i + 1, record: lineCode, reason: 'tabId vazio' })
      continue
    }

    const tabNumber = parseInt(tabId.replace(/[A-Za-z]+$/, ''), 10)
    if (isNaN(tabNumber)) {
      skipped.push({ line: i + 1, record: `${lineCode} tab ${tabId}`, reason: `tabId inválido: "${tabId}"` })
      continue
    }

    const dir = c[10]?.trim()
    if (dir !== 'I' && dir !== 'V' && dir !== 'C') {
      skipped.push({ line: i + 1, record: `${lineCode} tab ${tabId}`, reason: `Direção desconhecida: "${dir}"` })
      continue
    }

    rows.push({
      lineCode,
      vehicleNumber:      c[22]?.trim() ?? '',
      tabId,
      tabNumber,
      sequence:           parseInt(c[7] ?? '0', 10) || 0,
      entryType,
      isProductive:       c[9]?.trim() === '1',
      direction:          dir,
      departureHHMM:      c[11]?.trim() ?? '0000',
      arrivalHHMM:        c[12]?.trim() ?? '0000',
      depDay:             parseInt(c[13] ?? '1', 10) || 1,
      arrDay:             parseInt(c[14] ?? '1', 10) || 1,
      depotDepartureHHMM: c[17]?.trim() ?? '',
      _lineNum:           i + 1,
    })
  }

  return { rows, skipped }
}

export function parseHHMM(hhmm: string): number {
  const s = hhmm.padStart(4, '0')
  return parseInt(s.substring(0, 2), 10) * 60 + parseInt(s.substring(2, 4), 10)
}
