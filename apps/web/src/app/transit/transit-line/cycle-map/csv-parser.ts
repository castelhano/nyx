import type { Direction, RawTrip, CsvData } from './types'

function parseDurationMinutes(s: string): number {
  if (!s || s === '-') return -1
  const parts = s.split(':')
  if (parts.length < 2) return -1
  const h   = parseInt(parts[0], 10)
  const m   = parseInt(parts[1], 10)
  const sec = parts.length > 2 ? parseInt(parts[2], 10) : 0
  if (isNaN(h) || isNaN(m)) return -1
  return h * 60 + m + (sec >= 30 ? 1 : 0)
}

function mapDirection(trajeto: string): Direction | null {
  const u = trajeto.toUpperCase()
  if (u.includes('IDA'))                                            return 'OUTBOUND'
  if (u.includes('VOLTA'))                                          return 'INBOUND'
  if (u.includes('UNICO') || u.includes('ÚNICO') || u.includes('CIRCULAR')) return 'CIRCULAR'
  return null
}

export function parseCsv(text: string): CsvData {
  const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean)
  if (rows.length < 2) return { lines: [], byLine: new Map() }

  const firstRow   = rows[0]
  const semicolons = (firstRow.match(/;/g) ?? []).length
  const commas     = (firstRow.match(/,/g) ?? []).length
  const delim      = semicolons >= commas ? ';' : ','

  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '').replace(/^﻿/, '')
  const header  = firstRow.split(delim).map(unquote)
  const col     = (name: string) => header.indexOf(name)

  const iData    = col('Data')
  const iTrajeto = col('Trajeto')
  const iVeiculo = col('Veiculo Real')
  const iMotor   = col('Motorista')
  const iPartida = col('Partida Real')
  const iTempo   = col('Tempo Viagem')
  const iStatus  = col('Status da Viagem')
  const iEditada = col('Viagem Editada')

  const byLine = new Map<string, Map<Direction, RawTrip[]>>()

  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].split(delim).map(unquote)
    if (c[iStatus] !== '1') continue

    const trajeto = c[iTrajeto] ?? ''
    const dir     = mapDirection(trajeto)
    if (!dir) continue

    const lineCode = trajeto.split(' - ')[0].trim()
    const partida  = c[iPartida] ?? ''
    if (!partida || partida === '-') continue

    const hourRaw = parseInt(partida.split(':')[0], 10)
    if (isNaN(hourRaw)) continue

    const duration = parseDurationMinutes(c[iTempo] ?? '')
    if (duration <= 0) continue

    const trip: RawTrip = {
      date:          c[iData]    ?? '',
      lineCode,
      direction:     dir,
      departureHour: hourRaw % 24,
      departureTime: partida,
      cycleMinutes:  duration,
      vehicle:       c[iVeiculo] ?? '-',
      driver:        c[iMotor]   ?? '-',
      edited:        (c[iEditada] ?? '').toLowerCase() === 'sim',
    }

    if (!byLine.has(lineCode)) byLine.set(lineCode, new Map())
    const dm = byLine.get(lineCode)!
    if (!dm.has(dir)) dm.set(dir, [])
    dm.get(dir)!.push(trip)
  }

  return {
    lines:  Array.from(byLine.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    byLine,
  }
}
