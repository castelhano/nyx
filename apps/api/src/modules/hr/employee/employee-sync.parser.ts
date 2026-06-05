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
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 11) return raw
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function stripLeadingZeros(raw: string): string {
  const s = raw.replace(/^0+/, '')
  return s === '' ? '0' : s
}

// Groups: 1=code  2=name  3=status  4=gender  5=hireDate  6=dateOfBirth  7=cpf  8=preferredName
const DATA_LINE_RE =
  /^\s+(\d{4,8})\s{2,}(.+?)\s{2,}([ADF])\s+([MF])\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{11})\s+(.*?)\s*$/

export function parseEmployeeSyncFile(buffer: Buffer): EmployeeSyncRow[] {
  const lines = buffer.toString('latin1').split('\n').map(l => l.replace(/\r$/, ''))
  const rows: EmployeeSyncRow[] = []

  for (let i = 0; i < lines.length; i++) {
    const m = DATA_LINE_RE.exec(lines[i])
    if (!m) continue

    rows.push({
      code:          stripLeadingZeros(m[1]),
      fullName:      m[2].trim(),
      status:        STATUS_MAP[m[3]] ?? 'ACTIVE',
      gender:        GENDER_MAP[m[4]] ?? null,
      hireDate:      parseDate(m[5]) ?? new Date(),
      dateOfBirth:   parseDate(m[6]),
      taxId:         formatCpf(m[7]),
      preferredName: m[8] || null,
      _line:         i + 1,
    })
  }

  return rows
}
