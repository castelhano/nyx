export interface ImportRow {
  lineCode:      string
  vehicleNumber: string  // c[22] — used as primary grouping key for blocks
  tabId:         string  // e.g. "01A", "02B"
  tabNumber:     number  // numeric part: "01A" → 1
  sequence:      number  // col[7] — ordering within tab
  entryType:     string  // col[8]: '', '2', '3', '11'
  isProductive:  boolean // col[9] === '1'
  direction:     'I' | 'V'
  departureHHMM: string
  arrivalHHMM:   string
  depDay:        number  // col[13]: 1 = same day, 2 = past midnight
  arrDay:        number  // col[14]
  _lineNum:      number
}

export function parseVehiclePlanFile(buffer: Buffer): ImportRow[] {
  const rows: ImportRow[] = []
  const lines = buffer.toString('utf-8').split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) continue

    const c = raw.split(';')
    if (c.length < 21) continue

    const lineCode  = c[0]?.trim() ?? ''
    if (!lineCode) continue

    const entryType = c[8]?.trim() ?? ''

    // Skip tab-boundary markers — they don't represent trips
    if (entryType === '2' || entryType === '3') continue

    const tabId = c[4]?.trim() ?? ''
    if (!tabId) continue

    // "01A" → 1, "02B" → 2
    const tabNumber = parseInt(tabId.replace(/[A-Za-z]+$/, ''), 10)
    if (isNaN(tabNumber)) continue

    const dir = c[10]?.trim()
    if (dir !== 'I' && dir !== 'V') continue

    rows.push({
      lineCode,
      vehicleNumber: c[22]?.trim() ?? '',
      tabId,
      tabNumber,
      sequence:      parseInt(c[7] ?? '0', 10) || 0,
      entryType,
      isProductive:  c[9]?.trim() === '1',
      direction:     dir,
      departureHHMM: c[11]?.trim() ?? '0000',
      arrivalHHMM:   c[12]?.trim() ?? '0000',
      depDay:        parseInt(c[13] ?? '1', 10) || 1,
      arrDay:        parseInt(c[14] ?? '1', 10) || 1,
      _lineNum:      i + 1,
    })
  }

  return rows
}

export function parseHHMM(hhmm: string): number {
  const s = hhmm.padStart(4, '0')
  return parseInt(s.substring(0, 2), 10) * 60 + parseInt(s.substring(2, 4), 10)
}
