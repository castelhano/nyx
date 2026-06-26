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
  console.debug('[CSV] total rows (incl header):', rows.length)
  if (rows.length < 2) return { lines: [], byLine: new Map() }

  // detect delimiter
  const firstRow  = rows[0]
  const semicolons = (firstRow.match(/;/g) ?? []).length
  const commas     = (firstRow.match(/,/g) ?? []).length
  const delim      = semicolons >= commas ? ';' : ','
  console.debug('[CSV] delimiter detected:', JSON.stringify(delim), '| semicolons:', semicolons, '| commas:', commas)

  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '').replace(/^﻿/, '')
  const header  = firstRow.split(delim).map(unquote)
  console.debug('[CSV] header columns:', header)
  const col    = (name: string) => header.indexOf(name)

  const iData    = col('Data')
  const iTrajeto = col('Trajeto')
  const iVeiculo = col('Veiculo Real')
  const iMotor   = col('Motorista')
  const iPartida = col('Partida Real')
  const iTempo   = col('Tempo Viagem')
  const iStatus  = col('Status da Viagem')
  const iEditada = col('Viagem Editada')

  console.debug('[CSV] column indices:', { iData, iTrajeto, iVeiculo, iMotor, iPartida, iTempo, iStatus, iEditada })

  // sample first 3 data rows for debug
  for (let s = 1; s <= Math.min(3, rows.length - 1); s++) {
    const c = rows[s].split(delim).map(unquote)
    console.debug(`[CSV] row[${s}] status=${JSON.stringify(c[iStatus])} trajeto=${JSON.stringify(c[iTrajeto])} partida=${JSON.stringify(c[iPartida])} tempo=${JSON.stringify(c[iTempo])}`)
  }

  // collect unique status values (first 200 rows)
  const statusSample = new Set<string>()
  for (let s = 1; s <= Math.min(200, rows.length - 1); s++) {
    const c = rows[s].split(delim).map(unquote)
    statusSample.add(c[iStatus] ?? '(empty)')
  }
  console.debug('[CSV] status values (sample):', [...statusSample])

  const byLine = new Map<string, Map<Direction, RawTrip[]>>()
  let skippedStatus = 0, skippedDir = 0, skippedPartida = 0, skippedDuration = 0, accepted = 0

  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].split(delim).map(unquote)
    if (c[iStatus] !== '1') { skippedStatus++; continue }

    const trajeto = c[iTrajeto] ?? ''
    const dir     = mapDirection(trajeto)
    if (!dir) { skippedDir++; continue }

    const lineCode = trajeto.split(' - ')[0].trim()
    const partida  = c[iPartida] ?? ''
    if (!partida || partida === '-') { skippedPartida++; continue }

    const hourRaw = parseInt(partida.split(':')[0], 10)
    if (isNaN(hourRaw)) { skippedPartida++; continue }

    const duration = parseDurationMinutes(c[iTempo] ?? '')
    if (duration <= 0) { skippedDuration++; continue }

    accepted++
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

  console.debug('[CSV] parse summary:', { accepted, skippedStatus, skippedDir, skippedPartida, skippedDuration, lines: byLine.size })
  return {
    lines:  Array.from(byLine.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    byLine,
  }
}
