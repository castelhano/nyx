import type { Day } from '../timetabling/plan-validity'

// Parser of the ERP's "Listagem de Movimentos da Frequência" (one file per empresa, day by day):
// fixed-width text, Latin-1, page breaks with the header repeated, an employee may go on into
// the next page. A day worked in several stretches has one line per stretch — the hour columns
// add up per date (the ERP puts the day's figures on its last line). Values are right-aligned
// under the column titles of the "DATA ... TOTAL" header.

export interface ParsedTimesheetDay {
  date:       Day
  // NOR, F TRB, JORJ, FOLGA, FERIAS, COMPENSACAO B, ATESTADO MEDICO... (no asterisks)
  occurrence: string
  // EXTRA + EXCES (the split is only the CLT's 2h limit)
  extra:      number
  // INCOM
  short:      number
  // TOTAL
  worked:     number
}

export interface ParsedTimesheetEmployee {
  // matrícula without the leading zeros
  code:     string
  name:     string
  // "Ferias de dd/mm/aaaa a dd/mm/aaaa" in the employee's header
  vacation: { from: Day; to: Day } | null
  days:     ParsedTimesheetDay[]
}

export interface ParsedTimesheet {
  from:      Day
  to:        Day
  company:   string
  // CNPJ digits
  taxId:     string | null
  employees: ParsedTimesheetEmployee[]
}

// the file's bytes: UTF-8 when valid, else Latin-1 (the ERP's own)
export function decodeTimesheet(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('latin1').decode(buf)
  }
}

const DATE = /(\d{2})\/(\d{2})\/(\d{4})/
const COLUMNS = ['ENTRA', 'I.INI', 'I.FIN', 'SAIDA', 'ACRES', 'LINHA', 'QV', 'OCORRENCIA', 'NORMAL', 'A.NOT', 'EXTRA', 'EX LN', 'EXCES', 'OUTRA', 'C.NOT', 'INCOM', 'TOTAL']
const toDay = (m: RegExpMatchArray | null): Day | null => (m ? `${m[3]}-${m[2]}-${m[1]}` : null)
const minutes = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}
export const bareCode = (code: string) => code.trim().replace(/^0+(?=\d)/, '')
export const normalizeOccurrence = (s: string) => s.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()

export function parseTimesheet(text: string): ParsedTimesheet {
  const out: ParsedTimesheet = { from: '', to: '', company: '', taxId: null, employees: [] }
  // column → [start, end) of its title in the header line
  let cols: Record<string, [number, number]> | null = null
  let current: ParsedTimesheetEmployee | null = null
  const byCode = new Map<string, ParsedTimesheetEmployee>()

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (!line) continue

    if (line.includes('PERIODO DE:')) {
      const [a, b] = [...line.matchAll(new RegExp(DATE, 'g'))]
      out.from = toDay(a) ?? out.from
      out.to   = toDay(b) ?? out.to
      continue
    }
    if (/^Empresa\s*:/.test(line)) { out.company = line.split(':').slice(1).join(':').trim(); continue }
    if (/^C\.N\.P\.J\.\s*:/.test(line)) { out.taxId = line.replace(/\D/g, '') || null; continue }
    if (/^Funcionario\s*:/.test(line)) {
      const m = line.match(/^Funcionario\s*:\s*(\d+)\s*-\s*\d+\s*-\s*(.+?)(?:\s{2,}\S.*)?$/)
      if (!m) { current = null; continue }
      const code = bareCode(m[1])
      current = byCode.get(code) ?? { code, name: m[2].trim(), vacation: null, days: [] }
      if (!byCode.has(code)) { byCode.set(code, current); out.employees.push(current) }
      continue
    }
    if (/^Admiss/.test(line) && current) {
      const v = line.match(/Ferias de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/)
      if (v) current.vacation = { from: toDay(v[1].match(DATE))!, to: toDay(v[2].match(DATE))! }
      continue
    }
    if (/^DATA\s+ENTRA/.test(line) && line.includes('TOTAL')) {
      cols = {}
      for (const title of COLUMNS) {
        const i = line.indexOf(title)
        if (i >= 0) cols[title] = [i, i + title.length]
      }
      continue
    }

    const date = line.match(/^(\d{2})\/(\d{2})\/(\d{4})\s/)
    if (!date || !current || !cols) continue
    const day = toDay(date)!
    // the hour values, by the column whose title ends where the value ends
    const value: Record<string, number> = {}
    const firstValue = cols['NORMAL']?.[0] ?? Infinity
    for (const m of line.matchAll(/\d{2,3}:\d{2}/g)) {
      const end = m.index + m[0].length
      if (m.index < firstValue - 2) continue
      const col = Object.entries(cols).find(([, [, e]]) => Math.abs(e - end) <= 1)?.[0]
      if (col) value[col] = (value[col] ?? 0) + minutes(m[0])
    }
    // a worked stretch has ENTRA; else the day is described by its text (FOLGA, ** FERIAS **...)
    const entra = cols['ENTRA']
    const worked = entra && /\d{2}:\d{2}/.test(line.slice(entra[0], entra[1] + 1))
    const occStart = cols['OCORRENCIA']?.[0]
    const occurrence = normalizeOccurrence(worked && occStart != null ? line.slice(occStart, firstValue) : line.slice(15))

    const d = current.days.find(x => x.date === day)
    const extra = (value['EXTRA'] ?? 0) + (value['EXCES'] ?? 0)
    if (d) {
      d.extra  += extra
      d.short  += value['INCOM'] ?? 0
      d.worked += value['TOTAL'] ?? 0
      if (occurrence) d.occurrence = occurrence
    } else {
      current.days.push({ date: day, occurrence, extra, short: value['INCOM'] ?? 0, worked: value['TOTAL'] ?? 0 })
    }
  }
  return out
}
