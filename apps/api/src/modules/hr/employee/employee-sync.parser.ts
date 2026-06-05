export interface EmployeeSyncRow {
  code:          string
  fullName:      string
  status:        'ACTIVE' | 'ON_LEAVE' | 'TERMINATED'
  gender:        'MALE' | 'FEMALE' | null
  hireDate:      Date
  dateOfBirth:   Date | null
  taxId:         string
  preferredName: string | null
  _line:         number
}

const STATUS_MAP: Record<string, EmployeeSyncRow['status']> = {
  A: 'ACTIVE',
  F: 'ON_LEAVE',
  D: 'TERMINATED',
}

const GENDER_MAP: Record<string, 'MALE' | 'FEMALE'> = {
  M: 'MALE',
  F: 'FEMALE',
}

function parseDate(raw: string): Date | null {
  const s = raw.trim()
  if (!s || s.length !== 10) return null
  const [day, month, year] = s.split('/')
  const d = new Date(Date.UTC(+year, +month - 1, +day))
  return isNaN(d.getTime()) ? null : d
}

function formatCpf(raw: string): string {
  const digits = raw.trim().replace(/\D/g, '')
  if (digits.length !== 11) return raw.trim()
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function stripLeadingZeros(raw: string): string {
  const trimmed  = raw.trim()
  const stripped = trimmed.replace(/^0+/, '')
  return stripped === '' ? '0' : stripped
}

// Build a map of col name → { start, end } by sorting all discovered positions
function buildColMap(headerLine: string, colNames: string[]): Map<string, { start: number; end: number }> {
  const entries: Array<{ name: string; pos: number }> = []
  for (const name of colNames) {
    const pos = headerLine.indexOf(name)
    if (pos !== -1) entries.push({ name, pos })
  }
  entries.sort((a, b) => a.pos - b.pos)

  const map = new Map<string, { start: number; end: number }>()
  for (let i = 0; i < entries.length; i++) {
    const { name, pos } = entries[i]
    const end = i + 1 < entries.length ? entries[i + 1].pos : Infinity
    map.set(name, { start: pos, end })
  }
  return map
}

export function parseEmployeeSyncFile(buffer: Buffer): EmployeeSyncRow[] {
  const lines = buffer.toString('latin1').split('\n').map(l => l.replace(/\r$/, ''))
  const rows: EmployeeSyncRow[] = []

  let headerLine = ''
  let headerIdx  = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('CODFUNC') && lines[i].includes('NOMEFUNC')) {
      headerLine = lines[i]
      headerIdx  = i
      break
    }
  }

  if (headerIdx === -1) throw new Error('Cabeçalho não encontrado no arquivo')

  console.log('[sync:parser] headerLine:', JSON.stringify(headerLine))

  const COL_NAMES = [
    'CODFUNC', 'NOMEFUNC', 'SITUACAOFUNC', 'SEXOFUNC',
    'DTADMFUNC', 'DTNASCTOFUNC', 'CPFNUMERO', 'APELIDOFUNC',
  ]
  const cols = buildColMap(headerLine, COL_NAMES)
  console.log('[sync:parser] cols:', JSON.stringify(Object.fromEntries(cols)))

  const col = (name: string, line: string): string => {
    const c = cols.get(name)
    if (!c) return ''
    return line.slice(c.start, c.end === Infinity ? undefined : c.end).trim()
  }

  const codeCol = cols.get('CODFUNC')
  const nameCol = cols.get('NOMEFUNC')
  if (!codeCol || !nameCol) throw new Error('Colunas CODFUNC/NOMEFUNC não encontradas')

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('TOTAL')) continue

    const codePart = line.slice(codeCol.start, nameCol.start).trim()
    if (!/^\d{4,8}$/.test(codePart)) continue

    const rawHireDate = col('DTADMFUNC', line)
    if (rows.length < 3) {
      console.log(`[sync:parser] line ${i + 1} rawHireDate=${JSON.stringify(rawHireDate)} parsed=${parseDate(rawHireDate)?.toISOString() ?? 'null'}`)
    }

    rows.push({
      code:          stripLeadingZeros(codePart),
      fullName:      col('NOMEFUNC',     line),
      status:        STATUS_MAP[col('SITUACAOFUNC', line)] ?? 'ACTIVE',
      gender:        GENDER_MAP[col('SEXOFUNC',     line)] ?? null,
      hireDate:      parseDate(rawHireDate) ?? new Date(),
      dateOfBirth:   parseDate(col('DTNASCTOFUNC', line)),
      taxId:         formatCpf(col('CPFNUMERO',    line)),
      preferredName: col('APELIDOFUNC', line) || null,
      _line:         i + 1,
    })
  }

  return rows
}
