// CSV reader for the standard import: `;` separator, RFC 4180 quoting
// ("" escapes a quote; quoted cells may hold `;` and line breaks), UTF-8 or Latin-1.

export interface CsvRecord {
  line:  number     // 1-based line where the record starts (header is line 1)
  cells: string[]
}

export interface ParsedCsv {
  headers: string[]
  records: CsvRecord[]
}

// UTF-8 when valid (BOM dropped), else Latin-1 — what Excel saves in pt-BR
export function decodeCsv(buf: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    text = new TextDecoder('latin1').decode(buf)
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function parseCsv(text: string, separator = ';'): ParsedCsv {
  const rows: CsvRecord[] = []
  let cells: string[] = []
  let cell     = ''
  let quoted   = false
  let line     = 1
  let rowStart = 1

  const endRow = () => {
    cells.push(cell)
    // a line with nothing but separators/blanks is not a record
    if (cells.some(c => c.trim() !== '')) rows.push({ line: rowStart, cells })
    cells = []
    cell  = ''
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else quoted = false
      } else {
        if (ch === '\n') line++
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell.trim() === '') { cell = ''; quoted = true }
    else if (ch === separator) { cells.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
      line++
      rowStart = line
    }
    else cell += ch
  }
  if (quoted) throw new Error(`Aspas não fechadas a partir da linha ${rowStart}`)
  if (cell !== '' || cells.length) endRow()

  const [header, ...records] = rows
  return { headers: header ? header.cells.map(h => h.trim()) : [], records }
}
