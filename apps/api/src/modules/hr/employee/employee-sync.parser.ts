export interface EmployeeSyncRow {
  code:          string
  fullName:      string
  status:        'ACTIVE' | 'ON_LEAVE' | 'TERMINATED'
  gender:        'MALE' | 'FEMALE' | null
  hireDate:      Date
  dateOfBirth:   Date | null
  taxId:         string
  jobTitle:      string | null
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

// Maps known header names to EmployeeSyncRow fields
const COLUMN_MAP = {
  CODFUNC:      'code',
  NOMEFUNC:     'fullName',
  SITUACAOFUNC: 'status',
  SEXOFUNC:     'gender',
  DTADMFUNC:    'hireDate',
  DTNASCTOFUNC: 'dateOfBirth',
  CPFNUMERO:    'taxId',
  DESCFUNCAO:   'jobTitle',
  APELIDOFUNC:  'preferredName',
} as const

type KnownHeader = keyof typeof COLUMN_MAP
type ColumnField = (typeof COLUMN_MAP)[KnownHeader]

interface ColumnSlice {
  field: ColumnField
  start: number
  end:   number  // exclusive; last column uses line.length
}

function parseHeader(line: string): ColumnSlice[] | null {
  const known = Object.keys(COLUMN_MAP) as KnownHeader[]
  const found: { name: KnownHeader; start: number }[] = []

  for (const name of known) {
    const idx = line.indexOf(name)
    if (idx !== -1) found.push({ name, start: idx })
  }

  if (found.length < 3) return null

  found.sort((a, b) => a.start - b.start)

  return found.map((col, i) => ({
    field: COLUMN_MAP[col.name],
    start: col.start,
    end:   i + 1 < found.length ? found[i + 1].start : Infinity,
  }))
}

function extract(line: string, col: ColumnSlice): string {
  return line.substring(col.start, col.end === Infinity ? undefined : col.end).trim()
}

function parseDate(raw: string): Date | null {
  if (!raw || raw.length !== 10) return null
  const [day, month, year] = raw.split('/')
  const d = new Date(Date.UTC(+year, +month - 1, +day))
  return isNaN(d.getTime()) ? null : d
}

function formatCpf(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 11) return raw
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function stripLeadingZeros(raw: string): string {
  const s = raw.replace(/^0+/, '')
  return s === '' ? '0' : s
}

// A data line must have a numeric code at the code column position
const CODE_RE = /^\d+$/

export function parseEmployeeSyncFile(buffer: Buffer): EmployeeSyncRow[] {
  const lines = buffer.toString('latin1').split('\n').map(l => l.replace(/\r$/, ''))
  const rows: EmployeeSyncRow[] = []

  let columns: ColumnSlice[] | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!columns) {
      columns = parseHeader(line)
      continue
    }

    const codeCol = columns.find(c => c.field === 'code')
    if (!codeCol) continue

    const rawCode = extract(line, codeCol)
    if (!CODE_RE.test(rawCode)) continue

    const get = (field: ColumnField): string => {
      const col = columns!.find(c => c.field === field)
      return col ? extract(line, col) : ''
    }

    rows.push({
      code:          stripLeadingZeros(get('code')),
      fullName:      get('fullName'),
      status:        STATUS_MAP[get('status')] ?? 'ACTIVE',
      gender:        GENDER_MAP[get('gender')] ?? null,
      hireDate:      parseDate(get('hireDate')) ?? new Date(),
      dateOfBirth:   parseDate(get('dateOfBirth')),
      taxId:         formatCpf(get('taxId')),
      jobTitle:      get('jobTitle') || null,
      preferredName: get('preferredName') || null,
      _line:         i + 1,
    })
  }

  return rows
}
